import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import JSZip from 'jszip';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { decryptPII, encryptPII, sha256Hex } from '../auth/crypto.js';
import { sendEmail } from '../services/email.js';
import { ipCliente } from '../lib/ip-cliente.js';
import { programacionPublicadaAt } from '../services/escaleta.js';
import { downloadMiniatura, downloadTrabajoGradoFile, mimeFromPath } from '../services/storage.js';
import {
  cohorteDeEnlace, describirAsistencia, enlaceDeCohorte, guardarAvisos, guardarEnlace, programacionPorBloques,
  proyectoEnProgramacion, type JornadaBloques,
} from '../services/panelistas-enlace.js';

// Enlace compartido de panelistas (sql/55). Lo que hacía el sitio alterno
// (navesfs.netlify.app/panelistas), dentro del sistema: la programación por
// bloques con logo, resumen y One Pager; «asistir a todas» o bloque por bloque;
// nombre, correo y logística; correo de confirmación automático.
//
// Diferencia de fondo con el alterno: allí la clave del admin y la llave del
// almacén (JSONbin) iban en el código de la página, a la vista de cualquiera.
// Aquí el panelista solo puede leer la programación y dejar SU confirmación; no
// ve lo que contestaron los demás.

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;
const HORA = 60 * 60 * 1000;
const porIp = { windowMs: HORA, keyGenerator: (req: Request) => ipCliente(req) ?? 'sin-ip', standardHeaders: true, legacyHeaders: false };
// La página pide 1 vez la programación y ~33 miniaturas al cargar; un salón
// entero comparte IP. Los límites son contra abuso, no contra uso normal.
const limiteLectura = rateLimit({ ...porIp, max: 600 });
const limiteArchivos = rateLimit({ ...porIp, max: 3000 });
const limiteZip = rateLimit({ ...porIp, max: 30 });
const limiteConfirmar = rateLimit({ ...porIp, max: 60 });

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function nombreArchivo(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Proyecto';
}
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Responde por qué el enlace no abre. Devuelve la cohorte si abre.
async function cohorteVigente(req: Request, res: Response): Promise<string | null> {
  const e = await cohorteDeEnlace(String(req.params.token ?? ''));
  if (!e) { res.status(404).json({ error: 'ENLACE_INVALIDO' }); return null; }
  if (e.estado === 'inactivo') { res.status(410).json({ error: 'ENLACE_INACTIVO' }); return null; }
  if (e.estado === 'vencido') { res.status(410).json({ error: 'ENLACE_VENCIDO', vence_at: e.vence_at }); return null; }
  return e.cohorte_id;
}

// =====================================================================
// PÚBLICO — quien tiene el enlace
// =====================================================================

// GET /api/panelistas-enlace/p/:token — la programación por bloques.
router.get('/p/:token', limiteLectura, async (req, res) => {
  const cohorteId = await cohorteVigente(req, res);
  if (!cohorteId) return;
  const [{ evento_nombre, jornadas }, { data: coh }, enlace] = await Promise.all([
    programacionPorBloques(cohorteId),
    supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle(),
    enlaceDeCohorte(cohorteId),
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    cohorte: (coh as any)?.etiqueta ?? cohorteId,
    evento_nombre,
    vence_at: enlace?.vence_at ?? null,
    jornadas: jornadas.map((j) => ({ ...j, id: undefined })),
  });
});

