import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { decryptPII, generateRecoveryToken, sha256Hex, syntheticEmailFromCedula } from '../auth/crypto.js';
import { sendEmail } from '../services/email.js';
import { config } from '../config.js';

const router = Router();

const verificarCedulaSchema = z.object({
  cedula: z.string().min(6).max(20).regex(/^\d+$/, 'Solo dígitos'),
});

// Verifica si la cédula está pre-cargada y devuelve el estado
router.post('/verificar-cedula', async (req, res) => {
  const parsed = verificarCedulaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const cedulaClean = parsed.data.cedula.replace(/[\s.\-]/g, '');
  const cedulaHash = sha256Hex(cedulaClean);

  const { data, error } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, estado, nombre_completo, cohorte_id')
    .eq('cedula_hash', cedulaHash)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'DB_ERROR', message: error.message });
  if (!data) return res.status(404).json({ error: 'CEDULA_NO_ENCONTRADA' });

  res.json({
    estado: data.estado,
    nombre: data.nombre_completo,
    cohorte: data.cohorte_id,
    sintheticEmail: syntheticEmailFromCedula(cedulaClean),
  });
});

/**
 * POST /api/auth/recovery
 * Body: { cedula?, email? }
 * Genera token de recovery y envía email a la dirección institucional REAL
 * (NO al email sintético). Si el usuario no existe, devuelve 200 igual (no leak).
 */
const recoverySchema = z.object({
  cedula: z.string().regex(/^\d{6,20}$/).optional(),
  email: z.string().email().optional(),
}).refine((d) => d.cedula || d.email, { message: 'cedula o email requerido' });

router.post('/recovery', async (req, res) => {
  const parsed = recoverySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });

  let userId: string | null = null;
  let realEmail: string | null = null;
  let nombre: string | null = null;
  let participanteId: string | null = null;
  let profesorId: string | null = null;

  if (parsed.data.cedula) {
    // Participante
    const cedulaClean = parsed.data.cedula.replace(/[\s.\-]/g, '');
    const { data: p } = await supabaseAdmin
      .from('participantes_lista')
      .select('id, auth_user_id, email_encriptado, nombre_completo')
      .eq('cedula_hash', sha256Hex(cedulaClean))
      .maybeSingle();
    if (p) {
      participanteId = p.id;
      userId = p.auth_user_id;
      realEmail = decryptPII(p.email_encriptado);
      nombre = p.nombre_completo;
    }
  } else if (parsed.data.email) {
    // Profesor (su email real ES el de auth)
    const emailHash = sha256Hex(parsed.data.email.toLowerCase());
    const { data: prof } = await supabaseAdmin
      .from('profesores')
      .select('id, auth_user_id, nombre_completo, email_encriptado')
      .eq('email_hash', emailHash)
      .maybeSingle();
    if (prof) {
      profesorId = prof.id;
      userId = prof.auth_user_id;
      realEmail = decryptPII(prof.email_encriptado);
      nombre = prof.nombre_completo;
    }
  }

  // Respuesta neutra (no leak de existencia)
  if (!userId || !realEmail) {
    return res.json({ ok: true, mensaje: 'Si el usuario existe recibirás un email con instrucciones.' });
  }

  // Generar token y guardar
  const { token, hash } = generateRecoveryToken();
  await supabaseAdmin.from('recovery_tokens').insert({
    participante_id: participanteId,
    profesor_id: profesorId,
    token_hash: hash,
    expira_en: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });

  const link = `${config.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const html = `
    <p>Hola ${nombre ?? ''},</p>
    <p>Recibimos una solicitud de cambio de clave para tu cuenta NAVES INALDE.</p>
    <p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#e30613;color:white;text-decoration:none;border-radius:4px;">Crear nueva clave</a></p>
    <p>O copia este enlace en tu navegador:<br/><code>${link}</code></p>
    <p>El enlace expira en 30 minutos. Si no fuiste tú, puedes ignorar este mensaje.</p>
    <hr/>
    <p style="font-size:12px;color:#666">NAVES — INALDE Business School</p>
  `;
  const sendResult = await sendEmail(realEmail, 'Recuperación de clave NAVES', html);

  res.json({
    ok: true,
    mensaje: 'Si el usuario existe recibirás un email con instrucciones.',
    smtp: sendResult.ok ? 'sent' : sendResult.reason,
  });
});

/**
 * POST /api/auth/recovery/confirm
 * Body: { token, password }
 * Cambia la clave del usuario en Supabase Auth via Service Role.
 */
const confirmSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/),
});

router.post('/recovery/confirm', async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const tokenHash = sha256Hex(parsed.data.token);
  const { data: row } = await supabaseAdmin
    .from('recovery_tokens')
    .select('id, participante_id, profesor_id, expira_en, usado')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (!row) return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
  if (row.usado) return res.status(409).json({ error: 'TOKEN_USED' });
  if (new Date(row.expira_en) < new Date()) return res.status(410).json({ error: 'TOKEN_EXPIRED' });

  // Resolver auth_user_id
  let authUserId: string | null = null;
  if (row.participante_id) {
    const { data: p } = await supabaseAdmin.from('participantes_lista').select('auth_user_id').eq('id', row.participante_id).maybeSingle();
    authUserId = p?.auth_user_id ?? null;
  } else if (row.profesor_id) {
    const { data: pf } = await supabaseAdmin.from('profesores').select('auth_user_id').eq('id', row.profesor_id).maybeSingle();
    authUserId = pf?.auth_user_id ?? null;
  }
  if (!authUserId) return res.status(404).json({ error: 'USER_NOT_FOUND' });

  // Cambiar clave via Service Role
  const r = await fetch(`${config.supabase.internalUrl}/auth/v1/admin/users/${authUserId}`, {
    method: 'PUT',
    headers: {
      apikey: config.supabase.serviceRoleKey,
      Authorization: `Bearer ${config.supabase.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: parsed.data.password }),
  });
  if (!r.ok) return res.status(500).json({ error: 'AUTH_UPDATE_FAILED', detail: await r.text() });

  // Marcar token usado + activar al participante si estaba pendiente
  await supabaseAdmin.from('recovery_tokens')
    .update({ usado: true, fecha_uso: new Date().toISOString() })
    .eq('id', row.id);
  if (row.participante_id) {
    await supabaseAdmin.from('participantes_lista')
      .update({ estado: 'activo', fecha_activacion: new Date().toISOString() })
      .eq('id', row.participante_id);
  }

  res.json({ ok: true });
});

