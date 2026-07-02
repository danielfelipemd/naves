import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { iaConfigurada, llamarClaude, extraerJSON } from '../services/ai.js';

// Módulo C (Fase 2) — Base de datos interna de proyectos + portal del
// participante (calendario de su presentación + .ics).

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');
const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fechaLegible(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DIAS[dow]} ${d} de ${MESES[m]} de ${y}`;
}

// --- Datos de proyecto por equipo (proyecto definitivo o primero no archivado)
function pickAnte(raw: any) { return Array.isArray(raw) ? raw[0] : raw; }
interface EqInfo { equipo_id: string; proyecto_id: string | null; proyecto: string; autores: string; sector: string; }
async function equiposDeCohorte(cohorteId: string): Promise<EqInfo[]> {
  const { data } = await supabaseAdmin
    .from('equipos')
    .select('id, nombre_equipo, proyecto_definitivo_id, miembros_equipo(posicion, participantes_lista(nombre_completo)), anteproyectos(proyectos(id, nombre, sector, estado_seleccion, posicion))')
    .eq('cohorte_id', cohorteId);
  const out: EqInfo[] = [];
  for (const e of (data ?? []) as any[]) {
    const autores = ((e.miembros_equipo ?? []) as any[])
      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
      .map((m) => m.participantes_lista?.nombre_completo).filter(Boolean).join(', ');
    const proyectos = ((pickAnte(e.anteproyectos)?.proyectos ?? []) as any[])
      .filter((p) => p.estado_seleccion !== 'archivado')
      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0));
    const def = e.proyecto_definitivo_id ? proyectos.find((p) => p.id === e.proyecto_definitivo_id) : null;
    const elegido = def ?? proyectos[0] ?? null;
    out.push({
      equipo_id: e.id,
      proyecto_id: elegido?.id ?? null,
      proyecto: proyectos.map((p) => p.nombre).filter(Boolean).join(' / ') || (e.nombre_equipo ?? '(sin proyecto)'),
      sector: elegido?.sector ?? '',
      autores,
    });
  }
  return out;
}

// --- Horario por equipo (de slot_presentacion + jornadas)
interface Horario { fecha: string; jornada: number; slot: number; hora_inicio: string; hora_fin: string; }
async function horariosDeCohorte(cohorteId: string): Promise<Map<string, Horario>> {
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select('id, numero, fecha').eq('cohorte_id', cohorteId);
  const jById = new Map((jornadas ?? []).map((j: any) => [j.id, j]));
  const ids = (jornadas ?? []).map((j: any) => j.id);
  const map = new Map<string, Horario>();
  if (!ids.length) return map;
  const { data: slots } = await supabaseAdmin
    .from('slot_presentacion').select('jornada_id, orden, equipo_id, hora_inicio, hora_fin').in('jornada_id', ids);
  for (const s of (slots ?? []) as any[]) {
    if (!s.equipo_id) continue;
    const j: any = jById.get(s.jornada_id);
    if (!j) continue;
    map.set(s.equipo_id, { fecha: j.fecha, jornada: j.numero, slot: s.orden, hora_inicio: hhmm(s.hora_inicio), hora_fin: hhmm(s.hora_fin) });
  }
  return map;
}

async function eventoNombre(cohorteId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('programacion_config').select('evento_nombre').eq('cohorte_id', cohorteId).maybeSingle();
  return (data as any)?.evento_nombre ?? 'NAVES';
}

// GET /api/proyectos-db/admin/:cohorteId — base de datos interna
router.get('/admin/:cohorteId', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const [equipos, horarios, evento] = await Promise.all([
    equiposDeCohorte(cohorteId), horariosDeCohorte(cohorteId), eventoNombre(cohorteId),
  ]);
  const proyIds = equipos.map((e) => e.proyecto_id).filter(Boolean) as string[];
  let contenido = new Map<string, any>();
  if (proyIds.length) {
    const { data } = await supabaseAdmin.from('proyecto_contenido').select('*').in('proyecto_id', proyIds);
    contenido = new Map((data ?? []).map((c: any) => [c.proyecto_id, c]));
  }
  const rows = equipos.map((e) => {
    const h = horarios.get(e.equipo_id) ?? null;
    const c = e.proyecto_id ? contenido.get(e.proyecto_id) : null;
    return {
      equipo_id: e.equipo_id, proyecto_id: e.proyecto_id, proyecto: e.proyecto, autores: e.autores, sector: e.sector,
      fecha: h?.fecha ?? null, fecha_legible: h ? fechaLegible(h.fecha) : null,
      jornada: h?.jornada ?? null, slot: h?.slot ?? null,
      hora_inicio: h?.hora_inicio ?? null, hora_fin: h?.hora_fin ?? null,
      resumen: c?.resumen ?? null, linkedin: c?.linkedin ?? null,
      one_pager_url: c?.one_pager_url ?? null, logo_url: c?.logo_url ?? null,
      contenido_aprobado: c?.aprobado ?? false,
    };
  }).sort((a, b) => {
    if (a.fecha && b.fecha) return a.fecha === b.fecha ? (a.slot! - b.slot!) : a.fecha.localeCompare(b.fecha);
    if (a.fecha) return -1;
    if (b.fecha) return 1;
    return a.proyecto.localeCompare(b.proyecto);
  });
  // Días distintos para el filtro
  const dias = [...new Set(rows.filter((r) => r.fecha).map((r) => r.fecha!))].sort()
    .map((f) => ({ fecha: f, legible: fechaLegible(f) }));
  res.json({ cohorte_id: cohorteId, evento, dias, proyectos: rows });
});

// GET /api/proyectos-db/admin/:cohorteId/excel — 2 hojas: Proyectos + Programación
router.get('/admin/:cohorteId/excel', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const [equipos, horarios, evento] = await Promise.all([
    equiposDeCohorte(cohorteId), horariosDeCohorte(cohorteId), eventoNombre(cohorteId),
  ]);
  const proyIds = equipos.map((e) => e.proyecto_id).filter(Boolean) as string[];
  let contenido = new Map<string, any>();
  if (proyIds.length) {
    const { data } = await supabaseAdmin.from('proyecto_contenido').select('*').in('proyecto_id', proyIds);
    contenido = new Map((data ?? []).map((c: any) => [c.proyecto_id, c]));
  }
  const NEGRO = 'FF1A1A1A', GRIS = 'FFBFBFBF', GRISOSC = 'FF595959';
  const thin = { style: 'thin' as const, color: { argb: GRIS } };
  const borde = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const wb = new ExcelJS.Workbook();

  // Hoja 1 — Proyectos (comunicaciones)
  const ws1 = wb.addWorksheet('Proyectos', { views: [{ showGridLines: false }] });
  ws1.columns = [{ width: 24 }, { width: 42 }, { width: 22 }, { width: 60 }, { width: 90 }] as any;
  const h1 = ws1.addRow(['Proyecto', 'Autores', 'Sector', 'Resumen', 'Post LinkedIn']);
  h1.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(NEGRO); c.alignment = { vertical: 'middle', wrapText: true }; c.border = borde; });
  for (const e of equipos) {
    const c = e.proyecto_id ? contenido.get(e.proyecto_id) : null;
    const r = ws1.addRow([e.proyecto, e.autores, e.sector, c?.resumen ?? '', c?.linkedin ?? '']);
    r.alignment = { vertical: 'top', wrapText: true };
    r.eachCell({ includeEmpty: true }, (cell) => { cell.border = borde; });
  }

  // Hoja 2 — Programación (asistentes de programa)
  const ws2 = wb.addWorksheet('Programación', { views: [{ showGridLines: false }] });
  ws2.columns = [{ width: 30 }, { width: 10 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 24 }, { width: 42 }, { width: 22 }] as any;
  const h2 = ws2.addRow(['Fecha', 'Jornada', 'Slot', 'Hora inicio', 'Hora fin', 'Proyecto', 'Autores', 'Sector']);
  h2.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(NEGRO); c.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' }; c.border = borde; });
  const programados = equipos.map((e) => ({ e, h: horarios.get(e.equipo_id) })).filter((x) => x.h)
    .sort((a, b) => a.h!.fecha === b.h!.fecha ? a.h!.slot - b.h!.slot : a.h!.fecha.localeCompare(b.h!.fecha));
  let fechaActual = '';
  for (const { e, h } of programados) {
    if (h!.fecha !== fechaActual) {
      fechaActual = h!.fecha;
      const sep = ws2.addRow([fechaLegible(h!.fecha)]);
      ws2.mergeCells(`A${sep.number}:H${sep.number}`);
      sep.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sep.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(GRISOSC); });
    }
    const r = ws2.addRow(['', h!.jornada, h!.slot, h!.hora_inicio, h!.hora_fin, e.proyecto, e.autores, e.sector]);
    r.eachCell({ includeEmpty: true }, (c, col) => { c.border = borde; c.alignment = { vertical: 'middle', wrapText: true, horizontal: (col >= 2 && col <= 5) ? 'center' : 'left' }; });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${evento.replace(/[^\w-]/g, '_')}_BaseDatos.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// =====================================================================
// Portal del participante — su presentación
// =====================================================================

async function miEquipoId(req: AuthenticatedRequest): Promise<string | null> {
  const pid = req.user?.participanteId;
  if (!pid) return null;
  const { data } = await supabaseAdmin.from('miembros_equipo').select('equipo_id').eq('participante_id', pid).maybeSingle();
  return (data as any)?.equipo_id ?? null;
}

// Resuelve la presentación (o null si aún no está programada)
async function miPresentacion(equipoId: string, cohorteId: string) {
  const [equipos, horarios, evento] = await Promise.all([
    equiposDeCohorte(cohorteId), horariosDeCohorte(cohorteId), eventoNombre(cohorteId),
  ]);
  const info = equipos.find((e) => e.equipo_id === equipoId) ?? null;
  const h = horarios.get(equipoId) ?? null;
  return { evento, info, h };
}

router.get('/mi-presentacion', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const equipoId = await miEquipoId(req);
  if (!equipoId) return res.json({ en_equipo: false });
  const { data: eq } = await supabaseAdmin.from('equipos').select('cohorte_id').eq('id', equipoId).maybeSingle();
  const cohorteId = (eq as any)?.cohorte_id;
  if (!cohorteId) return res.json({ en_equipo: false });
  const { evento, info, h } = await miPresentacion(equipoId, cohorteId);
  if (!h) return res.json({ en_equipo: true, programado: false, evento, proyecto: info?.proyecto ?? null, autores: info?.autores ?? null });
  res.json({
    en_equipo: true, programado: true, evento,
    proyecto: info?.proyecto ?? null, sector: info?.sector ?? null, autores: info?.autores ?? null,
    fecha: h.fecha, fecha_legible: fechaLegible(h.fecha), jornada: h.jornada, slot: h.slot,
    hora_inicio: h.hora_inicio, hora_fin: h.hora_fin,
  });
});

// .ics — evento de calendario de la presentación (Colombia UTC-5, sin DST)
function icsStampUTC(fecha: string, hhmmStr: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const [hh, mm] = hhmmStr.split(':').map(Number);
  // Bogotá (UTC-5) → UTC = +5h. Date.UTC normaliza el desbordamiento de hora.
  const dt = new Date(Date.UTC(y, m - 1, d, hh + 5, mm, 0));
  return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function icsEscape(s: string): string { return s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }

router.get('/mi-presentacion/ics', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const equipoId = await miEquipoId(req);
  if (!equipoId) return res.status(404).json({ error: 'SIN_EQUIPO' });
  const { data: eq } = await supabaseAdmin.from('equipos').select('cohorte_id').eq('id', equipoId).maybeSingle();
  const cohorteId = (eq as any)?.cohorte_id;
  if (!cohorteId) return res.status(404).json({ error: 'SIN_EQUIPO' });
  const { evento, info, h } = await miPresentacion(equipoId, cohorteId);
  if (!h) return res.status(409).json({ error: 'NO_PROGRAMADO' });

  const uid = `naves-${equipoId}-${h.fecha}@inalde`;
  const dtstart = icsStampUTC(h.fecha, h.hora_inicio);
  const dtend = icsStampUTC(h.fecha, h.hora_fin || h.hora_inicio);
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const summary = icsEscape(`Presentación ${evento} — ${info?.proyecto ?? ''}`.trim());
  const desc = icsEscape(`Jornada ${h.jornada}, slot ${h.slot}. Proyecto: ${info?.proyecto ?? ''}. Integrantes: ${info?.autores ?? ''}.`);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//INALDE//NAVES//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${dtstamp}`, `DTSTART:${dtstart}`, `DTEND:${dtend}`,
    `SUMMARY:${summary}`, `DESCRIPTION:${desc}`, 'LOCATION:INALDE Business School', 'STATUS:CONFIRMED',
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${summary}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mi-presentacion-naves.ics"');
  res.send(ics);
});