// GET /api/panelistas-enlace/p/:token/archivo/:proyectoId/:tipo
// tipo = one-pager | logo | miniatura. Se pide en el momento del clic: una URL
// firmada al cargar la página vencería con la página abierta.
router.get('/p/:token/archivo/:proyectoId/:tipo', limiteArchivos, async (req, res) => {
  const { proyectoId, tipo } = req.params;
  if (!['one-pager', 'logo', 'miniatura'].includes(tipo)) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  const cohorteId = await cohorteVigente(req, res);
  if (!cohorteId) return;
  if (!(await proyectoEnProgramacion(cohorteId, proyectoId))) return res.status(404).json({ error: 'NO_ENCONTRADO' });

  const [{ data: c }, { data: p }] = await Promise.all([
    supabaseAdmin.from('proyecto_contenido').select('one_pager_path, one_pager_url, logo_path, logo_url').eq('proyecto_id', proyectoId).maybeSingle(),
    supabaseAdmin.from('proyectos').select('nombre').eq('id', proyectoId).maybeSingle(),
  ]);
  const esOnePager = tipo === 'one-pager';
  const path: string | null = esOnePager ? (c as any)?.one_pager_path : (c as any)?.logo_path;
  const urlExterna: string | null = esOnePager ? (c as any)?.one_pager_url : (c as any)?.logo_url;
  if (!path) {
    // Material viejo enlazado por URL y no subido al bucket.
    if (urlExterna && /^https:\/\//i.test(urlExterna)) return res.redirect(302, urlExterna);
    return res.status(404).json({ error: 'NO_ENCONTRADO' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (tipo === 'miniatura') {
    const m = await downloadMiniatura(path, 160);
    if (m) {
      res.setHeader('Content-Type', m.mime);
      res.setHeader('Cache-Control', 'private, max-age=600');
      return res.send(m.buf);
    }
  }
  let buf: Buffer;
  try { buf = await downloadTrabajoGradoFile(path); } catch { return res.status(404).json({ error: 'ARCHIVO_NO_DISPONIBLE' }); }
  const mime = mimeFromPath(path);
  const nombre = `${esOnePager ? 'One Pager' : 'Logo'} - ${nombreArchivo((p as any)?.nombre ?? 'Proyecto')}.${EXT[mime] ?? 'bin'}`;
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  res.send(buf);
});

// GET /api/panelistas-enlace/p/:token/one-pagers.zip — todos los One Pager, una
// carpeta por proyecto en el orden de presentación (pedido de Daniel, 18/11).
// En int-24-26 son 33 archivos y 50,6 MB: se guardan sin comprimir (PDF y JPG
// ya vienen comprimidos) y se bajan de a 4 del bucket.
router.get('/p/:token/one-pagers.zip', limiteZip, async (req, res) => {
  const cohorteId = await cohorteVigente(req, res);
  if (!cohorteId) return;
  const [{ jornadas }, { data: coh }] = await Promise.all([
    programacionPorBloques(cohorteId),
    supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle(),
  ]);
  const proys = jornadas.flatMap((j) => j.bloques.flatMap((b) => b.filas))
    .filter((f): f is Extract<typeof f, { tipo: 'proyecto' }> => f.tipo === 'proyecto');
  const { data: cont } = proys.length
    ? await supabaseAdmin.from('proyecto_contenido').select('proyecto_id, one_pager_path').in('proyecto_id', proys.map((p) => p.proyecto_id))
    : { data: [] as any[] };
  const pathDe = new Map((cont ?? []).map((c: any) => [c.proyecto_id, c.one_pager_path as string | null]));

  const zip = new JSZip();
  const faltan: string[] = [];
  const ancho = String(Math.max(...proys.map((p) => p.slot), 1)).length;
  for (let i = 0; i < proys.length; i += 4) {
    await Promise.all(proys.slice(i, i + 4).map(async (p) => {
      const nombre = nombreArchivo(p.proyecto);
      const path = pathDe.get(p.proyecto_id);
      if (!path) { faltan.push(`${p.slot}. ${p.proyecto}`); return; }
      try {
        const buf = await downloadTrabajoGradoFile(path);
        const ext = EXT[mimeFromPath(path)] ?? 'pdf';
        zip.folder(`${String(p.slot).padStart(ancho, '0')} - ${nombre}`)!.file(`One Pager - ${nombre}.${ext}`, buf);
      } catch { faltan.push(`${p.slot}. ${p.proyecto}`); }
    }));
  }
  if (faltan.length) {
    zip.file('LEAME - One Pagers que faltan.txt', `Estos One Pager no se pudieron incluir:\n\n${faltan.join('\n')}\n`);
  }
  const archivo = `One Pagers NAVES ${nombreArchivo((coh as any)?.etiqueta ?? cohorteId)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archivo)}`);
  zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'STORE' })
    .on('error', () => res.destroy())
    .pipe(res);
});

// POST /api/panelistas-enlace/p/:token/confirmar
const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const confirmarSchema = z.object({
  nombre: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(200),
  todas: z.boolean(),
  bloques: z.array(z.object({ jornada: z.number().int().min(1), bloque: z.number().int().min(1) })).max(60).default([]),
  logistica: z.object({
    necesita_transporte: z.boolean().nullable(),
    direccion_recogida: z.string().trim().max(300).nullable().optional(),
    hora_recogida: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    transporte_por_fecha: z.record(fechaISO, z.boolean()).optional(),
    almuerzo_por_fecha: z.record(fechaISO, z.boolean()).optional(),
    desayuno_por_fecha: z.record(fechaISO, z.boolean()).optional(),
  }).optional(),
}).refine((d) => d.todas || d.bloques.length > 0, { message: 'SIN_BLOQUES' });

router.post('/p/:token/confirmar', limiteConfirmar, async (req, res) => {
  const parsed = confirmarSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const sinBloques = parsed.error.issues.some((i) => i.message === 'SIN_BLOQUES');
    return res.status(400).json({ error: sinBloques ? 'SIN_BLOQUES' : 'INVALID', details: parsed.error.issues });
  }
  const cohorteId = await cohorteVigente(req, res);
  if (!cohorteId) return;
  const d = parsed.data;

  // Los bloques se validan contra la programación de AHORA: un número que no
  // existe no se guarda.
  const prog = await programacionPorBloques(cohorteId);
  const elegidos: Array<{ jornada_id: string; bloque: number }> = [];
  for (const b of d.bloques) {
    const j = prog.jornadas.find((x) => x.numero === b.jornada);
    if (!j || !j.bloques.some((x) => x.numero === b.bloque)) return res.status(400).json({ error: 'BLOQUE_INEXISTENTE', jornada: b.jornada, bloque: b.bloque });
    if (!elegidos.some((e) => e.jornada_id === j.id && e.bloque === b.bloque)) elegidos.push({ jornada_id: j.id, bloque: b.bloque });
  }

  // ¿Ya estaba en la lista? Mismo criterio que el alta desde el admin: el
  // correo en minúsculas. Si estaba, se respeta el nombre que puso el admin.
  const emailHash = sha256Hex(d.email);
  let { data: pan } = await supabaseAdmin.from('panelistas')
    .select('id, asiste_todas, activo').eq('cohorte_id', cohorteId).eq('email_hash', emailHash).maybeSingle();
  let nuevo = false;
  if (!pan) {
    const ins = await supabaseAdmin.from('panelistas').insert({
      cohorte_id: cohorteId, nombre_completo: d.nombre, email_encriptado: encryptPII(d.email), email_hash: emailHash,
      asiste_todas: d.todas, registro_por_enlace: true,
    }).select('id, asiste_todas, activo').single();
    if (ins.error && (ins.error as any).code === '23505') {
      // Dos envíos a la vez con el mismo correo: el otro ya lo creó.
      pan = (await supabaseAdmin.from('panelistas').select('id, asiste_todas, activo')
        .eq('cohorte_id', cohorteId).eq('email_hash', emailHash).maybeSingle()).data;
    } else if (ins.error) {
      return res.status(500).json({ error: 'NO_SE_PUDO_REGISTRAR' });
    } else { pan = ins.data; nuevo = true; }
  }
  if (!pan) return res.status(500).json({ error: 'NO_SE_PUDO_REGISTRAR' });
  const panelistaId = (pan as any).id as string;

  // Las elecciones se SUMAN a lo que ya tenía (como en el alterno): quien
  // confirma un bloque y luego otro queda con los dos. Quitar es cosa del admin.
  if (elegidos.length) {
    const { error: eb } = await supabaseAdmin.from('panelista_bloques')
      .upsert(elegidos.map((e) => ({ panelista_id: panelistaId, ...e })), { onConflict: 'panelista_id,jornada_id,bloque', ignoreDuplicates: true });
    if (eb) return res.status(500).json({ error: 'NO_SE_PUDO_REGISTRAR' });
    const dias = [...new Set(elegidos.map((e) => e.jornada_id))];
    const { error: ej } = await supabaseAdmin.from('panelista_jornadas')
      .upsert(dias.map((jornada_id) => ({ panelista_id: panelistaId, jornada_id })), { onConflict: 'panelista_id,jornada_id', ignoreDuplicates: true });
    if (ej) return res.status(500).json({ error: 'NO_SE_PUDO_REGISTRAR' });
  }

  if (d.logistica) {
    // Solo fechas de jornadas de esta cohorte: el resto no lo lee nadie.
    const fechas = new Set(prog.jornadas.map((j) => j.fecha));
    const soloFechas = (r?: Record<string, boolean>) => Object.fromEntries(Object.entries(r ?? {}).filter(([f]) => fechas.has(f)));
    const L = d.logistica;
    const transp = L.necesita_transporte === true;
    const { error: el } = await supabaseAdmin.from('logistica_panelista').upsert({
      panelista_id: panelistaId,
      necesita_transporte: L.necesita_transporte,
      direccion_recogida: transp ? (L.direccion_recogida || null) : null,
      hora_recogida: transp ? (L.hora_recogida || null) : null,
      transporte_por_fecha: transp ? soloFechas(L.transporte_por_fecha) : {},
      almuerzo_por_fecha: soloFechas(L.almuerzo_por_fecha),
      desayuno_por_fecha: soloFechas(L.desayuno_por_fecha),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'panelista_id' });
    if (el) return res.status(500).json({ error: 'NO_SE_PUDO_REGISTRAR' });
  }

  const ip = ipCliente(req);
  const { error: ec } = await supabaseAdmin.from('panelistas').update({
    asiste_todas: (pan as any).asiste_todas || d.todas,
    activo: true,
    confirmado: true,
    fecha_confirmacion: new Date().toISOString(),
    ip_confirmacion: ip,
  }).eq('id', panelistaId);
  if (ec) return res.status(500).json({ error: 'NO_SE_PUDO_REGISTRAR' });

  await supabaseAdmin.from('auditoria').insert({
    actor_tipo: 'anonimo', actor_id: null, accion: 'PANELISTA_CONFIRMA_POR_ENLACE',
    entidad_tipo: 'panelistas', entidad_id: panelistaId,
    detalles: { cohorte_id: cohorteId, nuevo, todas: d.todas, bloques: d.bloques, con_logistica: !!d.logistica },
    ip, user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300), timestamp: new Date().toISOString(),
  }).then(() => { /* el rastro no debe tumbar la confirmación */ }, () => { /* idem */ });

  // El correo sale después de responder: el panelista no espera al SMTP, y si
  // falla, queda sin marca de enviado y el admin lo reenvía desde la lista.
  res.json({ ok: true, nuevo });
  void enviarConfirmacion(panelistaId, prog)
    .catch((e) => console.error('[panelistas-enlace] confirmación falló:', e?.message ?? e))
    .then(() => avisarEquipo(panelistaId, prog))
    .catch((e) => console.error('[panelistas-enlace] aviso al equipo falló:', e?.message ?? e));
});