// Health del módulo auth
router.get('/', (_req, res) => res.json({ module: 'auth', status: 'ok' }));

/** GET /api/auth/me — devuelve el perfil + permisos del usuario logueado */
import { requireAuth } from './../auth/middleware.js';
import { getUserPermisos } from './../auth/permissions.js';

router.get('/me', requireAuth(), async (req: any, res) => {
  const permisos = await getUserPermisos(req.user.sub);

  // Resolver nombre_completo + estado (para forzar cambio de clave inicial en participantes)
  let nombre_completo: string | null = null;
  let estado: string | null = null;
  if (req.user.participanteId) {
    const { data } = await supabaseAdmin
      .from('participantes_lista')
      .select('nombre_completo, estado')
      .eq('id', req.user.participanteId)
      .maybeSingle();
    nombre_completo = data?.nombre_completo ?? null;
    estado = data?.estado ?? null;
  } else if (req.user.profesorId) {
    const { data } = await supabaseAdmin
      .from('profesores')
      .select('nombre_completo')
      .eq('id', req.user.profesorId)
      .maybeSingle();
    nombre_completo = data?.nombre_completo ?? null;
  }

  res.json({
    sub: req.user.sub,
    role: req.user.role,
    nombre_completo,
    estado,
    requiere_cambio_clave: estado === 'pendiente_activacion',
    es_super_admin: req.user.isSuperAdmin,
    profesor_id: req.user.profesorId ?? null,
    participante_id: req.user.participanteId ?? null,
    cohorte_id: req.user.cohorteId ?? null,
    permisos: Array.from(permisos),
  });
});

/**
 * POST /api/auth/cambiar-clave-inicial
 * Body: { password }
 * - El participante usa esto en el primer ingreso para reemplazar su clave temporal (= cédula).
 * - Marca estado='activo' y fecha_activacion=now().
 */
const cambiarClaveInicialSchema = z.object({
  password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/),
});

router.post('/cambiar-clave-inicial', requireAuth(), async (req: any, res) => {
  const parsed = cambiarClaveInicialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const participanteId = req.user?.participanteId as string | undefined;
  const authUserId = req.user?.sub as string | undefined;
  if (!participanteId || !authUserId) {
    return res.status(403).json({ error: 'SOLO_PARTICIPANTES' });
  }

  // Cambiar clave en auth via service role
  const r = await fetch(`${config.supabase.internalUrl}/auth/v1/admin/users/${authUserId}`, {
    method: 'PUT',
    headers: {
      apikey: config.supabase.serviceRoleKey,
      Authorization: `Bearer ${config.supabase.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: parsed.data.password }),
  });
  if (!r.ok) return res.status(500).json({ error: 'AUTH_UPDATE_FAILED', detail: await r.text() });

  // Activar al participante
  await supabaseAdmin.from('participantes_lista')
    .update({ estado: 'activo', fecha_activacion: new Date().toISOString() })
    .eq('id', participanteId);

  res.json({ ok: true });
});

export default router;
