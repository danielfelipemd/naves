import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { generarActasCohorte } from '../services/actas/generar.js';
import { buildActaPDF, buildLoteActasPDF } from '../services/actas/pdf-acta.js';
import { firmar, ultimoHash, verificarCadena } from '../services/actas/firma.js';
import { sha256Hex } from '../auth/crypto.js';
import { sendEmail } from '../services/email.js';
import { decryptPII } from '../auth/crypto.js';

// =====================================================================
// Actas de Entrega de Trabajo de Grado.
//
// Una acta por participante, generada sin digitación desde el cronograma y la
// sábana. La firma es PROPIA del sistema (services/actas/firma.ts): cada firma
// lleva fecha del servidor, IP, el trazo y un código encadenado sellado con
// HMAC, conforme a la Ley 527/1999 y el Decreto 2364/2012. No hay proveedor
// externo ni modo simulación.
// =====================================================================

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')];
// La impresión y el archivo en papel los hace la asistente del programa, no el
// super_admin: se le da acceso a lo suyo (ver estado y descargar), nunca a
// generar, firmar ni cambiar datos.
const adminOAsistente = [requireAuth(), requireRole('super_admin', 'asistente_programa')];

const ROLES_INTERNOS = ['profesor', 'director_proyecto', 'jurado'];

const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').trim().replace(/\/$/, '') || 'https://naves-inalde.com';

/**
 * Correo con el enlace de firma. Quien lo recibe firma dos veces al año y no
 * conoce el sistema: se le dice qué tiene que hacer, cuánto le toma y hasta
 * cuándo, sin jerga ni instrucciones de varios pasos.
 */