// =====================================================================
// CORREO DE CONFIRMACIÓN
// =====================================================================

function htmlConfirmacion(nombre: string, cohorte: string, asistencia: string[], logistica: string[]): string {
  const li = (xs: string[]) => xs.map((x) => `<li style="margin:4px 0;">${escaparHtml(x)}</li>`).join('');
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
      <div style="border-bottom:3px solid #e30613;padding-bottom:14px;margin-bottom:22px;">
        <p style="color:#888;text-transform:uppercase;letter-spacing:1.5px;font-size:11px;margin:0;">Panel de Evaluación — NAVES</p>
        <h2 style="color:#1a1a1a;margin:6px 0 0 0;font-size:22px;">Confirmación de asistencia</h2>
      </div>
      <p><strong>${escaparHtml(nombre)}</strong>:</p>
      <p>Gracias por acompañarnos como panelista evaluador en las presentaciones de NAVES de la cohorte
      <strong>${escaparHtml(cohorte)}</strong> del Executive MBA de INALDE. Registramos su asistencia a:</p>
      <ul style="padding-left:20px;margin:8px 0 16px;">${li(asistencia)}</ul>
      ${logistica.length ? `<p style="margin-bottom:4px;"><strong>Logística</strong></p><ul style="padding-left:20px;margin:4px 0 16px;">${li(logistica)}</ul>` : ''}
      <p style="font-size:13px;color:#555;">Si algo cambia, vuelva a abrir el enlace de la programación y confirme de nuevo con este mismo correo.</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 16px;">
      <p style="font-size:11px;color:#888;line-height:1.5;margin:0;">
        <strong>INALDE Business School</strong> — Programa MBA · NAVES<br>
        Este es un mensaje automático, por favor no responda a este correo.
      </p>
    </div>`;
}

function lineasLogistica(log: any, jornadas: JornadaBloques[]): string[] {
  if (!log) return [];
  const legible = new Map(jornadas.map((j) => [j.fecha, j.fecha_legible]));
  const dias = (r: Record<string, boolean> | null | undefined) =>
    Object.entries(r ?? {}).filter(([, v]) => v).map(([f]) => legible.get(f) ?? f);
  const out: string[] = [];
  if (log.necesita_transporte === true) {
    const ds = dias(log.transporte_por_fecha);
    out.push(`Transporte: sí${ds.length ? ` (${ds.join(', ')})` : ''}${log.direccion_recogida ? ` · recogida en ${log.direccion_recogida}` : ''}${log.hora_recogida ? ` a las ${String(log.hora_recogida).slice(0, 5)}` : ''}`);
  } else if (log.necesita_transporte === false) {
    out.push('Transporte: irá por su cuenta');
  }
  const des = dias(log.desayuno_por_fecha), alm = dias(log.almuerzo_por_fecha);
  out.push(des.length ? `Desayuno con INALDE: ${des.join(', ')}` : 'Desayuno con INALDE: no');
  out.push(alm.length ? `Almuerzo con INALDE: ${alm.join(', ')}` : 'Almuerzo con INALDE: no');
  return out;
}

// Lo que dice una confirmación, cargado una vez para los dos correos: el del
// panelista y el aviso al equipo.
async function datosConfirmacion(panelistaId: string, prog?: { jornadas: JornadaBloques[] }) {
  const { data: p } = await supabaseAdmin.from('panelistas')
    .select('id, cohorte_id, nombre_completo, email_encriptado, asiste_todas, confirmado, registro_por_enlace').eq('id', panelistaId).maybeSingle();
  if (!p) return { error: 'NOT_FOUND' as const };
  if (!(p as any).confirmado) return { error: 'SIN_CONFIRMAR' as const };
  let email = ''; try { email = decryptPII((p as any).email_encriptado); } catch { return { error: 'PII_DECRYPT_FAILED' as const }; }
  const cohorteId = (p as any).cohorte_id as string;
  const [programa, { data: bl }, { data: log }, { data: coh }] = await Promise.all([
    prog ? Promise.resolve(prog) : programacionPorBloques(cohorteId),
    supabaseAdmin.from('panelista_bloques').select('jornada_id, bloque').eq('panelista_id', panelistaId),
    supabaseAdmin.from('logistica_panelista').select('*').eq('panelista_id', panelistaId).maybeSingle(),
    supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle(),
  ]);
  const asistencia = describirAsistencia(programa.jornadas, (p as any).asiste_todas, (bl ?? []) as any[]);
  return {
    error: null,
    nombre: (p as any).nombre_completo as string,
    email, cohorteId,
    cohorte: ((coh as any)?.etiqueta ?? cohorteId) as string,
    nuevo: !!(p as any).registro_por_enlace,
    asistencia: asistencia.length ? asistencia : ['(sin bloques registrados)'],
    logistica: lineasLogistica(log, programa.jornadas),
  };
}

/** Envía (o reenvía) el correo de confirmación de un panelista. */
export async function enviarConfirmacion(panelistaId: string, prog?: { jornadas: JornadaBloques[] }): Promise<{ ok: boolean; razon?: string }> {
  const d = await datosConfirmacion(panelistaId, prog);
  if (d.error) return { ok: false, razon: d.error };
  const html = htmlConfirmacion(d.nombre, d.cohorte, d.asistencia, d.logistica);
  const r = await sendEmail(d.email, 'Confirmación de asistencia como panelista — NAVES', html);
  if (r.ok) await supabaseAdmin.from('panelistas').update({ confirmacion_enviada_at: new Date().toISOString() }).eq('id', panelistaId);
  return { ok: r.ok, razon: r.ok ? undefined : r.reason };
}

function htmlAvisoEquipo(d: { nombre: string; email: string; cohorte: string; nuevo: boolean; asistencia: string[]; logistica: string[] }): string {
  const li = (xs: string[]) => xs.map((x) => `<li style="margin:4px 0;">${escaparHtml(x)}</li>`).join('');
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
      <div style="border-bottom:3px solid #e30613;padding-bottom:14px;margin-bottom:22px;">
        <p style="color:#888;text-transform:uppercase;letter-spacing:1.5px;font-size:11px;margin:0;">Panelistas — NAVES ${escaparHtml(d.cohorte)}</p>
        <h2 style="color:#1a1a1a;margin:6px 0 0 0;font-size:22px;">Un panelista confirmó su asistencia</h2>
      </div>
      <p style="margin:0 0 4px;"><strong>${escaparHtml(d.nombre)}</strong> · <a href="mailto:${escaparHtml(d.email)}" style="color:#e30613;">${escaparHtml(d.email)}</a></p>
      ${d.nuevo ? '<p style="margin:0 0 12px;font-size:13px;color:#b45309;"><strong>Nuevo registro:</strong> no estaba en la lista de panelistas cargada.</p>' : ''}
      <p style="margin:12px 0 4px;"><strong>Asistirá a</strong></p>
      <ul style="padding-left:20px;margin:4px 0 16px;">${li(d.asistencia)}</ul>
      ${d.logistica.length ? `<p style="margin-bottom:4px;"><strong>Logística</strong></p><ul style="padding-left:20px;margin:4px 0 16px;">${li(d.logistica)}</ul>` : ''}
      <p style="font-size:13px;color:#555;">La lista completa está en el sistema, en Administración → Panelistas.</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 16px;">
      <p style="font-size:11px;color:#888;line-height:1.5;margin:0;">
        <strong>INALDE Business School</strong> — Programa MBA · NAVES<br>
        Este es un mensaje automático, por favor no responda a este correo.
      </p>
    </div>`;
}

