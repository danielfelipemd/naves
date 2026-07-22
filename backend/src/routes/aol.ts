import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { proyectosFase2 } from '../services/proyectos-fase2.js';
import { analizarProyecto } from '../services/aol/pipeline.js';
import { firmarCalificacion } from '../services/aol/firma.js';
import { generarReporteWord, generarReporteExcel, generarPaqueteCierre } from '../services/aol/export.js';
import { generarLecturaImpacto } from '../services/aol/impacto.js';
import { config } from '../config.js';

// =====================================================================
// Módulo AoL (Assurance of Learning) — Fase 2: pantalla Trabajos (§6).
//
// Lista los trabajos (Business Plan definitivos) de una cohorte con: integrantes,
// estado de ENTREGA (los 4 archivos: BP.pdf + one-pager + logo + modelo .xlsx),
// estado del ANÁLISIS IA (aol_analisis) y estado AoL (aol_calificacion firmada).
//
// Datos AoL viven en la MISMA base de la plataforma (opción B), así que se leen
// con supabaseAdmin. Solo super_admin (Director NAVES) por ahora; el acceso de
// profesor (solo sus trabajos) se agrega en una fase posterior.
// =====================================================================

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')];

// Estado de las corridas del pipeline (§7) en curso. Vive en memoria del proceso:
// el análisis tarda 1-2 min (Opus + reintento R1), más que cualquier timeout HTTP,
// así que NO se puede resolver dentro del request. El POST dispara la corrida en
// segundo plano y el cliente sondea GET .../estado. Tras un reinicio del proceso el
// mapa se vacía (estado 'inactivo') y el cliente simplemente recarga la pantalla.
type JobAnalisis = { estado: 'procesando' | 'listo' | 'error'; error?: string; bloqueado?: boolean };
const analisisJobs = new Map<string, JobAnalisis>();

// Nombre legible del usuario que firma (para medicion.autor / aol_calificacion.autor).
// Se resuelve server-side desde la BD (no se confía en el cliente); el id no lo
// conoce nadie salvo el sistema, por eso se guarda el nombre completo (QA #4).
async function nombreAutor(req: AuthenticatedRequest): Promise<string> {
  const u = req.user!;
  if (u.profesorId) {
    const { data } = await supabaseAdmin.from('profesores').select('nombre_completo').eq('id', u.profesorId).maybeSingle();
    if ((data as any)?.nombre_completo) return (data as any).nombre_completo;
  }
  if (u.participanteId) {
    const { data } = await supabaseAdmin.from('participantes_lista').select('nombre_completo').eq('id', u.participanteId).maybeSingle();
    if ((data as any)?.nombre_completo) return (data as any).nombre_completo;
  }
  return u.sub ?? 'Administrador NAVES';
}