// =====================================================================
// Módulo D — Generación de contenido con IA (resumen + post LinkedIn)
// Fuente: los datos reales que el equipo escribió del proyecto (canvas).
// Nunca inventa: si no hay material suficiente, falla explícito (doc §5.5).
// =====================================================================

const HASHTAGS = '#SoyINALDE #NavesINALDE #ExecutiveMBA #Líder #INALDE #Liderazgo #MBA #EMBA #NAVES';

const CANVAS_LABELS: Array<[string, string]> = [
  ['canvas_cliente', 'Cliente / segmento'],
  ['canvas_problema', 'Problema'],
  ['canvas_solucion', 'Solución / propuesta de valor'],
  ['canvas_canales', 'Canales'],
  ['canvas_relaciones', 'Relación con clientes'],
  ['canvas_ingresos', 'Fuentes de ingreso'],
  ['canvas_recursos', 'Recursos clave'],
  ['canvas_actividades', 'Actividades clave'],
  ['canvas_socios', 'Socios clave'],
  ['canvas_costos', 'Estructura de costos'],
];

interface Fuente { nombre: string; sector: string; tipo: string; autores: string; texto: string; sha256: string; }
async function fuenteProyecto(proyectoId: string): Promise<Fuente | null> {
  const { data: p } = await supabaseAdmin
    .from('proyectos')
    .select('nombre, sector, tipo, estado, fuentes_primarias, fuentes_secundarias, anteproyecto_id, canvas_cliente, canvas_problema, canvas_solucion, canvas_canales, canvas_relaciones, canvas_ingresos, canvas_recursos, canvas_actividades, canvas_socios, canvas_costos')
    .eq('id', proyectoId).maybeSingle();
  if (!p) return null;
  const proy: any = p;

  // Autores del equipo dueño del anteproyecto
  let autores = '';
  if (proy.anteproyecto_id) {
    const { data: ante } = await supabaseAdmin
      .from('anteproyectos')
      .select('equipos(miembros_equipo(posicion, participantes_lista(nombre_completo)))')
      .eq('id', proy.anteproyecto_id).maybeSingle();
    const eq = pickAnte((ante as any)?.equipos);
    autores = ((eq?.miembros_equipo ?? []) as any[])
      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
      .map((m) => m.participantes_lista?.nombre_completo).filter(Boolean).join(', ');
  }

  const partes: string[] = [];
  for (const [k, label] of CANVAS_LABELS) {
    const v = (proy[k] ?? '').toString().trim();
    if (v) partes.push(`${label}: ${v}`);
  }
  if ((proy.fuentes_primarias ?? '').trim()) partes.push(`Fuentes primarias: ${proy.fuentes_primarias.trim()}`);
  if ((proy.fuentes_secundarias ?? '').trim()) partes.push(`Fuentes secundarias: ${proy.fuentes_secundarias.trim()}`);
  const texto = partes.join('\n');
  const sha256 = createHash('sha256').update(`${proy.nombre}|${proy.sector}|${proy.tipo}|${autores}|${texto}`).digest('hex');
  return { nombre: proy.nombre, sector: proy.sector ?? '', tipo: proy.tipo ?? '', autores, texto, sha256 };
}