/**
 * Avisa al equipo (sql/56: la lista «Avisar a» de la cohorte; hoy, el super
 * admin y la asistente de programa) de que un panelista confirmó. Un correo por
 * persona: nadie ve las direcciones de los demás. Un fallo no se reintenta solo
 * (la confirmación ya quedó en el sistema); se anota en el registro.
 */
async function avisarEquipo(panelistaId: string, prog: { jornadas: JornadaBloques[] }): Promise<void> {
  const d = await datosConfirmacion(panelistaId, prog);
  if (d.error) return;
  const enlace = await enlaceDeCohorte(d.cohorteId);
  const destinos = enlace?.avisar_a ?? [];
  if (!destinos.length) return;
  const html = htmlAvisoEquipo(d);
  const asunto = `Panelista confirmado: ${d.nombre} — NAVES ${d.cohorte}`;
  for (const destino of destinos) {
    const r = await sendEmail(destino, asunto, html);
    if (!r.ok) console.warn(`[panelistas-enlace] aviso al equipo falló (${destino}): ${r.reason}`);
  }
}

// =====================================================================
// ADMIN — solo super_admin
// =====================================================================

// GET /api/panelistas-enlace/admin/:cohorteId — estado del enlace y los bloques
// (para rotular lo que eligió cada panelista).
router.get('/admin/:cohorteId', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const [enlace, publicada_at, prog] = await Promise.all([
    enlaceDeCohorte(cohorteId), programacionPublicadaAt(cohorteId), programacionPorBloques(cohorteId),
  ]);
  res.json({
    enlace, publicada_at,
    bloques: prog.jornadas.map((j) => ({
      jornada_id: j.id, numero: j.numero, fecha: j.fecha, fecha_legible: j.fecha_legible,
      bloques: j.bloques.map((b) => ({ numero: b.numero, hora_inicio: b.hora_inicio, hora_fin: b.hora_fin, primer_slot: b.primer_slot, ultimo_slot: b.ultimo_slot })),
    })),
  });
});