function plantillaFirma(nombre: string, cuantas: number, url: string): string {
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
    <div style="border-bottom:3px solid #e30613;padding-bottom:12px;margin-bottom:24px">
      <div style="font-weight:700;letter-spacing:1.5px;font-size:13px">INALDE BUSINESS SCHOOL</div>
      <div style="color:#6b6b6b;font-size:11px;text-transform:uppercase;letter-spacing:1px">Trabajo de grado · MBA</div>
    </div>
    <p style="font-size:15px">Estimado(a) <strong>${nombre}</strong>,</p>
    <p style="font-size:14px;line-height:1.6">
      Ya ${cuantas === 1 ? 'está lista un acta' : `están listas ${cuantas} actas`} de entrega de trabajo de grado
      que ${cuantas === 1 ? 'requiere su firma' : 'requieren su firma'}.
    </p>
    <p style="font-size:14px;line-height:1.6">
      Al abrir el enlace podrá <strong>leer cada acta</strong> y firmar${cuantas === 1 ? 'la' : 'las'} todas
      de una sola vez. Puede dibujar su firma, escribir su nombre o adjuntar una imagen.
    </p>
    <p style="text-align:center;margin:32px 0">
      <a href="${url}" style="background:#e30613;color:#fff;text-decoration:none;padding:14px 28px;border-radius:4px;font-weight:700;font-size:14px;display:inline-block">
        Revisar y firmar ${cuantas === 1 ? 'el acta' : `las ${cuantas} actas`}
      </a>
    </p>
    <p style="font-size:12px;color:#6b6b6b;line-height:1.6">
      El enlace es personal y vence en 7 días. Si no funciona el botón, copie esta dirección en su navegador:<br>
      <span style="word-break:break-all">${url}</span>
    </p>
    <p style="font-size:11px;color:#6b6b6b;border-top:1px solid #e8e8e8;padding-top:12px;margin-top:24px">
      Firma electrónica conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012.
      Si tiene alguna duda, escriba a la asistente del programa.
    </p>
  </div>`;
}

// Estado del acta según el avance de sus firmas (§2).
function avanzarEstado(firmas: any[], estadoActual: string): string {
  if (['faltan_datos', 'generada'].includes(estadoActual)) return estadoActual;
  const part = firmas.find((f) => f.rol === 'participante');
  const internos = firmas.filter((f) => ROLES_INTERNOS.includes(f.rol));
  const dirMba = firmas.find((f) => f.rol === 'director_mba');
  if (dirMba?.estado === 'firmada') return 'completa';
  if (internos.length && internos.every((f) => f.estado === 'firmada') && part?.estado === 'firmada') return 'lista_para_cierre';
  if (part?.estado === 'firmada') return 'en_firmas_internas';
  return 'enviada';
}

// POST /api/actas/generar/:cohorteId — genera/actualiza las actas de la cohorte.
router.post('/generar/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  try { res.json(await generarActasCohorte(req.params.cohorteId)); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? 'GENERAR_FALLO' }); }
});

// POST /api/actas/cohorte/:cohorteId/director-mba — config del Director de Cohorte.
router.post('/cohorte/:cohorteId/director-mba', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const nombre = (req.body?.nombre ?? '').trim() || null;
  const cargo = (req.body?.cargo ?? '').trim() || null;
  // El correo es necesario para mandarle su enlace de firma: el Director de Cohorte
  // firma todas las actas de la cohorte y no es un usuario del sistema.
  const email = (req.body?.email ?? '').trim() || null;
  const { error } = await supabaseAdmin.from('cohortes')
    .update({ director_mba_nombre: nombre, director_mba_cargo: cargo, director_mba_email: email })
    .eq('id', req.params.cohorteId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/actas?cohorte_id= — panel: actas + tiles + avance por firmante + pendientes.
router.get('/', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const cohorteId = String(req.query.cohorte_id ?? '').trim();
  if (!cohorteId) return res.status(400).json({ error: 'FALTA_COHORTE' });
  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta, director_mba_nombre, director_mba_cargo, director_mba_email').eq('id', cohorteId).maybeSingle();
  const { data: actas } = await supabaseAdmin.from('acta').select('*').eq('cohorte_id', cohorteId).order('nombre_participante');
  const rows = (actas ?? []) as any[];

  const porModalidad = (m: string) => rows.filter((a) => a.modalidad === m).length;
  const tiles = {
    total: rows.length,
    business_plan: porModalidad('business_plan'), caso: porModalidad('caso'), proyecto_investigacion: porModalidad('proyecto_investigacion'),
    faltan_datos: rows.filter((a) => a.estado === 'faltan_datos').length,
    firmadas_participante: rows.filter((a) => (a.firmas ?? []).find((f: any) => f.rol === 'participante')?.estado === 'firmada').length,
    firmas_internas_completas: rows.filter((a) => a.estado === 'lista_para_cierre' || a.estado === 'completa').length,
    completas: rows.filter((a) => ['completa', 'archivada'].includes(a.estado)).length,
  };

  // Avance por firmante (rol+nombre): pendientes vs firmadas de su lote.
  const firmantes = new Map<string, { rol: string; nombre: string; total: number; firmadas: number }>();
  for (const a of rows) for (const f of (a.firmas ?? []) as any[]) {
    if (f.rol === 'participante') continue; // el participante firma su propia acta, no en lote
    const key = `${f.rol}|${f.nombre ?? '—'}`;
    const g = firmantes.get(key) ?? { rol: f.rol, nombre: f.nombre ?? '—', total: 0, firmadas: 0 };
    g.total++; if (f.estado === 'firmada') g.firmadas++;
    firmantes.set(key, g);
  }

  const { data: micros } = await supabaseAdmin.from('acta_microformulario').select('*').eq('cohorte_id', cohorteId).eq('usado', false);

  res.json({
    cohorte_id: cohorteId, etiqueta: (coh as any)?.etiqueta ?? cohorteId,
    director_mba: { nombre: (coh as any)?.director_mba_nombre ?? null, cargo: (coh as any)?.director_mba_cargo ?? null, email: (coh as any)?.director_mba_email ?? null },
    tiles, actas: rows,
    firmantes: [...firmantes.values()].sort((a, b) => (a.total - a.firmadas) - (b.total - b.firmadas) === 0 ? a.rol.localeCompare(b.rol) : (b.total - b.firmadas) - (a.total - a.firmadas)),
    microformularios_pendientes: micros ?? [],
  });
});

// GET /api/actas/:id — detalle del acta (para render v3).
router.get('/:id(\\d+)', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { data } = await supabaseAdmin.from('acta').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!data) return res.status(404).json({ error: 'ACTA_NO_ENCONTRADA' });
  res.json(data);
});

// POST /api/actas/:id — captura observaciones y/o nota (único capturable a mano, en revisión).
router.post('/:id(\\d+)', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const upd: any = {};
  if (typeof req.body?.observaciones === 'string') upd.observaciones = req.body.observaciones;
  if (['aceptado', 'rechazado'].includes(req.body?.nota)) upd.nota = req.body.nota;
  if (!Object.keys(upd).length) return res.status(400).json({ error: 'NADA_QUE_ACTUALIZAR' });
  const { error } = await supabaseAdmin.from('acta').update(upd).eq('id', Number(req.params.id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// POST /api/actas/:cohorteId/enviar — envía a firma las actas 'generada' (crea sobres
// por firmante; el envío de los enlaces se hace desde /actas/enlaces/:cohorteId).
router.post('/:cohorteId/enviar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { data: listas } = await supabaseAdmin.from('acta').select('id').eq('cohorte_id', req.params.cohorteId).eq('estado', 'generada');
  const ids = ((listas ?? []) as any[]).map((a) => a.id);
  if (!ids.length) return res.json({ enviadas: 0 });
  await supabaseAdmin.from('acta').update({ estado: 'enviada', enviada_en: new Date().toISOString() }).in('id', ids);
  res.json({ enviadas: ids.length });
});

// GET /api/actas/lote/:cohorteId — actas agrupadas por firmante (para firma en lote).
router.get('/lote/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { data: actas } = await supabaseAdmin.from('acta').select('id, nombre_participante, modalidad, estado, firmas').eq('cohorte_id', req.params.cohorteId);
  const grupos = new Map<string, { rol: string; nombre: string; actas: any[] }>();
  for (const a of (actas ?? []) as any[]) for (const f of (a.firmas ?? []) as any[]) {
    if (f.rol === 'participante' || f.estado === 'firmada') continue;
    const key = `${f.rol}|${f.nombre ?? '—'}`;
    const g = grupos.get(key) ?? { rol: f.rol, nombre: f.nombre ?? '—', actas: [] as any[] };
    g.actas.push({ id: a.id, participante: a.nombre_participante, modalidad: a.modalidad, estado: a.estado });
    grupos.set(key, g);
  }
  res.json({ cohorte_id: req.params.cohorteId, firmantes: [...grupos.values()] });
});

// POST /api/actas/lote/:cohorteId/firmar — firma en lote de UN solo acto: el firmante
// (rol+nombre) firma TODAS sus actas pendientes. Con el proveedor real esto lo
// firma con el mismo sellado que el enlace público: hash encadenado + HMAC.
router.post('/lote/:cohorteId/firmar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { rol, nombre } = req.body ?? {};
  if (!rol) return res.status(400).json({ error: 'FALTA_ROL' });
  const { data: actas } = await supabaseAdmin.from('acta').select('id, estado, firmas').eq('cohorte_id', req.params.cohorteId);
  const turno = (estado: string) => rol === 'participante' ? estado === 'enviada'
    : ROLES_INTERNOS.includes(rol) ? estado === 'en_firmas_internas'
    : rol === 'director_mba' ? estado === 'lista_para_cierre' : false;

  // Firma REAL, con el mismo sellado que la del enlace público: hash encadenado
  // + HMAC. Antes esto marcaba la casilla como firmada sin sello ni trazo, así
  // que dejaba firmas que no se podían verificar.
  const ip = (req.header('x-forwarded-for')?.split(',')[0] ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '') || null;
  const ua = (req.header('user-agent') ?? '').slice(0, 300) || null;
  const imagen = typeof req.body?.imagen === 'string' ? req.body.imagen : null;
  let firmadas = 0;
  const fallidas: string[] = [];
  for (const a of (actas ?? []) as any[]) {
    if (!turno(a.estado)) continue;
    const firmas = (a.firmas ?? []) as any[];
    const idx = firmas.findIndex((x) => x.rol === rol && (nombre ? x.nombre === nombre : true) && x.estado !== 'firmada');
    if (idx < 0) continue;
    const sellada = firmar(
      { actaId: a.id, rol, nombre: nombre ?? firmas[idx].nombre ?? '', imagen, ip, userAgent: ua },
      ultimoHash(firmas),
    );
    firmas[idx] = { ...firmas[idx], ...sellada };
    const nuevoEstado = avanzarEstado(firmas, a.estado);
    // Sin mirar el {error} contábamos como firmadas actas que no se guardaron.
    const { error: upErr } = await supabaseAdmin.from('acta').update({ firmas, estado: nuevoEstado, ...(nuevoEstado === 'completa' ? { completa_en: new Date().toISOString() } : {}) }).eq('id', a.id);
    if (upErr) {
      console.error('[actas.firmar-lote] no se pudo guardar la firma del acta', a.id, upErr.message);
      fallidas.push(a.id);
      continue;
    }
    firmadas++;
  }
  // El conteo solo refleja lo realmente guardado; si algo falló se dice.
  if (fallidas.length > 0) {
    return res.status(500).json({
      error: 'FIRMA_NO_GUARDADA', firmadas, pendientes: fallidas.length,
      mensaje: `Se firmaron ${firmadas} actas, pero ${fallidas.length} no se pudieron guardar. Inténtalo de nuevo para las restantes.`,
    });
  }
  res.json({ firmadas });
});

// === Microformulario para jurados tardíos (Caso/PI) — PÚBLICO (sin login) ======
// POST admin: crea el enlace para el director del proyecto.
router.post('/micro/generar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { cohorte_id, equipo_id, proyecto_id, director_nombre, director_email } = req.body ?? {};
  if (!cohorte_id || !proyecto_id) return res.status(400).json({ error: 'FALTAN_DATOS' });
  const token = randomBytes(24).toString('hex');
  const expira = new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString();
  const { error } = await supabaseAdmin.from('acta_microformulario').insert({
    token, cohorte_id, equipo_id: equipo_id ?? null, proyecto_id, director_nombre: director_nombre ?? null, director_email: director_email ?? null, expira_en: expira,
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, token, enlace: `/actas/micro/${token}` });
});

// GET público: contexto del formulario.
router.get('/micro/:token', async (req, res) => {
  const { data: m } = await supabaseAdmin.from('acta_microformulario')
    .select('cohorte_id, proyecto_id, director_nombre, expira_en, usado').eq('token', req.params.token).maybeSingle();
  if (!m) return res.status(404).json({ error: 'ENLACE_NO_VALIDO' });
  if ((m as any).usado) return res.status(409).json({ error: 'YA_DILIGENCIADO' });
  if ((m as any).expira_en && new Date() > new Date((m as any).expira_en)) return res.status(410).json({ error: 'ENLACE_VENCIDO' });
  const { data: proy } = await supabaseAdmin.from('proyectos').select('nombre').eq('id', (m as any).proyecto_id).maybeSingle();
  // Lista de posibles jurados: panelistas de la cohorte + directores.
  const { data: panelistas } = await supabaseAdmin.from('panelistas').select('nombre_completo').eq('cohorte_id', (m as any).cohorte_id).eq('activo', true);
  res.json({
    director_nombre: (m as any).director_nombre,
    proyecto: (proy as any)?.nombre ?? '',
    sugeridos_jurados: ((panelistas ?? []) as any[]).map((p) => p.nombre_completo),
  });
});

// POST público: guarda fecha + jurados + resultado y regenera las actas del proyecto.
router.post('/micro/:token', async (req, res) => {
  const { data: m } = await supabaseAdmin.from('acta_microformulario').select('*').eq('token', req.params.token).maybeSingle();
  if (!m) return res.status(404).json({ error: 'ENLACE_NO_VALIDO' });
  if ((m as any).usado) return res.status(409).json({ error: 'YA_DILIGENCIADO' });
  const b = req.body ?? {};
  const jurados = Array.isArray(b.jurados) ? b.jurados.filter((j: any) => j?.nombre) : [];
  if (!b.fecha_sustentacion || !jurados.length || !['aceptado', 'rechazado'].includes(b.nota)) {
    return res.status(400).json({ error: 'DATOS_INCOMPLETOS', mensaje: 'Fecha, al menos un jurado y el resultado son obligatorios.' });
  }
  const datos = { fecha_sustentacion: b.fecha_sustentacion, jurados, nota: b.nota };
  const { error } = await supabaseAdmin.from('acta_microformulario')
    .update({ usado: true, diligenciado_por: (m as any).director_nombre ?? 'director', diligenciado_en: new Date().toISOString(), datos })
    .eq('id', (m as any).id);
  if (error) return res.status(500).json({ error: error.message });
  // Regenerar las actas de la cohorte para que tomen los datos capturados.
  try { await generarActasCohorte((m as any).cohorte_id); } catch { /* best effort */ }
  res.json({ ok: true });
});

// POST /api/actas/:cohorteId/archivar — marca las completas como archivadas.
// El PDF con las firmas y su certificado lo genera el propio sistema
// (GET /actas/:id/pdf y el lote); aquí solo se cierra el ciclo de la cohorte.
router.post('/:cohorteId/archivar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { data: completas } = await supabaseAdmin.from('acta').select('id').eq('cohorte_id', req.params.cohorteId).eq('estado', 'completa');
  const ids = ((completas ?? []) as any[]).map((a) => a.id);
  if (ids.length) await supabaseAdmin.from('acta').update({ estado: 'archivada' }).in('id', ids);
  res.json({ archivadas: ids.length });
});


// GET /api/actas/:id/pdf — el acta en PDF, lista para imprimir y archivar.
router.get('/:id(\\d+)/pdf', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { data: a } = await supabaseAdmin.from('acta').select('*').eq('id', req.params.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'NO_ENCONTRADA' });
  const pdf = await buildActaPDF(a as any);
  const nombre = String((a as any).nombre_participante ?? req.params.id).replace(/[^a-zA-Z0-9]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="acta-${nombre}.pdf"`);
  res.send(pdf);
});


