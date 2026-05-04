import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { encryptPII, sha256Hex, syntheticEmailFromCedula } from '../auth/crypto.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { buildAnteproyectoPDF } from '../services/pdf.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth(), requireRole('super_admin'));

// =====================================================================
// PARTICIPANTES — cargar Excel + crear usuarios Auth
// =====================================================================
/**
 * POST /api/admin/participantes/cargar-excel
 * Multipart: cohorte_id (form), file (xlsx). Columnas: nombre_completo, cedula, email
 * Crea (si no existe) auth.users con email sintético + entry en participantes_lista.
 */
router.post('/participantes/cargar-excel', upload.single('file'), async (req: AuthenticatedRequest, res) => {
  const cohorteId = String(req.body?.cohorte_id ?? '').trim();
  if (!cohorteId) return res.status(400).json({ error: 'MISSING_COHORTE' });
  if (!req.file) return res.status(400).json({ error: 'MISSING_FILE' });

  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(req.file.buffer).buffer as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'EMPTY_WORKBOOK' });

  const header: string[] = [];
  ws.getRow(1).eachCell((c) => header.push(String(c.value ?? '').trim().toLowerCase()));
  for (const col of ['nombre_completo', 'cedula', 'email']) {
    if (!header.includes(col)) return res.status(400).json({ error: 'MISSING_COLUMN', column: col });
  }
  const idx = (k: string) => header.indexOf(k) + 1;

  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  let inserted = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    try {
      const nombre = String(row.getCell(idx('nombre_completo')).value ?? '').trim();
      const cedula = String(row.getCell(idx('cedula')).value ?? '').trim().replace(/[\s.\-]/g, '');
      const email = String(row.getCell(idx('email')).value ?? '').trim().toLowerCase();
      if (!nombre || !cedula || !email) continue;

      const synth = syntheticEmailFromCedula(cedula);

      // 1) crear auth user via REST admin API
      let userId: string | null = null;
      const createResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: synth, password: 'TempCambiar2026!', email_confirm: true,
          app_metadata: { app_role: 'participante', cohorte_id: cohorteId },
        }),
      });
      if (createResp.ok) {
        userId = ((await createResp.json()) as any).id;
      } else {
        // ya existe → fetch list & find
        const listResp = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=200`, {
          headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
        });
        const users = (((await listResp.json()) as any).users ?? []) as Array<{ id: string; email: string }>;
        userId = users.find((u) => u.email === synth)?.id ?? null;
      }

      // 2) upsert participantes_lista
      const { data: pRow } = await supabaseAdmin
        .from('participantes_lista')
        .upsert({
          cohorte_id: cohorteId,
          auth_user_id: userId,
          nombre_completo: nombre,
          cedula_encriptada: encryptPII(cedula),
          cedula_hash: sha256Hex(cedula),
          email_encriptado: encryptPII(email),
          email_hash: sha256Hex(email),
          estado: 'pendiente_activacion',
        }, { onConflict: 'cohorte_id,cedula_hash' })
        .select('id').single();

      // 3) actualizar metadata del auth user con participante_id
      if (userId && pRow) {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          method: 'PUT',
          headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_metadata: { app_role: 'participante', cohorte_id: cohorteId, participante_id: pRow.id } }),
        });
      }

      inserted++;
    } catch (e) {
      errors.push({ row: r, error: (e as Error).message });
    }
  }

  res.json({ inserted, errors: errors.slice(0, 50), nota: 'Clave temporal: TempCambiar2026! — los participantes deben usar "primer ingreso" para definir su clave real.' });
});

// =====================================================================
// COHORTES
// =====================================================================
router.get('/cohortes', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('cohortes')
    .select('*')
    .order('id');
  if (error) return res.status(500).json({ error: error.message });

  // Contar participantes por cohorte
  const enriched = await Promise.all((data ?? []).map(async (c) => {
    const { count: pc } = await supabaseAdmin
      .from('participantes_lista').select('*', { count: 'exact', head: true }).eq('cohorte_id', c.id);
    const { count: ec } = await supabaseAdmin
      .from('equipos').select('*', { count: 'exact', head: true }).eq('cohorte_id', c.id);
    return { ...c, participantes_count: pc ?? 0, equipos_count: ec ?? 0 };
  }));
  res.json(enriched);
});

const fechasSchema = z.object({
  fecha_limite_formacion_equipos: z.string().datetime().optional().nullable(),
  fecha_limite_entrega_anteproyecto: z.string().datetime().optional().nullable(),
  fecha_reunion_1: z.string().datetime().optional().nullable(),
  fecha_limite_seleccion_definitivo: z.string().datetime().optional().nullable(),
  activa: z.boolean().optional(),
});
router.put('/cohortes/:id', async (req, res) => {
  const parsed = fechasSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { error } = await supabaseAdmin.from('cohortes').update(parsed.data).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// =====================================================================
// PROFESORES — CRUD
// =====================================================================
router.get('/profesores', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profesores')
    .select('id, auth_user_id, nombre_completo, es_super_admin, activo, booking_url, areas_afinidad, ultimo_login, fecha_creacion')
    .order('nombre_completo');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

const createProfSchema = z.object({
  nombre_completo: z.string().min(2).max(150),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/),
  es_super_admin: z.boolean().default(false),
  booking_url: z.string().url().optional().nullable(),
  areas_afinidad: z.array(z.string().max(100)).default([]),
});
router.post('/profesores', async (req, res) => {
  const parsed = createProfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { nombre_completo, email, password, es_super_admin, booking_url, areas_afinidad } = parsed.data;
  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // crear auth user
  const createResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { app_role: 'profesor', es_super_admin } }),
  });
  if (!createResp.ok) {
    return res.status(400).json({ error: 'AUTH_USER_CREATE_FAILED', detail: await createResp.text() });
  }
  const authUser = (await createResp.json()) as { id: string };

  // insertar profesor
  const { data: prof, error } = await supabaseAdmin.from('profesores').insert({
    auth_user_id: authUser.id,
    nombre_completo,
    email_encriptado: encryptPII(email),
    email_hash: sha256Hex(email),
    es_super_admin,
    activo: true,
    booking_url: booking_url ?? null,
    areas_afinidad,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // actualizar app_metadata con profesor_id
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${authUser.id}`, {
    method: 'PUT',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_metadata: { app_role: 'profesor', es_super_admin, profesor_id: prof.id } }),
  });

  res.status(201).json({ profesor: prof });
});