// PUT /api/panelistas-enlace/admin/:cohorteId — activar/desactivar y vencimiento.
const enlaceSchema = z.object({ activo: z.boolean(), vence_at: z.string().datetime({ offset: true }) });
router.put('/admin/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = enlaceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  if (parsed.data.activo && new Date(parsed.data.vence_at).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'VENCE_EN_EL_PASADO', mensaje: 'La fecha de vencimiento ya pasó: elige una fecha futura para activar el enlace.' });
  }
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', req.params.cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });
  try {
    const enlace = await guardarEnlace(req.params.cohorteId, parsed.data);
    await auditarAdmin(req, 'ADMIN_ENLACE_PANELISTAS', { cohorte_id: req.params.cohorteId, activo: enlace.activo, vence_at: enlace.vence_at });
    res.json({ enlace });
  } catch (e: any) { res.status(500).json({ error: 'NO_SE_PUDO_GUARDAR', detail: e?.message }); }
});

// PUT /api/panelistas-enlace/admin/:cohorteId/avisos — a quién avisar de cada
// confirmación. Máximo 10 correos.
const avisosSchema = z.object({ avisar_a: z.array(z.string().trim().toLowerCase().email().max(200)).max(10) });
router.put('/admin/:cohorteId/avisos', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = avisosSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'CORREO_INVALIDO', mensaje: 'Revisa los correos: alguno no es válido.' });
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', req.params.cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });
  const unicos = [...new Set(parsed.data.avisar_a)];
  try {
    const enlace = await guardarAvisos(req.params.cohorteId, unicos);
    await auditarAdmin(req, 'ADMIN_ENLACE_PANELISTAS_AVISOS', { cohorte_id: req.params.cohorteId, avisar_a: unicos.length });
    res.json({ enlace });
  } catch (e: any) { res.status(500).json({ error: 'NO_SE_PUDO_GUARDAR', detail: e?.message }); }
});

