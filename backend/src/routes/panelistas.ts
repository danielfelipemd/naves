import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { supabaseAdmin } from '../db/supabase.js';
import { encryptPII, decryptPII, sha256Hex } from '../auth/crypto.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { sendEmail } from '../services/email.js';

// Módulo A (Fase 2) — Panelistas / Evaluadores.
// Portal público por token (confirmar asistencia + logística) + panel admin.

const router = Router();
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').trim().replace(/\/$/, '') || 'https://naves-inalde.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;

// Nombre de día en español para saber viernes (almuerzo) / sábado (desayuno).
function diaSemana(fechaISO: string): string {
  // fechaISO = YYYY-MM-DD. Evitamos zona horaria usando mediodía UTC.
  const d = new Date(fechaISO + 'T12:00:00Z');
  return ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getUTCDay()];
}
function fechaLegible(fechaISO: string): string {
  const dia = diaSemana(fechaISO);
  const [, m, dd] = fechaISO.split('-');
  const meses = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${dia.charAt(0).toUpperCase() + dia.slice(1)} ${parseInt(dd, 10)} de ${meses[parseInt(m, 10)]}`;
}

// ---------------------------------------------------------------------------
// Carga completa de un panelista (con jornadas + logística) — reusado.
// ---------------------------------------------------------------------------
async function cargarPanelista(id: string) {
  const { data: p } = await supabaseAdmin
    .from('panelistas')
    .select('id, cohorte_id, nombre_completo, email_encriptado, asiste_todas, token_confirmacion, confirmado, email_enviado, activo')
    .eq('id', id)
    .maybeSingle();
  if (!p) return null;
  const [{ data: pj }, { data: log }] = await Promise.all([
    supabaseAdmin.from('panelista_jornadas').select('jornada_id').eq('panelista_id', id),
    supabaseAdmin.from('logistica_panelista').select('*').eq('panelista_id', id).maybeSingle(),
  ]);
  return { ...(p as any), jornada_ids: (pj ?? []).map((x: any) => x.jornada_id), logistica: log ?? null };
}

// Jornadas de la cohorte (ordenadas por número).
async function jornadasDeCohorte(cohorteId: string) {
  const { data } = await supabaseAdmin
    .from('jornadas')
    .select('id, numero, fecha, hora_inicio, hora_fin')
    .eq('cohorte_id', cohorteId)
    .order('numero');
  return (data ?? []) as any[];
}

// =====================================================================
// PORTAL PÚBLICO DEL PANELISTA (acceso por token, sin login)
// =====================================================================

// GET /api/panelistas/portal/:token
router.get('/portal/:token', async (req, res) => {
  const token = String(req.params.token ?? '').trim();
  if (!token) return res.status(400).json({ error: 'NO_TOKEN' });
  const { data: p } = await supabaseAdmin
    .from('panelistas')
    .select('id, cohorte_id, nombre_completo, asiste_todas, confirmado, activo')
    .eq('token_confirmacion', token)
    .maybeSingle();
  if (!p || !(p as any).activo) return res.status(404).json({ error: 'TOKEN_INVALIDO' });

  const jornadasCohorte = await jornadasDeCohorte((p as any).cohorte_id);
  const [{ data: pj }, { data: log }, { data: coh }] = await Promise.all([
    supabaseAdmin.from('panelista_jornadas').select('jornada_id').eq('panelista_id', (p as any).id),
    supabaseAdmin.from('logistica_panelista').select('*').eq('panelista_id', (p as any).id).maybeSingle(),
    supabaseAdmin.from('cohortes').select('etiqueta').eq('id', (p as any).cohorte_id).maybeSingle(),
  ]);
  const misJornadaIds = new Set((pj ?? []).map((x: any) => x.jornada_id));
  const misJornadas = (p as any).asiste_todas
    ? jornadasCohorte
    : jornadasCohorte.filter((j) => misJornadaIds.has(j.id));

  res.json({
    nombre: (p as any).nombre_completo,
    cohorte: (coh as any)?.etiqueta ?? (p as any).cohorte_id,
    asiste_todas: (p as any).asiste_todas,
    confirmado: (p as any).confirmado,
    jornadas: misJornadas.map((j) => ({
      id: j.id, numero: j.numero, fecha: j.fecha,
      fecha_legible: fechaLegible(j.fecha), dia: diaSemana(j.fecha),
      hora_inicio: j.hora_inicio, hora_fin: j.hora_fin,
    })),
    logistica: log ?? null,
  });
});

const portalConfirmarSchema = z.object({
  necesita_transporte: z.boolean().nullable().optional(),
  direccion_recogida: z.string().max(300).nullable().optional(),
  hora_recogida: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  transporte_por_fecha: z.record(z.string(), z.boolean()).optional(),
  almuerzo_por_fecha: z.record(z.string(), z.boolean()).optional(),
  desayuno_por_fecha: z.record(z.string(), z.boolean()).optional(),
});

// POST /api/panelistas/portal/:token/confirmar
router.post('/portal/:token/confirmar', async (req, res) => {
  const token = String(req.params.token ?? '').trim();
  const parsed = portalConfirmarSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const { data: p } = await supabaseAdmin
    .from('panelistas')
    .select('id, activo')
    .eq('token_confirmacion', token)
    .maybeSingle();
  if (!p || !(p as any).activo) return res.status(404).json({ error: 'TOKEN_INVALIDO' });

  const d = parsed.data;
  // Upsert de logística
  const { error: errLog } = await supabaseAdmin.from('logistica_panelista').upsert({
    panelista_id: (p as any).id,
    necesita_transporte: d.necesita_transporte ?? null,
    direccion_recogida: d.direccion_recogida ?? null,
    hora_recogida: d.hora_recogida ?? null,
    transporte_por_fecha: d.transporte_por_fecha ?? {},
    almuerzo_por_fecha: d.almuerzo_por_fecha ?? {},
    desayuno_por_fecha: d.desayuno_por_fecha ?? {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'panelista_id' });
  if (errLog) return res.status(500).json({ error: errLog.message });

  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim() || null;
  await supabaseAdmin.from('panelistas').update({
    confirmado: true,
    fecha_confirmacion: new Date().toISOString(),
    ip_confirmacion: ip,
  }).eq('id', (p as any).id);

  res.json({ ok: true, confirmado: true });
});

// =====================================================================
// ADMIN — solo super_admin
// =====================================================================

// --- JORNADAS ---------------------------------------------------------
const jornadaSchema = z.object({
  numero: z.number().int().min(1).max(30),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora_inicio: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  hora_fin: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

router.get('/admin/:cohorteId/jornadas', ...soloAdmin, async (req, res) => {
  res.json(await jornadasDeCohorte(req.params.cohorteId));
});

router.post('/admin/:cohorteId/jornadas', ...soloAdmin, async (req, res) => {
  const parsed = jornadaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { data, error } = await supabaseAdmin.from('jornadas').insert({
    cohorte_id: req.params.cohorteId, ...parsed.data,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/admin/jornada/:id', ...soloAdmin, async (req, res) => {
  const parsed = jornadaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { error } = await supabaseAdmin.from('jornadas').update(parsed.data).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete('/admin/jornada/:id', ...soloAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from('jornadas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- LISTADO DE PANELISTAS + STATS -----------------------------------
router.get('/admin/:cohorteId', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const jornadas = await jornadasDeCohorte(cohorteId);
  const jornadaById = new Map(jornadas.map((j) => [j.id, j]));

  const { data: panelistas, error } = await supabaseAdmin
    .from('panelistas')
    .select('id, nombre_completo, email_encriptado, asiste_todas, token_confirmacion, confirmado, email_enviado, activo, created_at')
    .eq('cohorte_id', cohorteId)
    .eq('activo', true)
    .order('created_at');
  if (error) return res.status(500).json({ error: error.message });

  const ids = (panelistas ?? []).map((p: any) => p.id);
  const [{ data: pjs }, { data: logs }] = ids.length === 0
    ? [{ data: [] as any[] }, { data: [] as any[] }]
    : await Promise.all([
        supabaseAdmin.from('panelista_jornadas').select('panelista_id, jornada_id').in('panelista_id', ids),
        supabaseAdmin.from('logistica_panelista').select('*').in('panelista_id', ids),
      ]);
  const jornadasPorPanelista = new Map<string, string[]>();
  for (const r of (pjs ?? []) as any[]) {
    const arr = jornadasPorPanelista.get(r.panelista_id) ?? [];
    arr.push(r.jornada_id); jornadasPorPanelista.set(r.panelista_id, arr);
  }
  const logPorPanelista = new Map<string, any>();
  for (const l of (logs ?? []) as any[]) logPorPanelista.set(l.panelista_id, l);

  const filas = (panelistas ?? []).map((p: any) => {
    const jids = p.asiste_todas ? jornadas.map((j) => j.id) : (jornadasPorPanelista.get(p.id) ?? []);
    let email = ''; try { email = decryptPII(p.email_encriptado); } catch { email = ''; }
    return {
      id: p.id,
      nombre: p.nombre_completo,
      email,
      asiste_todas: p.asiste_todas,
      jornadas: jids.map((id) => jornadaById.get(id)).filter(Boolean).map((j: any) => ({ id: j.id, numero: j.numero, fecha: j.fecha })),
      confirmado: p.confirmado,
      email_enviado: p.email_enviado,
      token: p.token_confirmacion,
      logistica: logPorPanelista.get(p.id) ?? null,
    };
  });

  const stats = {
    total: filas.length,
    enviados: filas.filter((f) => f.email_enviado).length,
    confirmados: filas.filter((f) => f.confirmado).length,
    con_transporte: filas.filter((f) => f.logistica?.necesita_transporte === true).length,
    pendientes: filas.filter((f) => !f.email_enviado).length,
  };
  res.json({ cohorte_id: cohorteId, jornadas, panelistas: filas, stats });
});

// --- CREAR PANELISTA --------------------------------------------------
const crearSchema = z.object({
  nombre_completo: z.string().min(2).max(150),
  email: z.string().email(),
  asiste_todas: z.boolean().optional(),
  jornada_ids: z.array(z.string().uuid()).optional(),
});
router.post('/admin/:cohorteId', ...soloAdmin, async (req, res) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { nombre_completo, email, asiste_todas, jornada_ids } = parsed.data;
  const emailHash = sha256Hex(email.toLowerCase());
  const { data: nuevo, error } = await supabaseAdmin.from('panelistas').insert({
    cohorte_id: req.params.cohorteId,
    nombre_completo,
    email_encriptado: encryptPII(email),
    email_hash: emailHash,
    asiste_todas: !!asiste_todas,
  }).select('id').single();
  if (error) {
    if ((error as any).code === '23505') return res.status(409).json({ error: 'EMAIL_DUPLICADO' });
    return res.status(500).json({ error: error.message });
  }
  if (!asiste_todas && jornada_ids?.length) {
    await supabaseAdmin.from('panelista_jornadas').insert(
      jornada_ids.map((jid) => ({ panelista_id: (nuevo as any).id, jornada_id: jid })),
    );
  }
  res.status(201).json({ id: (nuevo as any).id });
});

// --- EDITAR PANELISTA (nombre / jornadas / asiste_todas) -------------
const editarSchema = z.object({
  nombre_completo: z.string().min(2).max(150).optional(),
  asiste_todas: z.boolean().optional(),
  jornada_ids: z.array(z.string().uuid()).optional(),
});
router.patch('/admin/panelista/:id', ...soloAdmin, async (req, res) => {
  const parsed = editarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { nombre_completo, asiste_todas, jornada_ids } = parsed.data;
  const upd: Record<string, unknown> = {};
  if (nombre_completo !== undefined) upd.nombre_completo = nombre_completo;
  if (asiste_todas !== undefined) upd.asiste_todas = asiste_todas;
  if (Object.keys(upd).length) {
    const { error } = await supabaseAdmin.from('panelistas').update(upd).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  if (jornada_ids !== undefined) {
    await supabaseAdmin.from('panelista_jornadas').delete().eq('panelista_id', req.params.id);
    if (jornada_ids.length) {
      await supabaseAdmin.from('panelista_jornadas').insert(
        jornada_ids.map((jid) => ({ panelista_id: req.params.id, jornada_id: jid })),
      );
    }
  }
  res.json({ ok: true });
});

router.delete('/admin/panelista/:id', ...soloAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from('panelistas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- LOGÍSTICA (edición desde admin) ---------------------------------
router.put('/admin/panelista/:id/logistica', ...soloAdmin, async (req, res) => {
  const parsed = portalConfirmarSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const d = parsed.data;
  const { error } = await supabaseAdmin.from('logistica_panelista').upsert({
    panelista_id: req.params.id,
    necesita_transporte: d.necesita_transporte ?? null,
    direccion_recogida: d.direccion_recogida ?? null,
    hora_recogida: d.hora_recogida ?? null,
    transporte_por_fecha: d.transporte_por_fecha ?? {},
    almuerzo_por_fecha: d.almuerzo_por_fecha ?? {},
    desayuno_por_fecha: d.desayuno_por_fecha ?? {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'panelista_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- ENVÍO DE CORREOS -------------------------------------------------
function htmlInvitacionPanelista(nombre: string, cohorte: string, url: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
      <div style="border-bottom:3px solid #e30613;padding-bottom:14px;margin-bottom:22px;">
        <p style="color:#888;text-transform:uppercase;letter-spacing:1.5px;font-size:11px;margin:0;">Panel de Evaluación — NAVES</p>
        <h2 style="color:#1a1a1a;margin:6px 0 0 0;font-size:22px;">Confirma tu asistencia como panelista</h2>
      </div>
      <p><strong>${nombre}</strong>:</p>
      <p>Reciba un cordial saludo. Le invitamos a participar como panelista evaluador en las
      presentaciones de NAVES de la cohorte <strong>${cohorte}</strong> del Executive MBA de INALDE.</p>
      <p>Por favor confirme su asistencia e indique sus preferencias de logística (transporte y comidas)
      desde el siguiente enlace personal:</p>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${url}" style="display:inline-block;background:#e30613;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 30px;border-radius:6px;">Confirmar mi asistencia</a>
      </div>
      <p style="text-align:center;font-size:11px;color:#888;margin:6px 0 0;">O ingrese en <a href="${url}" style="color:#e30613;">${url}</a></p>
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 16px;">
      <p style="font-size:11px;color:#888;line-height:1.5;margin:0;">
        <strong>INALDE Business School</strong> — Programa MBA · NAVES<br>
        Este es un mensaje automático, por favor no responda a este correo.
      </p>
    </div>`;
}