// GET /api/aol/trabajos?cohorte_id=<id> — trabajos por calificar de la cohorte.
router.get('/trabajos', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const cohorteId = String(req.query.cohorte_id ?? '').trim();
  if (!cohorteId) return res.status(400).json({ error: 'FALTA_COHORTE' });

  const { data: coh } = await supabaseAdmin
    .from('cohortes').select('id, etiqueta').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });

  const pf = await proyectosFase2(cohorteId);
  const entradas = [...pf.values()];
  const proyIds = entradas.map((e) => e.proyecto_id);
  const equipoIds = [...new Set(entradas.map((e) => e.equipo_id))];

  const [cont, antes, analisis, califs] = await Promise.all([
    proyIds.length
      ? supabaseAdmin.from('proyecto_contenido').select('proyecto_id, one_pager_path, logo_path, modelo_financiero_path').in('proyecto_id', proyIds)
      : Promise.resolve({ data: [] as any[] }),
    equipoIds.length
      ? supabaseAdmin.from('anteproyectos').select('equipo_id, archivo_proyecto_final_path').in('equipo_id', equipoIds)
      : Promise.resolve({ data: [] as any[] }),
    proyIds.length
      ? supabaseAdmin.from('aol_analisis').select('proyecto_plataforma_id, estado, resultado').in('proyecto_plataforma_id', proyIds)
      : Promise.resolve({ data: [] as any[] }),
    proyIds.length
      ? supabaseAdmin.from('aol_calificacion').select('proyecto_plataforma_id').in('proyecto_plataforma_id', proyIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const contById = new Map(((cont.data ?? []) as any[]).map((x) => [x.proyecto_id, x]));
  const bpByEquipo = new Map(((antes.data ?? []) as any[]).map((x) => [x.equipo_id, x.archivo_proyecto_final_path]));
  const sugerenciaSet = new Set(((analisis.data ?? []) as any[]).filter((a) => a.estado === 'sugerencia').map((a) => a.proyecto_plataforma_id));
  // "Revisar": el análisis tiene ítems de confianza baja o citas rechazadas por R1
  // (necesitan atención humana antes de calificar).
  const revisarSet = new Set(((analisis.data ?? []) as any[])
    .filter((a) => a.estado === 'sugerencia' && Array.isArray(a.resultado?.traits) && a.resultado.traits.some((t: any) => t.confianza === 'baja'))
    .map((a) => a.proyecto_plataforma_id));
  const califSet = new Set(((califs.data ?? []) as any[]).map((c) => c.proyecto_plataforma_id));

  const trabajos = entradas.map((e) => {
    const ct = contById.get(e.proyecto_id);
    const entrega = {
      bp: !!bpByEquipo.get(e.equipo_id),
      one_pager: !!ct?.one_pager_path,
      logo: !!ct?.logo_path,
      modelo: !!ct?.modelo_financiero_path,
    };
    const completa = entrega.bp && entrega.one_pager && entrega.logo && entrega.modelo;
    // Estado análisis: hay sugerencia guardada → 'sugerencia'; entrega completa
    // pero sin análisis → 'en_cola' (lo dispara la Fase 3); si no, 'sin_entrega'.
    const estado_analisis = revisarSet.has(e.proyecto_id)
      ? 'revisar'
      : sugerenciaSet.has(e.proyecto_id) ? 'sugerencia' : completa ? 'en_cola' : 'sin_entrega';
    const estado_aol = califSet.has(e.proyecto_id) ? 'calificado' : 'pendiente';
    return {
      proyecto_id: e.proyecto_id,
      proyecto: e.proyecto,
      integrantes: e.autores ?? '',
      entrega, completa, estado_analisis, estado_aol,
    };
  }).sort((a, b) => a.proyecto.localeCompare(b.proyecto));

  const por_calificar = trabajos.filter((t) => t.estado_aol === 'pendiente').length;
  res.json({ cohorte_id: cohorteId, etiqueta: (coh as any).etiqueta ?? cohorteId, por_calificar, trabajos });
});

// POST /api/aol/analizar/:proyectoId — dispara el pipeline calificador (§7) para
// un trabajo. Descarga BP.pdf + modelo .xlsx, corre quick-screen + IA + R1 y
// guarda aol_analisis (descartando el análisis previo). "Re-analizar" del Director
// / disparo al completar entrega.
//
// La corrida es LENTA (1-2 min: Opus + reintento R1), más que cualquier timeout
// HTTP, así que se ejecuta en SEGUNDO PLANO: respondemos 202 al instante y el
// cliente sondea GET .../estado hasta que termina. Idempotente: si ya hay una
// corrida en curso para el trabajo, no arranca otra.
router.post('/analizar/:proyectoId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  if (!config.anthropic.apiKey) {
    return res.status(503).json({ error: 'IA_NO_CONFIGURADA', mensaje: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }
  const id = req.params.proyectoId;
  if (analisisJobs.get(id)?.estado === 'procesando') {
    return res.status(202).json({ estado: 'procesando' });
  }
  analisisJobs.set(id, { estado: 'procesando' });
  // Fire-and-forget: el resultado (o el error) queda en el mapa para el sondeo.
  void analizarProyecto(id)
    .then((r) => analisisJobs.set(id, { estado: 'listo', bloqueado: r.bloqueado }))
    .catch((e: any) => analisisJobs.set(id, { estado: 'error', error: e?.message ?? 'ANALISIS_FALLO' }));
  res.status(202).json({ estado: 'procesando' });
});

// GET /api/aol/analizar/:proyectoId/estado — sondeo de la corrida del pipeline.
// 'procesando' → sigue en curso; 'listo' → recargar la pantalla Calificar;
// 'error' → mostrar el mensaje; 'inactivo' → sin corrida en memoria (p. ej. tras
// un reinicio): el cliente recarga y decide según exista o no el análisis.
router.get('/analizar/:proyectoId/estado', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const j = analisisJobs.get(req.params.proyectoId);
  if (!j) return res.json({ estado: 'inactivo' });
  res.json({ estado: j.estado, error: j.error ?? null, bloqueado: j.bloqueado ?? false });
});