// =====================================================================
// FIRMA ELECTRÓNICA — enlaces de alcance cerrado
//
// Un enlace de firma NO es una sesión. Solo permite ver y firmar las actas
// que tiene asignadas; cualquier otra operación del sistema le está vedada,
// porque estos endpoints no pasan por requireAuth ni miran req.user. Aunque
// el correo se filtre, con ese enlace no se puede tocar nada más.
// =====================================================================

/** Datos mínimos del acta que ve quien va a firmar. Nada de PII de terceros. */
const CAMPOS_FIRMANTE = 'id, nombre_participante, nombre_proyecto, modalidad, fecha_sustentacion, nota, estado, firmas';

/**
 * Igual que abrirEnlace pero sin exigir que el enlace siga sin usar: quien ya
 * firmó puede volver a leer lo que firmó, que es lo razonable.
 */
async function abrirEnlaceParaLectura(token: string, res: any) {
  const { data: e } = await supabaseAdmin.from('acta_enlace_firma')
    .select('*').eq('token_hash', sha256Hex(token)).maybeSingle();
  if (!e) { res.status(404).json({ error: 'ENLACE_NO_VALIDO' }); return null; }
  const en = e as any;
  if (en.revocado) { res.status(410).json({ error: 'ENLACE_REVOCADO' }); return null; }
  if (new Date() > new Date(en.expira_en)) { res.status(410).json({ error: 'ENLACE_VENCIDO' }); return null; }
  return en;
}