async function generarUno(proyectoId: string): Promise<{ resumen: string; linkedin: string; sha256: string }> {
  const f = await fuenteProyecto(proyectoId);
  if (!f) throw new Error('PROYECTO_NO_ENCONTRADO');
  // Sin material del canvas no se puede describir con fidelidad → falla explícito.
  if (f.texto.replace(/\s/g, '').length < 40) throw new Error('SIN_FUENTE');

  const system = [
    'Eres redactor de comunicaciones de INALDE Business School para el programa NAVES (trabajos de grado del Executive MBA).',
    'Escribes en español con ortografía y gramática de la RAE.',
    'REGLA ABSOLUTA: usa ÚNICAMENTE la información que te entregan del proyecto. No inventes datos, cifras, clientes ni sectores. Si algo no está, no lo afirmes.',
    'Devuelves EXCLUSIVAMENTE un objeto JSON válido, sin texto adicional.',
  ].join(' ');

  const prompt = [
    `Proyecto: ${f.nombre}`,
    f.sector ? `Sector: ${f.sector}` : '',
    f.tipo ? `Tipo: ${f.tipo}` : '',
    f.autores ? `Autores (integrantes del equipo): ${f.autores}` : '',
    '',
    'Información del proyecto (fuente única, fiel):',
    f.texto,
    '',
    'Genera un objeto JSON con estas claves:',
    '- "resumen": una descripción clara y atractiva del emprendimiento en 1–2 frases (máximo ~280 caracteres), fiel a la información. Sin hashtags.',
    `- "linkedin": un post para LinkedIn que empiece mencionando a los autores, describa el proyecto con fidelidad, tenga un tono profesional e inspirador, y TERMINE exactamente con estos hashtags en una línea aparte: ${HASHTAGS}`,
    'Si la información es insuficiente para describir el negocio sin inventar, devuelve {"error":"motivo"}.',
  ].filter((l) => l !== '').join('\n');

  const raw = await llamarClaude(prompt, { system, maxTokens: 1200 });
  const obj = extraerJSON(raw);
  if (obj?.error) throw new Error('SIN_FUENTE');
  const resumen = (obj?.resumen ?? '').toString().trim();
  let linkedin = (obj?.linkedin ?? '').toString().trim();
  if (!resumen || !linkedin) throw new Error('IA_RESPUESTA_INCOMPLETA');
  if (!linkedin.includes('#SoyINALDE')) linkedin = `${linkedin}\n\n${HASHTAGS}`;
  return { resumen, linkedin, sha256: f.sha256 };
}