// GET /api/aol/calificar/:proyectoId — datos para la pantalla Calificar (§8):
// el trabajo + integrantes, el último análisis IA (sugerencias), la rúbrica de
// 6 traits (3 niveles + fuente_ia), los 12 chequeos del modelo, y si ya está firmado.
router.get('/calificar/:proyectoId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const proyectoId = req.params.proyectoId;
  const { data: proy } = await supabaseAdmin
    .from('proyectos').select('id, nombre, anteproyecto_id').eq('id', proyectoId).maybeSingle();
  if (!proy) return res.status(404).json({ error: 'PROYECTO_NO_ENCONTRADO' });

  // El equipo/integrantes salen del anteproyecto (proyectos.anteproyecto_id).
  const { data: ante } = await supabaseAdmin
    .from('anteproyectos').select('equipos(cohorte_id, cohortes(etiqueta), miembros_equipo(posicion, participantes_lista(nombre_completo)))')
    .eq('id', (proy as any).anteproyecto_id).maybeSingle();
  const eq = (ante as any)?.equipos;
  const integrantes = ((eq?.miembros_equipo ?? []) as any[])
    .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
    .map((m) => m.participantes_lista?.nombre_completo).filter(Boolean);

  const [{ data: analisis }, { data: criterios }, { data: niveles }, { data: modelo }, { data: calif }] = await Promise.all([
    supabaseAdmin.from('aol_analisis').select('id, quick_screen, resultado, version_cerebro, creado_en').eq('proyecto_plataforma_id', proyectoId).eq('estado', 'sugerencia').order('creado_en', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('criterio').select('id, lo_id, nombre_en, nombre_corto, fuente_ia').order('id'),
    supabaseAdmin.from('rubrica_nivel').select('criterio_id, puntaje, descripcion').order('criterio_id').order('puntaje'),
    supabaseAdmin.from('criterio_modelo_financiero').select('id, dimension, orden, item, detalle').order('dimension').order('orden'),
    supabaseAdmin.from('aol_calificacion').select('puntajes, parrafo, total, on_standard, autor, firmado_en').eq('proyecto_plataforma_id', proyectoId).maybeSingle(),
  ]);

  const rubrica = ((criterios ?? []) as any[]).map((c) => ({
    ...c,
    niveles: ((niveles ?? []) as any[]).filter((n) => n.criterio_id === c.id).map((n) => ({ puntaje: n.puntaje, descripcion: n.descripcion })),
  }));

  // Normaliza: si el análisis fue bloqueado por compuerta, su `resultado` guardado
  // es {bloqueado:true} (la columna es NOT NULL). Al cliente le damos resultado:null
  // para que muestre la tarjeta de compuertas (desde quick_screen), no la rúbrica.
  const analisisNorm = analisis
    ? { ...(analisis as any), resultado: (analisis as any).resultado?.traits ? (analisis as any).resultado : null }
    : null;

  res.json({
    proyecto_id: proyectoId,
    proyecto: (proy as any).nombre,
    cohorte: (eq as any)?.cohortes?.etiqueta ?? '',
    integrantes,
    analisis: analisisNorm,
    rubrica,
    modelo_financiero: modelo ?? [],
    calificacion: calif ?? null,
  });
});