/** Carga y valida el enlace. Devuelve null y responde el error si no sirve. */
async function abrirEnlace(token: string, res: any) {
  const { data: e } = await supabaseAdmin.from('acta_enlace_firma')
    .select('*').eq('token_hash', sha256Hex(token)).maybeSingle();
  if (!e) { res.status(404).json({ error: 'ENLACE_NO_VALIDO' }); return null; }
  const en = e as any;
  if (en.revocado) { res.status(410).json({ error: 'ENLACE_REVOCADO' }); return null; }
  if (en.usado_en) { res.status(409).json({ error: 'YA_FIRMADO' }); return null; }
  if (new Date() > new Date(en.expira_en)) { res.status(410).json({ error: 'ENLACE_VENCIDO' }); return null; }
  // Tras varios intentos fallidos de identidad, el enlace se cierra: evita
  // que alguien con el correo pruebe documentos hasta acertar.
  if (en.intentos_fallidos >= 5) { res.status(429).json({ error: 'ENLACE_BLOQUEADO' }); return null; }
  return en;
}

const ipDe = (req: any) => (req.header('x-forwarded-for')?.split(',')[0] ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '') || null;

// POST /api/actas/enlaces/:cohorteId — el admin crea los enlaces de firma.
// Agrupa por firmante: un enlace por persona con TODAS sus actas pendientes.
router.post('/enlaces/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const soloRoles: string[] = Array.isArray(req.body?.roles) ? req.body.roles : [];
  const { data: actas } = await supabaseAdmin.from('acta')
    .select('id, firmas, estado').eq('cohorte_id', req.params.cohorteId);

  const grupos = new Map<string, { rol: string; nombre: string; actaIds: number[] }>();
  for (const a of (actas ?? []) as any[]) {
    if (a.estado === 'faltan_datos') continue;
    for (const f of (a.firmas ?? []) as any[]) {
      if (f.estado === 'firmada' || f.rol === 'participante') continue;
      if (soloRoles.length && !soloRoles.includes(f.rol)) continue;
      if (!f.nombre) continue;
      const key = `${f.rol}|${f.nombre}`;
      const g = grupos.get(key) ?? { rol: f.rol as string, nombre: f.nombre as string, actaIds: [] as number[] };
      g.actaIds.push(a.id);
      grupos.set(key, g);
    }
  }

  // Correos de quienes van a firmar: profesores y directores de proyecto están
  // en tablas distintas y con el correo cifrado.
  const emailPorNombre = new Map<string, string>();
  for (const t of ['profesores', 'directores'] as const) {
    const { data } = await supabaseAdmin.from(t).select('nombre_completo, email_encriptado');
    for (const r of ((data ?? []) as any[])) {
      try {
        const mail = r.email_encriptado ? decryptPII(r.email_encriptado) : null;
        if (mail) emailPorNombre.set(r.nombre_completo, mail);
      } catch { /* un correo ilegible no debe frenar la creación de enlaces */ }
    }
  }

  // El Director de Cohorte no es un usuario del sistema: su nombre y su correo se
  // configuran en la cohorte. Sin esto no hay a dónde mandarle su enlace,
  // aunque firma todas las actas.
  const { data: coh } = await supabaseAdmin.from('cohortes')
    .select('director_mba_nombre, director_mba_email').eq('id', req.params.cohorteId).maybeSingle();
  const dirMba = coh as any;
  if (dirMba?.director_mba_nombre && dirMba?.director_mba_email) {
    emailPorNombre.set(dirMba.director_mba_nombre, dirMba.director_mba_email);
  }

  const enviar = req.body?.enviar_correo !== false;
  const creados: any[] = [];
  for (const g of grupos.values()) {
    const token = randomBytes(32).toString('base64url');
    const { error } = await supabaseAdmin.from('acta_enlace_firma').insert({
      token_hash: sha256Hex(token),
      cohorte_id: req.params.cohorteId,
      rol: g.rol, firmante_nombre: g.nombre,
      firmante_email: emailPorNombre.get(g.nombre) ?? null,
      acta_ids: g.actaIds,
      // 7 días: suficiente para firmar sin dejar la puerta abierta un mes.
      expira_en: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      creado_por: req.user?.profesorId ?? null,
    });
    if (error) return res.status(500).json({ error: error.message });
    const email = emailPorNombre.get(g.nombre) ?? null;
    let correo: string | null = null;
    if (enviar && email) {
      const url = `${PUBLIC_URL}/actas/firmar/${token}`;
      const n = g.actaIds.length;
      const r = await sendEmail(
        email,
        `Actas por firmar — Trabajo de Grado MBA (${n})`,
        plantillaFirma(g.nombre, n, url),
      );
      correo = r.ok ? 'enviado' : (r.reason ?? 'no enviado');
    }
    creados.push({
      rol: g.rol, nombre: g.nombre, actas: g.actaIds.length,
      email, correo, enlace: `/actas/firmar/${token}`,
    });
  }
  res.json({ creados: creados.length, enlaces: creados });
});

