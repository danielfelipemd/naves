import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { generarActasCohorte } from '../services/actas/generar.js';
import { proveedorActivo } from '../services/actas/proveedor-firma.js';

// =====================================================================
// Actas de Grado — /admin/programacion → Actas. Máquina de estados + firma en
// lote de un solo acto. El conector del proveedor de firma es un STUB hasta que
// se confirme el proveedor (ver services/actas/proveedor-firma.ts); el resto
// (generación, panel, microformulario, estados, archivo) opera completo.
// =====================================================================

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')];

const ROLES_INTERNOS = ['profesor', 'director_proyecto', 'jurado'];

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

// POST /api/actas/cohorte/:cohorteId/director-mba — config del Director MBA.
router.post('/cohorte/:cohorteId/director-mba', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const nombre = (req.body?.nombre ?? '').trim() || null;
  const cargo = (req.body?.cargo ?? '').trim() || null;
  const { error } = await supabaseAdmin.from('cohortes').update({ director_mba_nombre: nombre, director_mba_cargo: cargo }).eq('id', req.params.cohorteId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/actas?cohorte_id= — panel: actas + tiles + avance por firmante + pendientes.
router.get('/', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const cohorteId = String(req.query.cohorte_id ?? '').trim();
  if (!cohorteId) return res.status(400).json({ error: 'FALTA_COHORTE' });
  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta, director_mba_nombre, director_mba_cargo').eq('id', cohorteId).maybeSingle();
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
    director_mba: { nombre: (coh as any)?.director_mba_nombre ?? null, cargo: (coh as any)?.director_mba_cargo ?? null },
    tiles, actas: rows,
    firmantes: [...firmantes.values()].sort((a, b) => (a.total - a.firmadas) - (b.total - b.firmadas) === 0 ? a.rol.localeCompare(b.rol) : (b.total - b.firmadas) - (a.total - a.firmadas)),
    microformularios_pendientes: micros ?? [],
    proveedor_firma: { nombre: proveedorActivo.nombre, es_stub: proveedorActivo.esStub },
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
// por firmante vía el proveedor; con el stub solo cambia el estado a 'enviada').
router.post('/:cohorteId/enviar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { data: listas } = await supabaseAdmin.from('acta').select('id').eq('cohorte_id', req.params.cohorteId).eq('estado', 'generada');
  const ids = ((listas ?? []) as any[]).map((a) => a.id);
  if (!ids.length) return res.json({ enviadas: 0, proveedor: proveedorActivo.nombre });
  await supabaseAdmin.from('acta').update({ estado: 'enviada', enviada_en: new Date().toISOString() }).in('id', ids);
  res.json({ enviadas: ids.length, proveedor: proveedorActivo.nombre, es_stub: proveedorActivo.esStub });
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
  res.json({ cohorte_id: req.params.cohorteId, proveedor: { nombre: proveedorActivo.nombre, es_stub: proveedorActivo.esStub }, firmantes: [...grupos.values()] });
});

// POST /api/actas/lote/:cohorteId/firmar — firma en lote de UN solo acto: el firmante
// (rol+nombre) firma TODAS sus actas pendientes. Con el proveedor real esto lo
// dispara el webhook; con el stub se marca aquí para operar de punta a punta.
router.post('/lote/:cohorteId/firmar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { rol, nombre } = req.body ?? {};
  if (!rol) return res.status(400).json({ error: 'FALTA_ROL' });
  const { data: actas } = await supabaseAdmin.from('acta').select('id, estado, firmas').eq('cohorte_id', req.params.cohorteId);
  const turno = (estado: string) => rol === 'participante' ? estado === 'enviada'
    : ROLES_INTERNOS.includes(rol) ? estado === 'en_firmas_internas'
    : rol === 'director_mba' ? estado === 'lista_para_cierre' : false;

  const sobre = await proveedorActivo.crearSobreLote({ rol, nombre: nombre ?? '', email: null }, ((actas ?? []) as any[]).map((a) => a.id));
  const ahora = new Date().toISOString();
  let firmadas = 0;
  for (const a of (actas ?? []) as any[]) {
    if (!turno(a.estado)) continue;
    const firmas = (a.firmas ?? []) as any[];
    const f = firmas.find((x) => x.rol === rol && (nombre ? x.nombre === nombre : true) && x.estado !== 'firmada');
    if (!f) continue;
    f.estado = 'firmada'; f.firmada_en = ahora; f.fecha = ahora; f.certificado = { sobre: sobre.sobreId, proveedor: proveedorActivo.nombre };
    const nuevoEstado = avanzarEstado(firmas, a.estado);
    await supabaseAdmin.from('acta').update({ firmas, estado: nuevoEstado, ...(nuevoEstado === 'completa' ? { completa_en: ahora } : {}) }).eq('id', a.id);
    firmadas++;
  }
  res.json({ firmadas, sobre: sobre.sobreId, es_stub: proveedorActivo.esStub });
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
// (El PDF certificado de archivo lo entrega el proveedor de firma; con el stub se
// registra el archivo lógico. El paquete a OneDrive reutiliza el mecanismo de AoL.)
router.post('/:cohorteId/archivar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const { data: completas } = await supabaseAdmin.from('acta').select('id').eq('cohorte_id', req.params.cohorteId).eq('estado', 'completa');
  const ids = ((completas ?? []) as any[]).map((a) => a.id);
  if (ids.length) await supabaseAdmin.from('acta').update({ estado: 'archivada' }).in('id', ids);
  res.json({ archivadas: ids.length, nota: proveedorActivo.esStub ? 'Archivo lógico (PDF certificado pendiente del proveedor de firma).' : 'Archivadas.' });
});

export default router;