async function enviarInvitacion(panelistaId: string): Promise<{ ok: boolean; razon?: string }> {
  const p = await cargarPanelista(panelistaId);
  if (!p) return { ok: false, razon: 'NOT_FOUND' };
  let email = ''; try { email = decryptPII(p.email_encriptado); } catch { return { ok: false, razon: 'PII_DECRYPT_FAILED' }; }
  if (!email) return { ok: false, razon: 'EMAIL_VACIO' };
  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', p.cohorte_id).maybeSingle();
  const url = `${PUBLIC_URL}/panelista/confirmar?token=${p.token_confirmacion}`;
  const html = htmlInvitacionPanelista(p.nombre_completo, (coh as any)?.etiqueta ?? p.cohorte_id, url);
  const r = await sendEmail(email, 'Confirma tu asistencia como panelista — NAVES', html);
  if (r.ok) {
    await supabaseAdmin.from('panelistas').update({ email_enviado: true, email_enviado_at: new Date().toISOString() }).eq('id', panelistaId);
  }
  return { ok: r.ok, razon: r.ok ? undefined : r.reason };
}

router.post('/admin/panelista/:id/enviar', ...soloAdmin, async (req, res) => {
  const r = await enviarInvitacion(req.params.id);
  if (!r.ok) return res.status(502).json({ error: 'ENVIO_FALLIDO', razon: r.razon });
  res.json({ ok: true });
});