async function guardarContenido(proyectoId: string, campos: Record<string, unknown>) {
  const { data: prev } = await supabaseAdmin.from('proyecto_contenido').select('one_pager_url, logo_url').eq('proyecto_id', proyectoId).maybeSingle();
  await supabaseAdmin.from('proyecto_contenido').upsert({
    proyecto_id: proyectoId,
    one_pager_url: (prev as any)?.one_pager_url ?? null,
    logo_url: (prev as any)?.logo_url ?? null,
    ...campos,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'proyecto_id' });
}

// POST generar contenido de UN proyecto
const generarSchema = z.object({ force: z.boolean().optional() });
router.post('/admin/proyecto/:proyectoId/generar-contenido', ...soloAdmin, async (req, res) => {
  if (!iaConfigurada()) return res.status(503).json({ error: 'IA_NO_CONFIGURADA', message: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  const parsed = generarSchema.safeParse(req.body ?? {});
  const force = parsed.success ? !!parsed.data.force : false;
  const proyectoId = req.params.proyectoId;

  // Caché por hash: si ya hay contenido con el mismo sha y no se fuerza, no regenera.
  if (!force) {
    const f = await fuenteProyecto(proyectoId);
    const { data: prev } = await supabaseAdmin.from('proyecto_contenido').select('source_sha256, resumen').eq('proyecto_id', proyectoId).maybeSingle();
    if (f && prev && (prev as any).source_sha256 === f.sha256 && (prev as any).resumen) {
      return res.json({ ok: true, cacheado: true });
    }
  }
  try {
    const { resumen, linkedin, sha256 } = await generarUno(proyectoId);
    await guardarContenido(proyectoId, { resumen, linkedin, source_sha256: sha256, generado_en: new Date().toISOString(), aprobado: false });
    res.json({ ok: true, resumen, linkedin });
  } catch (e: any) {
    const msg = e?.message ?? 'IA_ERROR';
    const code = msg === 'SIN_FUENTE' ? 422 : msg.startsWith('IA_') || msg.startsWith('PROYECTO') ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

// POST generar TODOS los faltantes/cambiados de una cohorte (serial, con pausa)
router.post('/admin/:cohorteId/generar-todo', ...soloAdmin, async (req, res) => {
  if (!iaConfigurada()) return res.status(503).json({ error: 'IA_NO_CONFIGURADA', message: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  const equipos = await equiposDeCohorte(req.params.cohorteId);
  const proyIds = equipos.map((e) => e.proyecto_id).filter(Boolean) as string[];
  const { data: existentes } = await supabaseAdmin.from('proyecto_contenido').select('proyecto_id, source_sha256, aprobado, resumen').in('proyecto_id', proyIds.length ? proyIds : ['00000000-0000-0000-0000-000000000000']);
  const prevMap = new Map((existentes ?? []).map((c: any) => [c.proyecto_id, c]));

  const resultado = { generados: 0, saltados: 0, sin_fuente: 0, errores: 0, total: proyIds.length };
  for (const pid of proyIds) {
    try {
      const f = await fuenteProyecto(pid);
      const prev: any = prevMap.get(pid);
      // Saltar si ya está aprobado o si el hash no cambió y ya hay resumen.
      if (prev?.aprobado || (f && prev && prev.source_sha256 === f.sha256 && prev.resumen)) { resultado.saltados++; continue; }
      const { resumen, linkedin, sha256 } = await generarUno(pid);
      await guardarContenido(pid, { resumen, linkedin, source_sha256: sha256, generado_en: new Date().toISOString(), aprobado: false });
      resultado.generados++;
      await new Promise((r) => setTimeout(r, 600)); // respirar entre llamadas
    } catch (e: any) {
      if (e?.message === 'SIN_FUENTE') resultado.sin_fuente++; else resultado.errores++;
    }
  }
  res.json({ ok: true, ...resultado });
});

// PUT edición manual + aprobación de contenido
const contenidoSchema = z.object({
  resumen: z.string().max(2000).optional(),
  linkedin: z.string().max(6000).optional(),
  one_pager_url: z.string().url().max(1000).nullable().optional(),
  aprobado: z.boolean().optional(),
});
router.put('/admin/proyecto/:proyectoId/contenido', ...soloAdmin, async (req, res) => {
  const parsed = contenidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const campos: Record<string, unknown> = { ...parsed.data };
  await guardarContenido(req.params.proyectoId, campos);
  res.json({ ok: true });
});

router.get('/admin/estado-ia', ...soloAdmin, (_req, res) => res.json({ configurada: iaConfigurada() }));

export default router;