// GET /api/actas/firmar/:token — PÚBLICO. Lo que ve el firmante: sus actas y
// nada más. No entrega datos de otras cohortes ni del resto del sistema.
router.get('/firmar/:token', async (req, res) => {
  const e = await abrirEnlace(req.params.token, res);
  if (!e) return;
  const { data: actas } = await supabaseAdmin.from('acta')
    .select(CAMPOS_FIRMANTE).in('id', e.acta_ids);
  res.json({
    firmante: { nombre: e.firmante_nombre, rol: e.rol },
    requiere_verificacion: !!e.verificacion_hash,
    expira_en: e.expira_en,
    actas: ((actas ?? []) as any[]).map((a) => ({
      id: a.id, participante: a.nombre_participante, proyecto: a.nombre_proyecto,
      modalidad: a.modalidad, fecha_sustentacion: a.fecha_sustentacion, nota: a.nota,
    })),
  });
});

// POST /api/actas/firmar/:token — PÚBLICO. Firma TODAS las actas del enlace
// en un solo acto. Es lo único que este enlace puede hacer.
router.post('/firmar/:token', async (req, res) => {
  const e = await abrirEnlace(req.params.token, res);
  if (!e) return;

  // Comprobación de identidad: el enlace filtrado no basta por sí solo.
  if (e.verificacion_hash) {
    const dado = String(req.body?.verificacion ?? '').trim();
    if (!dado || sha256Hex(dado) !== e.verificacion_hash) {
      await supabaseAdmin.from('acta_enlace_firma')
        .update({ intentos_fallidos: (e.intentos_fallidos ?? 0) + 1, ultimo_ip: ipDe(req) })
        .eq('id', e.id);
      return res.status(403).json({ error: 'VERIFICACION_INCORRECTA' });
    }
  }

  const imagen = typeof req.body?.imagen === 'string' ? req.body.imagen : null;
  if (!imagen) return res.status(400).json({ error: 'FALTA_FIRMA', mensaje: 'Dibuja, escribe o adjunta tu firma.' });
  // Una firma es una imagen pequeña; el tope evita que alguien empuje un
  // archivo enorme por este endpoint público.
  if (imagen.length > 500_000) return res.status(413).json({ error: 'FIRMA_DEMASIADO_GRANDE' });

  const { data: actas } = await supabaseAdmin.from('acta')
    .select('id, estado, firmas').in('id', e.acta_ids);

  const ip = ipDe(req);
  const ua = (req.header('user-agent') ?? '').slice(0, 300) || null;
  let firmadas = 0;
  // Actas cuyo guardado falló. Si queda alguna NO cerramos el enlace: el
  // firmante debe poder reintentar. Un update de supabase-js no lanza, devuelve
  // {error}: sin mirarlo contábamos como firmada un acta que nunca se guardó,
  // marcábamos el enlace como usado y el reintento moría en 409 YA_FIRMADO,
  // dejando el acta sin firma y la cadena de hash con un hueco.
  const fallidas: string[] = [];

  for (const a of (actas ?? []) as any[]) {
    const firmas = (a.firmas ?? []) as any[];
    // Solo la casilla que corresponde a ESTE firmante. El enlace no sirve
    // para firmar en nombre de otro rol ni de otra persona.
    const idx = firmas.findIndex((f) => f.rol === e.rol && f.nombre === e.firmante_nombre && f.estado !== 'firmada');
    if (idx < 0) continue;
    const sellada = firmar(
      { actaId: a.id, rol: e.rol, nombre: e.firmante_nombre, imagen, ip, userAgent: ua },
      ultimoHash(firmas),
    );
    firmas[idx] = { ...firmas[idx], ...sellada };
    const nuevoEstado = avanzarEstado(firmas, a.estado);
    const { error: upErr } = await supabaseAdmin.from('acta').update({
      firmas, estado: nuevoEstado,
      ...(nuevoEstado === 'completa' ? { completa_en: new Date().toISOString() } : {}),
    }).eq('id', a.id);
    if (upErr) {
      console.error('[actas.firmar] no se pudo guardar la firma del acta', a.id, upErr.message);
      fallidas.push(a.id);
      continue;
    }
    firmadas++;
  }

  // El enlace solo se quema si TODAS las actas quedaron guardadas. Las que ya
  // se firmaron no se repiten: el findIndex de arriba salta las 'firmada'.
  if (fallidas.length > 0) {
    await supabaseAdmin.from('acta_enlace_firma')
      .update({ ultimo_ip: ip, ultimo_user_agent: ua })
      .eq('id', e.id);
    return res.status(500).json({
      error: 'FIRMA_NO_GUARDADA',
      firmadas,
      pendientes: fallidas.length,
      mensaje: firmadas > 0
        ? `Guardamos ${firmadas} de tus actas, pero ${fallidas.length} no quedaron firmadas. Tu enlace sigue activo: vuelve a intentarlo en unos minutos.`
        : 'No pudimos registrar tu firma. Tu enlace sigue activo: vuelve a intentarlo en unos minutos.',
    });
  }

  const { error: enlaceErr } = await supabaseAdmin.from('acta_enlace_firma')
    .update({ usado_en: new Date().toISOString(), ultimo_ip: ip, ultimo_user_agent: ua })
    .eq('id', e.id);
  // Las firmas ya están guardadas: esto solo cierra el enlace. Si falla, el
  // firmante podrá reabrirlo y verá sus actas ya firmadas (no se duplican).
  if (enlaceErr) console.error('[actas.firmar] no se pudo marcar el enlace como usado', e.id, enlaceErr.message);

  res.json({ ok: true, firmadas });
});