const updateProfSchema = z.object({
  nombre_completo: z.string().min(2).max(150).optional(),
  es_super_admin: z.boolean().optional(),
  activo: z.boolean().optional(),
  booking_url: z.string().url().nullable().optional(),
  areas_afinidad: z.array(z.string()).optional(),
});
router.put('/profesores/:id', async (req, res) => {
  const parsed = updateProfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { data, error } = await supabaseAdmin.from('profesores').update(parsed.data).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ profesor: data });
});

// =====================================================================
// ANTEPROYECTOS — listar/detalle (todos)
// =====================================================================
router.get('/anteproyectos', async (req, res) => {
  const cohorte = String(req.query.cohorte ?? '').trim();
  const estado = String(req.query.estado ?? '').trim();

  let q = supabaseAdmin
    .from('anteproyectos')
    .select(`
      id, estado, fecha_envio, fecha_actualizacion,
      equipos!inner ( id, nombre_equipo, cohorte_id ),
      proyectos ( id, nombre, sector, estado_seleccion )
    `)
    .order('fecha_actualizacion', { ascending: false });

  if (cohorte) q = q.eq('equipos.cohorte_id', cohorte);
  if (estado) q = q.eq('estado', estado);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

router.get('/anteproyectos/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('anteproyectos')
    .select(`
      *,
      equipos (
        id, nombre_equipo, cohorte_id,
        miembros_equipo (
          posicion, fue_emprendedor, perfil,
          participantes_lista ( id, nombre_completo )
        )
      ),
      proyectos (
        *,
        hitos ( posicion, descripcion, fecha_inicio, fecha_fin )
      )
    `)
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(data);
});

// PDF del anteproyecto
router.get('/anteproyectos/:id/pdf', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('anteproyectos')
    .select(`
      estado, fecha_envio,
      equipos ( nombre_equipo, cohorte_id,
        miembros_equipo ( posicion, fue_emprendedor, perfil,
          participantes_lista ( nombre_completo ) ) ),
      proyectos ( *, hitos ( posicion, descripcion, fecha_inicio, fecha_fin ) )
    `)
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'NOT_FOUND' });

  const pdf = await buildAnteproyectoPDF(data as any);
  const filename = `anteproyecto-${(data.equipos as any)?.nombre_equipo?.replace(/[^a-zA-Z0-9]/g, '_') ?? req.params.id.slice(0, 8)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

// =====================================================================
// SOLICITUDES DESARCHIVADO (listar pendientes)
// =====================================================================
router.get('/solicitudes-desarchivado', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('solicitudes_desarchivado')
    .select(`
      *,
      proyectos ( id, nombre, anteproyecto_id ),
      participantes_lista!solicitudes_desarchivado_solicitante_id_fkey ( nombre_completo )
    `)
    .order('fecha_solicitud', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// =====================================================================
// AUDITORÍA (lectura)
// =====================================================================
router.get('/auditoria', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const accion = String(req.query.accion ?? '').trim();

  let q = supabaseAdmin
    .from('auditoria')
    .select('id, actor_tipo, actor_id, accion, entidad_tipo, entidad_id, ip, timestamp')
    .order('timestamp', { ascending: false })
    .limit(limit);
  if (accion) q = q.ilike('accion', `%${accion}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// =====================================================================