router.post('/admin/:cohorteId/enviar-pendientes', ...soloAdmin, async (req, res) => {
  const { data: pend } = await supabaseAdmin
    .from('panelistas')
    .select('id')
    .eq('cohorte_id', req.params.cohorteId)
    .eq('activo', true)
    .eq('email_enviado', false);
  const ids = (pend ?? []).map((p: any) => p.id);
  res.json({ ok: true, iniciado: true, total: ids.length });
  // Envío en serie en segundo plano (evita timeout / límites SMTP).
  void (async () => {
    for (const id of ids) { await enviarInvitacion(id); await sleep(600); }
  })();
});

// --- RECORDATORIOS a panelistas invitados pero sin confirmar -----------
function htmlRecordatorioPanelista(nombre: string, cohorte: string, url: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
      <div style="border-bottom:3px solid #e30613;padding-bottom:14px;margin-bottom:22px;">
        <p style="color:#888;text-transform:uppercase;letter-spacing:1.5px;font-size:11px;margin:0;">Panel de Evaluación — NAVES</p>
        <h2 style="color:#1a1a1a;margin:6px 0 0 0;font-size:22px;">Recordatorio: confirma tu asistencia</h2>
      </div>
      <p><strong>${nombre}</strong>:</p>
      <p>Le recordamos que aún está pendiente confirmar su asistencia como panelista evaluador de NAVES
      para la cohorte <strong>${cohorte}</strong> del Executive MBA de INALDE. Su confirmación nos ayuda a
      organizar la logística del evento.</p>
      <p>Puede confirmar e indicar sus preferencias de transporte y comidas desde su enlace personal:</p>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${url}" style="display:inline-block;background:#e30613;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 30px;border-radius:6px;">Confirmar mi asistencia</a>
      </div>
      <p style="text-align:center;font-size:11px;color:#888;margin:6px 0 0;">O ingrese en <a href="${url}" style="color:#e30613;">${url}</a></p>
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 16px;">
      <p style="font-size:11px;color:#888;line-height:1.5;margin:0;">
        <strong>INALDE Business School</strong> — Programa MBA · NAVES<br>
        Este es un mensaje automático, por favor no responda a este correo.
      </p>
    </div>`;
}

async function enviarRecordatorio(panelistaId: string): Promise<boolean> {
  const p = await cargarPanelista(panelistaId);
  if (!p) return false;
  let email = ''; try { email = decryptPII(p.email_encriptado); } catch { return false; }
  if (!email) return false;
  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', p.cohorte_id).maybeSingle();
  const url = `${PUBLIC_URL}/panelista/confirmar?token=${p.token_confirmacion}`;
  const html = htmlRecordatorioPanelista(p.nombre_completo, (coh as any)?.etiqueta ?? p.cohorte_id, url);
  const r = await sendEmail(email, 'Recordatorio: confirma tu asistencia como panelista — NAVES', html);
  return r.ok;
}

// POST /admin/:cohorteId/recordatorios — a los invitados (email_enviado) sin confirmar
router.post('/admin/:cohorteId/recordatorios', ...soloAdmin, async (req, res) => {
  const { data: pend } = await supabaseAdmin
    .from('panelistas')
    .select('id')
    .eq('cohorte_id', req.params.cohorteId)
    .eq('activo', true)
    .eq('email_enviado', true)
    .eq('confirmado', false);
  const ids = (pend ?? []).map((p: any) => p.id);
  res.json({ ok: true, iniciado: true, total: ids.length });
  void (async () => {
    for (const id of ids) { await enviarRecordatorio(id); await sleep(600); }
  })();
});

// --- RESUMEN POR JORNADA ---------------------------------------------
async function computarResumen(cohorteId: string) {
  const jornadas = await jornadasDeCohorte(cohorteId);
  const { data: panelistas } = await supabaseAdmin
    .from('panelistas')
    .select('id, nombre_completo, asiste_todas, email_encriptado')
    .eq('cohorte_id', cohorteId).eq('activo', true).order('nombre_completo');
  const ids = (panelistas ?? []).map((p: any) => p.id);
  const [{ data: pjs }, { data: logs }] = ids.length === 0
    ? [{ data: [] as any[] }, { data: [] as any[] }]
    : await Promise.all([
        supabaseAdmin.from('panelista_jornadas').select('panelista_id, jornada_id').in('panelista_id', ids),
        supabaseAdmin.from('logistica_panelista').select('*').in('panelista_id', ids),
      ]);
  const jorPorPan = new Map<string, Set<string>>();
  for (const r of (pjs ?? []) as any[]) {
    const s = jorPorPan.get(r.panelista_id) ?? new Set(); s.add(r.jornada_id); jorPorPan.set(r.panelista_id, s);
  }
  const logPorPan = new Map<string, any>();
  for (const l of (logs ?? []) as any[]) logPorPan.set(l.panelista_id, l);

  const porJornada = jornadas.map((j) => {
    const asistentes = (panelistas ?? []).filter((p: any) => p.asiste_todas || jorPorPan.get(p.id)?.has(j.id));
    return {
      jornada: { numero: j.numero, fecha: j.fecha, fecha_legible: fechaLegible(j.fecha), dia: diaSemana(j.fecha), hora_inicio: j.hora_inicio, hora_fin: j.hora_fin },
      panelistas: asistentes.map((p: any) => {
        const log = logPorPan.get(p.id) ?? {};
        const transp = log.necesita_transporte === true && (log.transporte_por_fecha?.[j.fecha] ?? true);
        const esViernes = diaSemana(j.fecha) === 'viernes';
        const esSabado = diaSemana(j.fecha) === 'sábado';
        return {
          nombre: p.nombre_completo,
          transporte: !!transp,
          direccion: transp ? (log.direccion_recogida ?? null) : null,
          hora_recogida: transp ? (log.hora_recogida ?? null) : null,
          almuerza: esViernes ? !!(log.almuerzo_por_fecha?.[j.fecha]) : null,
          desayuna: esSabado ? !!(log.desayuno_por_fecha?.[j.fecha]) : null,
        };
      }),
    };
  });
  return { total_panelistas: (panelistas ?? []).length, por_jornada: porJornada };
}

router.get('/admin/:cohorteId/resumen', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const r = await computarResumen(cohorteId);
  res.json({ cohorte_id: cohorteId, ...r });
});

// POST /admin/:cohorteId/resumen-logistico — envía el resumen por correo al coordinador
const resumenEmailSchema = z.object({ email: z.string().email() });
function htmlResumenLogistico(cohorte: string, r: Awaited<ReturnType<typeof computarResumen>>): string {
  const si = (b: boolean) => b ? '<span style="color:#1a7a1a;font-weight:600;">Sí</span>' : '<span style="color:#aaa;">—</span>';
  const bloques = r.por_jornada.map((pj) => {
    const filas = pj.panelistas.length === 0
      ? `<tr><td colspan="5" style="padding:8px;color:#999;font-style:italic;">Sin panelistas confirmados para esta jornada.</td></tr>`
      : pj.panelistas.map((p) => `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:6px 8px;">${p.nombre}</td>
          <td style="padding:6px 8px;text-align:center;">${si(p.transporte)}${p.transporte && p.hora_recogida ? ` <span style="color:#888;font-size:11px;">(${String(p.hora_recogida).slice(0, 5)})</span>` : ''}</td>
          <td style="padding:6px 8px;font-size:11px;color:#666;">${p.transporte && p.direccion ? p.direccion : ''}</td>
          <td style="padding:6px 8px;text-align:center;">${p.almuerza === null ? '<span style="color:#ccc;">n/a</span>' : si(p.almuerza)}</td>
          <td style="padding:6px 8px;text-align:center;">${p.desayuna === null ? '<span style="color:#ccc;">n/a</span>' : si(p.desayuna)}</td>
        </tr>`).join('');
    return `
      <h3 style="margin:22px 0 6px;color:#1a1a1a;font-size:15px;">Jornada ${pj.jornada.numero} — ${pj.jornada.fecha_legible} · ${String(pj.jornada.hora_inicio ?? '').slice(0, 5)}–${String(pj.jornada.hora_fin ?? '').slice(0, 5)}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#1a1a1a;color:#fff;text-align:left;">
          <th style="padding:6px 8px;">Panelista</th><th style="padding:6px 8px;">Transporte</th><th style="padding:6px 8px;">Dirección</th><th style="padding:6px 8px;">Almuerzo</th><th style="padding:6px 8px;">Desayuno</th>
        </tr>${filas}
      </table>`;
  }).join('');
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:720px;margin:0 auto">
      <div style="border-bottom:3px solid #e30613;padding-bottom:14px;margin-bottom:8px;">
        <p style="color:#888;text-transform:uppercase;letter-spacing:1.5px;font-size:11px;margin:0;">NAVES — Logística de panelistas</p>
        <h2 style="color:#1a1a1a;margin:6px 0 0 0;font-size:22px;">Resumen logístico · ${cohorte}</h2>
      </div>
      <p style="color:#666;font-size:13px;">Total de panelistas activos: <strong>${r.total_panelistas}</strong>. Transporte, almuerzo (viernes) y desayuno (sábado) por jornada.</p>
      ${bloques}
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 16px;">
      <p style="font-size:11px;color:#888;line-height:1.5;margin:0;"><strong>INALDE Business School</strong> — Programa MBA · NAVES</p>
    </div>`;
}

router.post('/admin/:cohorteId/resumen-logistico', ...soloAdmin, async (req, res) => {
  const parsed = resumenEmailSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const cohorteId = req.params.cohorteId;
  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle();
  const r = await computarResumen(cohorteId);
  const html = htmlResumenLogistico((coh as any)?.etiqueta ?? cohorteId, r);
  const env = await sendEmail(parsed.data.email, `Resumen logístico de panelistas — NAVES ${(coh as any)?.etiqueta ?? cohorteId}`, html);
  if (!env.ok) return res.status(502).json({ error: 'ENVIO_FALLIDO', razon: env.reason });
  res.json({ ok: true });
});

export default router;