// GET /api/aol/dashboard/:cohorteId — Dashboard (§9): columna actual + histórico.
router.get('/dashboard/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const cohorteId = req.params.cohorteId;
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id, etiqueta').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });
  const etiqueta = (coh as any).etiqueta ?? cohorteId;
  const modalidad = /\bINT\b/i.test(etiqueta) ? 'INT' : 'FS';
  const anios = etiqueta.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})/);
  const to4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const codigoAol = anios ? `${modalidad} ${to4(anios[1])}-${to4(anios[2])}` : '';

  // Población objeto de AoL: equipos BP de la cohorte; otras modalidades excluidas.
  const { data: equipos } = await supabaseAdmin
    .from('equipos').select('id, tipo_trabajo_grado, proyecto_definitivo_id').eq('cohorte_id', cohorteId);
  const eqs = (equipos ?? []) as any[];
  const bp = eqs.filter((e) => e.tipo_trabajo_grado === 'business_plan');
  const otras = eqs.length - bp.length;
  const proyDefinitivos = bp.map((e) => e.proyecto_definitivo_id).filter(Boolean);
  const { data: califs } = proyDefinitivos.length
    ? await supabaseAdmin.from('aol_calificacion').select('proyecto_plataforma_id, total, on_standard').in('proyecto_plataforma_id', proyDefinitivos)
    : { data: [] as any[] };
  const evaluados = ((califs ?? []) as any[]).length;

  // Medición AoL: v_resumen (por trait). Actual = la cohorte materializada (puede
  // estar vacía hasta que haya firmas); histórico = todas.
  const [{ data: actual }, { data: historico }] = await Promise.all([
    codigoAol ? supabaseAdmin.from('v_resumen').select('*').eq('cohorte', codigoAol).order('lo').order('criterio') : Promise.resolve({ data: [] as any[] }),
    supabaseAdmin.from('v_resumen').select('*').order('anio_medicion').order('lo').order('criterio'),
  ]);

  // Comparación vs. la última cohorte cerrada de la MISMA modalidad.
  const hist = (historico ?? []) as any[];
  const cohortesModalidad = [...new Set(hist.map((r) => r.cohorte))].filter((c: string) => c.startsWith(modalidad) && c !== codigoAol);
  const anioDe = (c: string) => Number((c.match(/(\d{4})\s*-\s*(\d{4})/) ?? [])[2] ?? 0);
  const cohorteComparacion = cohortesModalidad.sort((a, b) => anioDe(b) - anioDe(a))[0] ?? null;
  const comparacion = cohorteComparacion ? hist.filter((r) => r.cohorte === cohorteComparacion) : [];

  const [{ data: acciones }, { data: conclusiones }] = await Promise.all([
    supabaseAdmin.from('accion_mejora').select('*').order('anio', { ascending: false }),
    supabaseAdmin.from('conclusion_ciclo').select('*').order('anio', { ascending: false }),
  ]);

  res.json({
    cohorte_id: cohorteId, etiqueta, codigo_aol: codigoAol, modalidad,
    kpis: {
      participantes: null, // el dashboard de control ya lo cubre; aquí el foco es AoL
      equipos_bp: bp.length, otras_modalidades: otras,
      evaluados, poblacion_objeto: bp.length,
      pct_evaluados: bp.length ? Math.round((evaluados / bp.length) * 100) : 0,
    },
    actual: actual ?? [],
    comparacion: { cohorte: cohorteComparacion, filas: comparacion },
    historico: hist,
    acciones: acciones ?? [],
    conclusiones: conclusiones ?? [],
  });
});

// GET /api/aol/dashboard/:cohorteId/lectura-impacto — borrador IA editable del
// impacto de las acciones del ciclo anterior (closing the loop, §9).
router.get('/dashboard/:cohorteId/lectura-impacto', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  if (!config.anthropic.apiKey) return res.status(503).json({ error: 'IA_NO_CONFIGURADA' });
  try {
    const texto = await generarLecturaImpacto(req.params.cohorteId);
    res.json({ texto });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'IMPACTO_FALLO' });
  }
});

// POST /api/aol/calificar/:proyectoId/firmar — la firma (R7). Inserta
// aol_calificacion + medicion por integrante × trait. Nada en firme sin este clic.
router.post('/calificar/:proyectoId/firmar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const b = req.body ?? {};
  const puntajes = b.puntajes ?? {};
  const traits = [1, 2, 3, 4, 5, 6];
  if (!traits.every((t) => [1, 2, 3].includes(Number(puntajes[String(t)])))) {
    return res.status(400).json({ error: 'PUNTAJES_INVALIDOS', mensaje: 'Los 6 traits deben tener un puntaje 1, 2 o 3.' });
  }
  if (typeof b.parrafo !== 'string' || !b.parrafo.trim()) {
    return res.status(400).json({ error: 'PARRAFO_VACIO', mensaje: 'El párrafo de calificación no puede estar vacío.' });
  }
  try {
    const r = await firmarCalificacion(req.params.proyectoId, {
      puntajes,
      parrafo: b.parrafo.trim(),
      autor: await nombreAutor(req),
      analisisId: b.analisis_id ?? null,
      versionCerebro: b.version_cerebro ?? '1.0',
      versionRubrica: b.version_rubrica ?? '1.0',
      sugerenciaIa: b.sugerencia_ia ?? undefined,
      ajustesIndividuales: b.ajustes_individuales ?? undefined,
    });
    res.json(r);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'FIRMA_FALLO' });
  }
});