// SÁBANA — asignaciones profesor↔equipo + comunicar
// =====================================================================
const asignarSchema = z.object({
  asignaciones: z.array(z.object({
    equipo_id: z.string().uuid(),
    profesor_id: z.string().uuid(),
  })).min(1),
});

router.post('/sabanas/:cohorteId/asignar', async (req: AuthenticatedRequest, res) => {
  const parsed = asignarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const adminId = req.user!.profesorId;
  if (!adminId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });

  const { cohorteId } = req.params;
  // upsert por equipo (un equipo solo puede tener un profesor)
  const rows = parsed.data.asignaciones.map((a) => ({
    equipo_id: a.equipo_id,
    profesor_id: a.profesor_id,
    cohorte_id: cohorteId,
    asignado_por: adminId,
  }));

  const { error } = await supabaseAdmin
    .from('asignaciones_profesor')
    .upsert(rows, { onConflict: 'equipo_id' });
  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin
    .from('sabanas_proyectos')
    .upsert({ cohorte_id: cohorteId, estado: 'asignada', fecha_asignacion_completa: new Date().toISOString() },
      { onConflict: 'cohorte_id' });

  res.json({ ok: true, asignadas: rows.length });
});

router.post('/sabanas/:cohorteId/comunicar', async (req, res) => {
  // Marca la sábana como comunicada (envío real de emails es próxima iteración)
  const ahora = new Date().toISOString();
  await supabaseAdmin
    .from('sabanas_proyectos')
    .update({ estado: 'comunicada', fecha_comunicacion: ahora })
    .eq('cohorte_id', req.params.cohorteId);
  await supabaseAdmin
    .from('asignaciones_profesor')
    .update({ notificacion_enviada: true, fecha_notificacion: ahora })
    .eq('cohorte_id', req.params.cohorteId);
  res.json({ ok: true, nota: 'Marcada como comunicada. Envío SMTP real pendiente de configuración.' });
});

export default router;