// GET /api/actas/firmar/:token/acta/:actaId/pdf — PÚBLICO. El PDF del acta
// que el firmante va a firmar. Nadie debería firmar una lista a ciegas: aquí
// lee el documento completo antes de estampar su firma. Solo entrega las actas
// de SU enlace; cualquier otro id se rechaza.
router.get('/firmar/:token/acta/:actaId/pdf', async (req, res) => {
  const e = await abrirEnlaceParaLectura(req.params.token, res);
  if (!e) return;
  const actaId = Number(req.params.actaId);
  if (!e.acta_ids.includes(actaId)) return res.status(403).json({ error: 'ACTA_FUERA_DEL_ENLACE' });

  const { data: a } = await supabaseAdmin.from('acta').select('*').eq('id', actaId).maybeSingle();
  if (!a) return res.status(404).json({ error: 'NO_ENCONTRADA' });
  const pdf = await buildActaPDF(a as any);
  res.setHeader('Content-Type', 'application/pdf');
  // inline: se abre en el visor del navegador, no se descarga. El firmante
  // lo lee ahí mismo sin salir de la pantalla de firma.
  res.setHeader('Content-Disposition', 'inline; filename="acta.pdf"');
  res.send(pdf);
});


// =====================================================================
// ENTREGA A LA ASISTENTE — impresión por lotes
//
// Las 64 actas de Business Plan se cierran rápido (las firman 3 profesores y
// el Director de Cohorte, en bloque); las de Caso dependen de varios directores y de
// sus tribunales, así que llegan más tarde. Por eso se entrega POR LOTES: lo
// que ya está firmado se imprime sin esperar a lo que falta.
// =====================================================================