// GET /api/aol/export/:cohorteId — datos de la pantalla Export AACSB (§11):
// tabla 5-1 (histórico) + registro acumulado (conclusion_ciclo) + resumen actual.
router.get('/export/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const cohorteId = req.params.cohorteId;
  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });
  const etiqueta = (coh as any).etiqueta ?? cohorteId;
  const modalidad = /\bINT\b/i.test(etiqueta) ? 'INT' : 'FS';
  const anios = etiqueta.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})/);
  const to4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const codigoAol = anios ? `${modalidad} ${to4(anios[1])}-${to4(anios[2])}` : etiqueta;

  const [{ data: aacsb }, { data: conclusiones }, { data: resumen }] = await Promise.all([
    supabaseAdmin.from('aacsb_tabla').select('*').order('id'),
    supabaseAdmin.from('conclusion_ciclo').select('*').order('anio', { ascending: false }),
    supabaseAdmin.from('v_resumen').select('*').eq('cohorte', codigoAol).order('lo').order('criterio'),
  ]);
  res.json({ cohorte_id: cohorteId, etiqueta, codigo_aol: codigoAol, aacsb: aacsb ?? [], conclusiones: conclusiones ?? [], resumen_actual: resumen ?? [] });
});

// POST /api/aol/export/:cohorteId/word — genera y descarga el reporte Word (§11.3).
// Recibe los campos editables ([EDITABLE]/[PROFESOR]) capturados en la UI.
router.post('/export/:cohorteId/word', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { buffer, filename } = await generarReporteWord(req.params.cohorteId, req.body ?? {});
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'EXPORT_FALLO' });
  }
});

// POST /api/aol/export/:cohorteId/archivar — cierra el ciclo: genera el paquete
// (docx + DATOS BRUTOS.xlsx + trazabilidad.json) y lo devuelve para descarga. El
// registro permanente del ciclo vive en la base de datos (Supabase, única fuente).
router.post('/export/:cohorteId/archivar', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const p = await generarPaqueteCierre(req.params.cohorteId, req.body ?? {});

    // Registro longitudinal (§11.2): al cerrar el ciclo se alimenta conclusion_ciclo
    // con la fila del ciclo (año, cohorte, % del goal, resumen = lectura de closing
    // the loop). Solo si ya hay mediciones firmadas de esta cohorte.
    const { data: vres } = await supabaseAdmin.from('v_resumen').select('pct_on_standard, anio_medicion').eq('cohorte', p.codigoAol);
    const filas = (vres ?? []) as any[];
    if (filas.length) {
      const goalPct = Math.round((filas.reduce((s, r) => s + Number(r.pct_on_standard), 0) / filas.length) * 10) / 10;
      const anio = Number(filas[0].anio_medicion) || Number((p.codigoAol.match(/(\d{4})\s*-\s*(\d{4})/) ?? [])[2]) || null;
      const resumen = (typeof req.body?.lectura_impacto === 'string' && req.body.lectura_impacto.trim())
        ? req.body.lectura_impacto.trim().slice(0, 800)
        : `Cierre del ciclo ${p.codigoAol}: competency goal Entrepreneurship en ${goalPct}% de learners on standard.`;
      const { data: existe } = await supabaseAdmin.from('conclusion_ciclo').select('id').eq('cohorte_codigo', p.codigoAol).eq('anio', anio).maybeSingle();
      const payload = { anio, cohorte_codigo: p.codigoAol, goal_pct: goalPct, resumen, fuente: 'Plataforma naves-inalde.com (cierre de ciclo)' };
      if (existe) await supabaseAdmin.from('conclusion_ciclo').update(payload).eq('id', (existe as any).id);
      else await supabaseAdmin.from('conclusion_ciclo').insert(payload);
    }

    res.json({ archivado: true, archivos: p.archivos.map((a) => ({ nombre: a.nombre, base64: a.buffer.toString('base64') })) });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'ARCHIVAR_FALLO' });
  }
});

// GET /api/aol/export/:cohorteId/excel — descarga el reporte en Excel (§11.3).
router.get('/export/:cohorteId/excel', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { buffer, filename } = await generarReporteExcel(req.params.cohorteId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'EXPORT_FALLO' });
  }
});

export default router;