// POST /api/panelistas-enlace/admin/:cohorteId/regenerar — enlace nuevo; el
// anterior deja de abrir al instante (por si se compartió donde no debía).
router.post('/admin/:cohorteId/regenerar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const actual = await enlaceDeCohorte(req.params.cohorteId);
  if (!actual) return res.status(404).json({ error: 'SIN_ENLACE' });
  try {
    const enlace = await guardarEnlace(req.params.cohorteId, { activo: actual.activo, vence_at: actual.vence_at }, true);
    await auditarAdmin(req, 'ADMIN_ENLACE_PANELISTAS_REGENERADO', { cohorte_id: req.params.cohorteId });
    res.json({ enlace });
  } catch (e: any) { res.status(500).json({ error: 'NO_SE_PUDO_GUARDAR', detail: e?.message }); }
});

// POST /api/panelistas-enlace/admin/panelista/:id/confirmacion — (re)enviar.
router.post('/admin/panelista/:id/confirmacion', ...soloAdmin, async (req, res) => {
  const r = await enviarConfirmacion(req.params.id);
  if (r.razon === 'SIN_CONFIRMAR') return res.status(409).json({ error: 'SIN_CONFIRMAR' });
  if (r.razon === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND' });
  if (!r.ok) return res.status(502).json({ error: 'ENVIO_FALLIDO', razon: r.razon });
  res.json({ ok: true });
});

// POST /api/panelistas-enlace/admin/:cohorteId/confirmaciones-pendientes —
// a los que confirmaron y todavía no tienen su correo (p. ej. falló el SMTP).
router.post('/admin/:cohorteId/confirmaciones-pendientes', ...soloAdmin, async (req, res) => {
  const { data: pend } = await supabaseAdmin.from('panelistas').select('id')
    .eq('cohorte_id', req.params.cohorteId).eq('activo', true).eq('confirmado', true).is('confirmacion_enviada_at', null);
  const ids = (pend ?? []).map((p: any) => p.id as string);
  res.json({ ok: true, total: ids.length });
  if (!ids.length) return;
  void (async () => {
    const prog = await programacionPorBloques(req.params.cohorteId);
    for (const id of ids) {
      try { await enviarConfirmacion(id, prog); }
      catch (e: any) { console.error(`[panelistas-enlace] confirmación falló para ${id}:`, e?.message ?? e); }
      await new Promise((r) => setTimeout(r, 600));
    }
  })().catch((e) => console.error('[panelistas-enlace] envío de confirmaciones falló:', e?.message ?? e));
});

async function auditarAdmin(req: AuthenticatedRequest, accion: string, detalles: Record<string, unknown>) {
  await supabaseAdmin.from('auditoria').insert({
    actor_tipo: 'super_admin', actor_id: req.user?.profesorId ?? null, accion,
    entidad_tipo: 'cohortes', entidad_id: null, detalles, timestamp: new Date().toISOString(),
  }).then(() => { /* el rastro no debe tumbar el cambio */ }, () => { /* idem */ });
}

export default router;