/** Nombre legible de cada rol, para decir a quién se está esperando. */
const ROL_LEGIBLE: Record<string, string> = {
  participante: 'el participante',
  profesor: 'el profesor',
  director_proyecto: 'el director del proyecto',
  jurado: 'los jurados',
  director_mba: 'el Director de Cohorte',
};

// GET /api/actas/candidatos-director-mba — quiénes pueden firmar el cierre.
// Se ofrece elegir en vez de teclear el nombre: escribirlo a mano es como se
// llegó a tener "Álvaro Moreno García" en la cohorte y "Álvaro José Moreno
// García" en la tabla, que son la misma persona con dos textos distintos.
router.get('/candidatos-director-mba', ...soloAdmin, async (_req: AuthenticatedRequest, res) => {
  const salida: Array<{ nombre: string; email: string | null; origen: string }> = [];

  // OJO: el "director de cohorte" (quien firma el cierre) NO es lo mismo que el
  // "director de proyecto" de un Caso o un Proyecto de Investigación. Aquí solo
  // se ofrece a quien puede firmar el cierre de TODA la cohorte.
  //
  // Ser director de cohorte es un ENCARGO que el super admin asigna, no algo
  // que se pueda deducir de "estar en la tabla de profesores". Deducirlo es lo
  // que llenaba el desplegable con 22-24 nombres, incluidas las cuentas de
  // prueba y el propio super admin. Ahora manda la marca puede_dirigir_cohorte,
  // que se administra en Profesores y en Directores (migración 46).
  const [profs, dirs] = await Promise.all([
    supabaseAdmin.from('profesores')
      .select('nombre_completo, email_encriptado, puede_dirigir_cohorte')
      .eq('activo', true).eq('tipo', 'profesor').eq('es_super_admin', false),
    supabaseAdmin.from('directores')
      .select('nombre_completo, email_encriptado, puede_dirigir_cohorte')
      .eq('estado', 'activo'),
  ]);

  const marcados = [
    ...((dirs.data ?? []) as any[]).filter((r) => r.puede_dirigir_cohorte),
    ...((profs.data ?? []) as any[]).filter((r) => r.puede_dirigir_cohorte),
  ].length;

  // Si todavía nadie está marcado, se ofrece la lista completa en vez de un
  // desplegable vacío: así el módulo sigue usable mientras se asignan los
  // encargos, y el aviso de abajo explica cómo dejar la lista corta.
  const filtrar = marcados > 0;

  // Los directores van primero: si alguien está en las dos tablas se queda con
  // el origen "Director", que es el que corresponde para firmar el cierre.
  const vistos = new Set<string>();
  for (const [data, origen] of [[dirs.data, 'Director'], [profs.data, 'Profesor']] as const) {
    for (const r of ((data ?? []) as any[])) {
      if (filtrar && !r.puede_dirigir_cohorte) continue;
      const nombre = (r.nombre_completo ?? '').trim();
      if (!nombre) continue;
      const clave = nombre.toLocaleLowerCase('es');
      if (vistos.has(clave)) continue;   // sin repetir a la misma persona
      vistos.add(clave);
      let email: string | null = null;
      try { email = r.email_encriptado ? decryptPII(r.email_encriptado) : null; } catch { /* ilegible */ }
      salida.push({ nombre, email, origen });
    }
  }

  salida.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  res.json({ candidatos: salida, sin_asignar: !filtrar });
});

// GET /api/actas/lotes/:cohorteId — semáforo de impresión.
router.get('/lotes/:cohorteId', ...adminOAsistente, async (req: AuthenticatedRequest, res) => {
  const { data: actas } = await supabaseAdmin.from('acta')
    .select('id, nombre_participante, modalidad, estado, firmas, completa_en')
    .eq('cohorte_id', req.params.cohorteId);

  const completas: any[] = [];
  const pendientes: any[] = [];
  const esperandoA = new Map<string, number>();

  for (const a of (actas ?? []) as any[]) {
    if (a.estado === 'faltan_datos') continue;
    const firmas = (a.firmas ?? []) as any[];
    const faltan = firmas.filter((f) => f.estado !== 'firmada');
    const fila = {
      id: a.id, participante: a.nombre_participante, modalidad: a.modalidad,
      estado: a.estado, completa_en: a.completa_en,
    };
    if (!faltan.length) { completas.push(fila); continue; }
    pendientes.push({ ...fila, faltan: faltan.map((f) => ({ rol: f.rol, nombre: f.nombre })) });
    for (const f of faltan) {
      // Se agrupa por PERSONA: "esperando a Fulano (12 actas)" es accionable;
      // "esperando 12 firmas" no dice a quién hay que perseguir.
      const clave = f.nombre ? `${ROL_LEGIBLE[f.rol] ?? f.rol}: ${f.nombre}` : (ROL_LEGIBLE[f.rol] ?? f.rol);
      esperandoA.set(clave, (esperandoA.get(clave) ?? 0) + 1);
    }
  }

  // Lotes por modalidad: es como se imprimen y archivan en papel.
  const porModalidad = (lista: any[]) => {
    const m = new Map<string, number>();
    for (const x of lista) m.set(x.modalidad, (m.get(x.modalidad) ?? 0) + 1);
    return [...m.entries()].map(([modalidad, total]) => ({ modalidad, total }));
  };

  res.json({
    cohorte_id: req.params.cohorteId,
    listas: { total: completas.length, por_modalidad: porModalidad(completas), actas: completas },
    pendientes: {
      total: pendientes.length,
      esperando: [...esperandoA.entries()]
        .map(([quien, actas]) => ({ quien, actas }))
        .sort((a, b) => b.actas - a.actas),
      actas: pendientes,
    },
  });
});

// GET /api/actas/lotes/:cohorteId/pdf — un solo PDF con todas las actas
// completas, una por página, listo para mandar a la impresora.
router.get('/lotes/:cohorteId/pdf', ...adminOAsistente, async (req: AuthenticatedRequest, res) => {
  const modalidad = String(req.query.modalidad ?? '').trim();
  let q = supabaseAdmin.from('acta').select('*').eq('cohorte_id', req.params.cohorteId);
  if (modalidad) q = q.eq('modalidad', modalidad);
  const { data: actas } = await q;

  // Solo las que tienen TODAS las firmas: imprimir un acta a medias obligaría
  // a reimprimirla, y en papel eso significa rehacer la carpeta.
  const completas = ((actas ?? []) as any[])
    .filter((a) => a.estado !== 'faltan_datos'
      && ((a.firmas ?? []) as any[]).length > 0
      && ((a.firmas ?? []) as any[]).every((f) => f.estado === 'firmada'))
    .sort((a, b) => String(a.nombre_participante ?? '').localeCompare(String(b.nombre_participante ?? ''), 'es'));

  if (!completas.length) {
    return res.status(404).json({ error: 'SIN_ACTAS_COMPLETAS', mensaje: 'Todavía no hay actas con todas las firmas.' });
  }

  const pdf = await buildLoteActasPDF(completas as any[]);
  const sufijo = modalidad ? `-${modalidad}` : '';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="actas-${req.params.cohorteId}${sufijo}.pdf"`);
  res.send(pdf);
});

// GET /api/actas/:id(\\d+)/verificar — comprueba que la cadena de firmas no
// fue alterada. Dice exactamente dónde se rompe, si se rompe.
router.get('/:id(\\d+)/verificar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { data: a } = await supabaseAdmin.from('acta').select('id, firmas').eq('id', req.params.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'NO_ENCONTRADA' });
  res.json(verificarCadena((a as any).id, (a as any).firmas ?? []));
});

export default router;
