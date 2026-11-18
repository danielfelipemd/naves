import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { iaConfigurada } from '../services/ai.js';
import { REGLAS, validarFormato, errorFormato } from '../lib/formato-archivo.js';
import { uploadAssetNaves, deleteAssetNaves, crearUrlProxyArchivo, mimeFromPath, downloadTrabajoGradoFile, type TipoAssetNaves } from '../services/storage.js';
import { generarContenidoOnePager, type OnePagerDoc } from '../services/ai-onepager.js';
import { proyectosFase2, type ProyectoFase2 } from '../services/proyectos-fase2.js';
import { horariosCalculados, programacionPublicadaAt, quitarDeProgramacion } from '../services/escaleta.js';
import { sinNombreProyecto } from '../lib/nombreProyecto.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
// URL servida de un asset: proxy con token efímero si está en Storage; si no, el enlace externo.
function urlAsset(path: string | null, urlExterna: string | null): string | null {
  if (path) return crearUrlProxyArchivo(path, mimeFromPath(path));
  return urlExterna ?? null;
}

// Módulo C (Fase 2) — Base de datos interna de proyectos + portal del
// participante (calendario de su presentación + .ics).
// La unidad es el PROYECTO DEFINITIVO: un equipo que aún no eligió no aparece
// aquí (ver services/proyectos-fase2).

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fechaLegible(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DIAS[dow]} ${d} de ${MESES[m]} de ${y}`;
}

// --- Proyectos definitivos de la cohorte (los únicos que entran a la Fase 2)
async function proyectosDeCohorte(cohorteId: string): Promise<ProyectoFase2[]> {
  return [...(await proyectosFase2(cohorteId)).values()];
}

// --- Horario por proyecto: el de la escaleta calculada (el mismo número y la
// misma hora que muestra la pantalla de programación), no la copia guardada en
// slot_presentacion, que podía quedarse vieja al cambiar los tiempos.
interface Horario { fecha: string; jornada: number; slot: number; hora_inicio: string; hora_fin: string; }
async function horariosDeCohorte(cohorteId: string): Promise<Map<string, Horario>> {
  const map = new Map<string, Horario>();
  for (const [id, h] of await horariosCalculados(cohorteId)) {
    map.set(id, { fecha: h.fecha, jornada: h.jornada, slot: h.slot, hora_inicio: h.hora_inicio ?? '', hora_fin: h.hora_fin ?? '' });
  }
  return map;
}

async function eventoNombre(cohorteId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('programacion_config').select('evento_nombre').eq('cohorte_id', cohorteId).maybeSingle();
  return (data as any)?.evento_nombre ?? 'NAVES';
}

// Estado de la IA — DEBE ir antes de '/admin/:cohorteId' (si no, ":cohorteId"
// captura la palabra "estado-ia" y la ruta literal nunca se alcanza).
router.get('/admin/estado-ia', ...soloAdmin, (_req, res) => res.json({ configurada: iaConfigurada() }));

// GET /api/proyectos-db/admin/:cohorteId — base de datos interna
router.get('/admin/:cohorteId', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const [proyectos, horarios, evento] = await Promise.all([
    proyectosDeCohorte(cohorteId), horariosDeCohorte(cohorteId), eventoNombre(cohorteId),
  ]);
  const proyIds = proyectos.map((e) => e.proyecto_id);
  let contenido = new Map<string, any>();
  if (proyIds.length) {
    const { data } = await supabaseAdmin.from('proyecto_contenido').select('*').in('proyecto_id', proyIds);
    contenido = new Map((data ?? []).map((c: any) => [c.proyecto_id, c]));
  }
  const rows = proyectos.map((e) => {
    const h = e.privado ? null : (horarios.get(e.proyecto_id) ?? null);
    const c = contenido.get(e.proyecto_id) ?? null;
    return {
      equipo_id: e.equipo_id, proyecto_id: e.proyecto_id, proyecto: e.proyecto, autores: e.autores, sector: e.sector,
      privado: e.privado,
      fecha: h?.fecha ?? null, fecha_legible: h ? fechaLegible(h.fecha) : null,
      jornada: h?.jornada ?? null, slot: h?.slot ?? null,
      hora_inicio: h?.hora_inicio ?? null, hora_fin: h?.hora_fin ?? null,
      resumen: c?.resumen ?? null, linkedin: c?.linkedin ?? null,
      one_pager_url: urlAsset(c?.one_pager_path ?? null, c?.one_pager_url ?? null),
      logo_url: urlAsset(c?.logo_path ?? null, c?.logo_url ?? null),
      tiene_one_pager: !!(c?.one_pager_path || c?.one_pager_url),
      tiene_logo: !!(c?.logo_path || c?.logo_url),
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
  const [todosProyectos, horarios, evento] = await Promise.all([
    proyectosDeCohorte(cohorteId), horariosDeCohorte(cohorteId), eventoNombre(cohorteId),
  ]);
  // Los privados (sql/54) no salen en el Excel: es lo que se comparte con
  // comunicaciones y con los asistentes de programa (JMV, 17-nov-2026).
  const proyectos = todosProyectos.filter((e) => !e.privado);
  const proyIds = proyectos.map((e) => e.proyecto_id);
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
  for (const e of proyectos) {
    const c = contenido.get(e.proyecto_id) ?? null;
    const r = ws1.addRow([e.proyecto, e.autores, e.sector, c?.resumen ?? '', c?.linkedin ?? '']);
    r.alignment = { vertical: 'top', wrapText: true };
    r.eachCell({ includeEmpty: true }, (cell) => { cell.border = borde; });
  }

  // Hoja 2 — Programación (asistentes de programa)
  const ws2 = wb.addWorksheet('Programación', { views: [{ showGridLines: false }] });
  ws2.columns = [{ width: 30 }, { width: 10 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 24 }, { width: 42 }, { width: 22 }] as any;
  const h2 = ws2.addRow(['Fecha', 'Jornada', 'Slot', 'Hora inicio', 'Hora fin', 'Proyecto', 'Autores', 'Sector']);
  h2.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(NEGRO); c.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' }; c.border = borde; });
  const programados = proyectos.map((e) => ({ e, h: horarios.get(e.proyecto_id) })).filter((x) => x.h)
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

// Equipo del participante autenticado, con su cohorte y su proyecto definitivo.
interface MiEquipo { equipo_id: string; cohorte_id: string; proyecto_definitivo_id: string | null; }
async function miEquipo(req: AuthenticatedRequest): Promise<MiEquipo | null> {
  const pid = req.user?.participanteId;
  if (!pid) return null;
  const { data: m } = await supabaseAdmin
    .from('miembros_equipo').select('equipo_id').eq('participante_id', pid).maybeSingle();
  const equipoId = (m as any)?.equipo_id;
  if (!equipoId) return null;
  const { data: eq } = await supabaseAdmin
    .from('equipos').select('cohorte_id, proyecto_definitivo_id').eq('id', equipoId).maybeSingle();
  if (!(eq as any)?.cohorte_id) return null;
  return {
    equipo_id: equipoId,
    cohorte_id: (eq as any).cohorte_id,
    proyecto_definitivo_id: (eq as any).proyecto_definitivo_id ?? null,
  };
}

// Resuelve la presentación del proyecto definitivo (h == null si aún no está programada)
async function miPresentacion(proyectoId: string, cohorteId: string) {
  const [pf, horarios, evento, publicada] = await Promise.all([
    proyectosFase2(cohorteId), horariosDeCohorte(cohorteId), eventoNombre(cohorteId), programacionPublicadaAt(cohorteId),
  ]);
  // Un proyecto privado (sql/54) no se presenta: no tiene horario que mostrar.
  // Y antes de publicar el participante no ve su turno: es un borrador que el
  // admin sigue moviendo, y verlo cambiar confunde (revisión 17-nov-2026).
  const info = pf.get(proyectoId) ?? null;
  return { evento, info, h: !publicada || info?.privado ? null : (horarios.get(proyectoId) ?? null) };
}

router.get('/mi-presentacion', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const eq = await miEquipo(req);
  if (!eq) return res.json({ en_equipo: false });
  // Sin proyecto definitivo el equipo todavía no entró a la Fase 2: no hay nada
  // que presentar hasta que se haga la selección.
  if (!eq.proyecto_definitivo_id) {
    return res.json({ en_equipo: true, programado: false, seleccion_pendiente: true, evento: await eventoNombre(eq.cohorte_id) });
  }
  const { evento, info, h } = await miPresentacion(eq.proyecto_definitivo_id, eq.cohorte_id);
  if (!h) return res.json({ en_equipo: true, programado: false, seleccion_pendiente: false, evento, proyecto: info?.proyecto ?? null, autores: info?.autores ?? null });
  res.json({
    en_equipo: true, programado: true, seleccion_pendiente: false, evento,
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
  const eq = await miEquipo(req);
  if (!eq) return res.status(404).json({ error: 'SIN_EQUIPO' });
  if (!eq.proyecto_definitivo_id) return res.status(409).json({ error: 'SELECCION_PENDIENTE' });
  const { evento, info, h } = await miPresentacion(eq.proyecto_definitivo_id, eq.cohorte_id);
  if (!h) return res.status(409).json({ error: 'NO_PROGRAMADO' });

  const uid = `naves-${eq.proyecto_definitivo_id}-${h.fecha}@inalde`;
  const dtstart = icsStampUTC(h.fecha, h.hora_inicio);
  const dtend = icsStampUTC(h.fecha, h.hora_fin || h.hora_inicio);
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const summary = icsEscape(`Presentación ${evento} — ${info?.proyecto ?? ''}`.trim());
  const desc = icsEscape(`Jornada ${h.jornada}, presentación ${h.slot}. Proyecto: ${info?.proyecto ?? ''}. Integrantes: ${info?.autores ?? ''}.`);
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

// Sube esta versión cuando cambien las reglas de redacción: invalida la caché
// (sha) y «Generar todo» rehace lo que no esté aprobado.
const REGLAS_POSTS_VERSION = 'posts-v2';
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

interface Fuente { nombre: string; sector: string; tipo: string; autores: string; texto: string; onePagerPath: string | null; sha256: string; }
async function fuenteProyecto(proyectoId: string): Promise<Fuente | null> {
  const { data: p } = await supabaseAdmin
    .from('proyectos')
    .select('nombre, sector, tipo, estado, fuentes_primarias, fuentes_secundarias, anteproyecto_id, canvas_cliente, canvas_problema, canvas_solucion, canvas_canales, canvas_relaciones, canvas_ingresos, canvas_recursos, canvas_actividades, canvas_socios, canvas_costos')
    .eq('id', proyectoId).maybeSingle();
  if (!p) return null;
  const proy: any = p;

  // One-pager real cargado por el equipo (PDF/imagen). Es la fuente PREFERIDA
  // para la IA; el canvas queda como respaldo. Va en el sha para que cambiar
  // el one-pager (o quitarlo) invalide la caché y regenere.
  const { data: cont } = await supabaseAdmin
    .from('proyecto_contenido').select('one_pager_path').eq('proyecto_id', proyectoId).maybeSingle();
  const onePagerPath = ((cont as any)?.one_pager_path ?? null) as string | null;

  // Autores del equipo dueño del anteproyecto
  let autores = '';
  if (proy.anteproyecto_id) {
    const { data: ante } = await supabaseAdmin
      .from('anteproyectos')
      .select('equipos(miembros_equipo(posicion, participantes_lista(nombre_completo)))')
      .eq('id', proy.anteproyecto_id).maybeSingle();
    const raw = (ante as any)?.equipos;
    const eq = Array.isArray(raw) ? raw[0] : raw;
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
  const sha256 = createHash('sha256').update(`${REGLAS_POSTS_VERSION}|${proy.nombre}|${proy.sector}|${proy.tipo}|${autores}|${texto}|${onePagerPath ?? ''}`).digest('hex');
  return { nombre: proy.nombre, sector: proy.sector ?? '', tipo: proy.tipo ?? '', autores, texto, onePagerPath, sha256 };
}

// Descarga el one-pager real del bucket y lo devuelve como bloque para Claude
// (document si es PDF, image si es png/jpg/webp). Devuelve null si no hay
// one-pager cargado o si no se puede descargar (→ respaldo al canvas).
async function cargarOnePagerDoc(path: string | null): Promise<OnePagerDoc | null> {
  if (!path) return null;
  const mediaType = mimeFromPath(path);
  const kind = mediaType === 'application/pdf' ? 'pdf'
    : mediaType.startsWith('image/') ? 'imagen'
      : null;
  if (!kind) return null; // formato no soportado por la IA (p. ej. xlsx) → respaldo
  try {
    const buf = await downloadTrabajoGradoFile(path);
    return { kind, mediaType, base64: buf.toString('base64') };
  } catch {
    return null; // si falla la descarga, no reventamos: caemos al canvas
  }
}

// Revisión automática del post antes de guardarlo (reglas 10, 11 y 14 de
// docs/comunicaciones/REGLAS_escritura_posts_NAVES.md): cero cifras, en dígitos
// o en letras, y nada de condicional. Devuelve los problemas encontrados.
const NUMEROS_EN_LETRAS = /(?<!\p{L})(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis\w+|veinte|veinti\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|cientos|doscient\w+|trescient\w+|cuatrocient\w+|quinient\w+|seiscient\w+|setecient\w+|ochocient\w+|novecient\w+|mil|miles|mill[oó]n|millones|billones|docena|docenas|decena|decenas|centenar|centenares|doble|triple|mitad|tercio|cuarto|primer|primera|primero|segund\p{L}|tercer\p{L}*)(?!\p{L})/giu;
// Condicional: -aría/-ería/-iría(n), salvo sustantivos frecuentes terminados igual.
const SUSTANTIVOS_RIA = new Set(['ganadería', 'ingeniería', 'batería', 'baterías', 'galería', 'galerías', 'librería', 'librerías', 'panadería', 'panaderías', 'cafetería', 'cafeterías', 'joyería', 'joyerías', 'zapatería', 'zapaterías', 'hotelería', 'minería', 'tesorería', 'cervecería', 'cervecerías', 'lechería', 'pastelería', 'pastelerías', 'carpintería', 'tubería', 'tuberías', 'ferretería', 'ferreterías', 'droguería', 'droguerías', 'lavandería', 'lavanderías', 'peluquería', 'peluquerías', 'heladería', 'heladerías', 'mensajería', 'papelería', 'floristería', 'floristerías', 'confitería', 'chocolatería', 'chocolaterías', 'marroquinería', 'lencería', 'perfumería', 'relojería', 'carnicería', 'carnicerías', 'frutería', 'pescadería', 'mercería', 'sastrería', 'tapicería', 'vidriería', 'herrería', 'orfebrería', 'cerrajería', 'cristalería', 'jardinería', 'mueblería', 'mueblerías', 'alfarería', 'cerería', 'tortillería', 'arepería', 'bisutería', 'cuchillería', 'hojalatería', 'platería', 'sombrerería', 'tintorería', 'charcutería', 'travesía', 'fantasía', 'categoría', 'mayoría', 'minoría', 'consultoría', 'asesoría', 'auditoría', 'tutoría', 'mentoría', 'teoría', 'alegría', 'energía', 'tecnología', 'metodología', 'economía', 'compañía', 'compañías', 'garantía', 'garantías', 'vía', 'vías', 'día', 'días', 'filosofía', 'geografía', 'cirugía', 'biología', 'fotografía', 'cartografía', 'odontología', 'cardiología', 'gastronomía', 'agronomía', 'autonomía', 'soberanía', 'ciudadanía', 'lotería', 'cría', 'guía', 'guías', 'sequía', 'policía']);
function revisarPost(post: string, nombreProyecto = ''): string[] {
  // El nombre del proyecto es marca (p. ej. «Ready2», «Nexo 3-21»): no cuenta como cifra.
  const texto = sinNombreProyecto(post.split('#SoyINALDE')[0], nombreProyecto);
  const problemas: string[] = [];
  // Dígitos sueltos; los pegados a letras son parte de una marca o sigla (B2B, Ready2).
  const digitos = texto.match(/(?<![\p{L}\d])\d[\d.,]*(?![\p{L}\d])/gu);
  if (digitos) problemas.push(`Tiene cifras en dígitos (${[...new Set(digitos)].join(', ')}). Regla 10: cero cifras de cualquier tipo; reescribe esas frases sin ellas.`);
  const letras = texto.match(NUMEROS_EN_LETRAS);
  if (letras) problemas.push(`Tiene números o cantidades escritos en letras (${[...new Set(letras.map((w) => w.toLowerCase()))].join(', ')}). Regla 10: cero cifras, tampoco en letras ni ordinales; reescribe esas frases.`);
  const cond = (texto.match(/(?<!\p{L})\p{L}+(?:aría|ería|iría)n?(?!\p{L})/giu) ?? [])
    .filter((w) => !SUSTANTIVOS_RIA.has(w.toLowerCase()));
  if (cond.length) problemas.push(`Puede tener verbos en condicional (${[...new Set(cond)].join(', ')}). Regla 14: prohibido el condicional; usa futuro («saldrá») o «Su plan de negocio propone…». Si alguna de esas palabras es un sustantivo, déjala.`);
  const palabras = texto.trim().split(/\s+/).filter(Boolean).length;
  if (palabras > 80) problemas.push(`Tiene ${palabras} palabras sin hashtags y el máximo es 80 (regla 9). Recórtalo a unas 65: quita la frase 3 o sus detalles, y deja una sola idea por frase.`);
  if (palabras < 45) problemas.push(`Tiene ${palabras} palabras sin hashtags y el mínimo es 45 (regla 9). Añade un hecho concreto del one pager.`);
  if (/colombian[oa]s?|(?:de|en|para) colombia|del país/i.test(texto)) problemas.push('Dice que el proyecto es colombiano o de/en Colombia. Se da por hecho: quítalo (solo vale una región o ciudad concreta, o un país distinto).');
  if (/(?<!\p{L})(?:un|una) (?:emprendimiento|empresa|startup)(?!\p{L})/iu.test(texto)) problemas.push('Usa una etiqueta genérica («un emprendimiento», «una empresa»). Di qué es el proyecto en concreto.');
  if (/[¿?]/.test(texto)) problemas.push('Tiene una pregunta. Regla 18: prohibidas las preguntas retóricas.');
  return problemas;
}

async function generarUno(proyectoId: string): Promise<{ resumen: string; linkedin: string; sha256: string }> {
  const f = await fuenteProyecto(proyectoId);
  if (!f) throw new Error('PROYECTO_NO_ENCONTRADO');

  // Regla 1 y 2 de los posts: todo sale del one pager real, leído completo.
  // Sin one pager legible no se escribe nada (antes se caía al canvas).
  const doc = await cargarOnePagerDoc(f.onePagerPath);
  if (!doc) throw new Error(f.onePagerPath ? 'ONE_PAGER_ILEGIBLE' : 'SIN_ONE_PAGER');

  const system = [
    'Eres redactor de comunicaciones de INALDE Business School para NAVES, las jornadas de presentación de los trabajos de grado del Executive MBA.',
    'Escribes en español de Colombia, en tercera persona, con ortografía y gramática de la RAE, con estilo llano (estándar Pinker): sujetos que actúan, verbos concretos, una idea por frase, sin palabras que sobren.',
    'REGLA ABSOLUTA: usa ÚNICAMENTE la información del one pager adjunto. No inventes datos, clientes ni sectores. Si algo no está, no lo afirmes. Lo que el one pager presenta como proyección no se cuenta como hecho.',
    'Entregas el resultado exclusivamente llamando a la herramienta entregar_contenido.',
  ].join(' ');

  const partesInstruccion: string[] = [
    `Proyecto: ${f.nombre}`,
    f.sector ? `Sector: ${f.sector}` : '',
    f.tipo ? `Tipo: ${f.tipo}` : '',
    f.autores ? `Integrantes (nombres completos de la lista oficial; cópialos exactos, con su ortografía y en este orden): ${f.autores}` : '',
    '',
    'Fuente ÚNICA y fiel: el ONE PAGER del proyecto adjunto arriba. Léelo por completo, INCLUIDAS las imágenes, gráficos y datos que contenga.',
    '',
    'Genera DOS piezas distintas y llama a la herramienta entregar_contenido con ellas:',
    '',
    'resumen — EXACTAMENTE 2 frases, sin autores, sin hashtags, sin emojis, sin superlativos vacíos:',
    '  Frase 1 (qué es): tipo de negocio + para quién (+ dónde solo si es una región o ciudad concreta, o un país distinto de Colombia). Ej.: "FinTech que financia medicamentos y procedimientos urgentes no cubiertos por salud."',
    '  Nunca "colombiano/a", "de Colombia" ni "en Colombia": se da por hecho (ver regla de lugar más abajo).',
    '  Frase 2 (el diferencial o dato de validación). Ej.: "Aprobación en menos de 5 minutos, desembolso directo al proveedor médico."',
    '',
    'linkedin — post para LinkedIn. Cumple TODAS estas reglas de INALDE:',
    'Estructura',
    '  - Frase 1: "[integrantes] presentaron [PROYECTO], [qué es, con el subtítulo o la propuesta de valor del one pager]." Con un solo integrante, "presentó". Nombres a secas, sin "Dr.", "Ing." ni honoríficos.',
    '  - Frase 2: a quién le vende el proyecto y qué problema le resuelve, con sujeto explícito (p. ej. "Su plan de negocio propone…").',
    '  - Frase 3 (opcional): cómo lo hace, con un hecho concreto del one pager.',
    '  - Dos o tres frases en total, entre 45 y 80 palabras sin contar los hashtags (apunta a unas 65; el ejemplo de abajo tiene 69). Cuenta las palabras antes de entregar.',
    '  - No menciones la jornada ni el programa (se entiende que fue en las jornadas de presentación de NAVES del Executive MBA).',
    '  - El post termina en el último hecho del one pager. NADA de frase final tipo eslogan, máxima o aforismo.',
    'Cero cifras',
    '  - Ninguna cifra de ningún tipo: porcentajes, montos, ventas, toneladas, unidades, clientes, plazos, tiempos ni conteos, ni en dígitos ni en letras (tampoco "dos", "mil", "primer"). Antes de entregar, revisa el texto y reescribe toda frase que tenga una.',
    'Tiempos verbales',
    '  - "Presentaron" en pasado.',
    '  - Lo que el proyecto hará va en futuro ("Cada lote saldrá…") o como propuesta ("Su plan de negocio propone…").',
    '  - PROHIBIDO el condicional ("saldría", "permitiría", "podría").',
    '  - El presente ("La empresa vende…") solo si el one pager muestra que la empresa ya opera.',
    'Prohibido',
    '  - Redacción adversativa en todas sus formas ("no es X, sino Y", "más allá de", "deja de ser… para", definir algo por lo que ya fue o por lo que supera). Cada cosa se dice por lo que es.',
    '  - Preguntas retóricas, metáforas, emojis.',
    '  - Superlativos y primicias sin prueba ("el primero", "el único", "nunca había", "revoluciona", "democratiza", "innovador").',
    '  - Ejemplos de cierres PROHIBIDOS: "El campo colombiano tiene solución, y nació en un aula del Executive MBA." / "Cargar tu vehículo eléctrico nunca había sido tan placentero." / "La emoción es el combustible; el movimiento, el vehículo del cambio." / "Porque las mejores decisiones no se improvisan: se construyen con método."',
    'Lugar',
    '  - Se da por hecho que los proyectos son colombianos: PROHIBIDO "colombiano/a", "de Colombia", "en Colombia", "del país" (JMV, 17-nov-2026). Solo se nombra el lugar si es concreto y distintivo (una región o ciudad: "del Caribe", "en Medellín") o si el proyecto apunta a otro país o a Latinoamérica. Si «Colombia» es parte del nombre del proyecto, el nombre se deja como está.',
    '  - Nada de etiquetas genéricas como "un emprendimiento" o "una empresa" a secas: di qué es (p. ej. "miel trazable…", "un software de gestión de bodegas…").',
    'Vocabulario',
    '  - Participantes (nunca estudiantes), jornadas de presentación (nunca Demo Day), panelistas (nunca jurado).',
    '  - Siglas y anglicismos de negocio (B2B, RTD, WMS, asset-light…) se escriben en español; marcas y nombres propios se dejan como están.',
    '  - La institución nunca aparece con su nombre religioso.',
    '  - Tildes y ortografía revisadas, incluidos los nombres.',
    `Hashtags: una línea en blanco después del texto y luego, sin cambios: ${HASHTAGS}`,
    '',
    'Ejemplo que cumple todas las reglas (es de OTRO proyecto: copia la forma, no el contenido):',
    '"César David Trujillo Laverde, Diego Fernando Cavanzo García y Sandra Marcela Meneses Quinchía presentaron Apivoltaicos de Colombia, miel trazable producida en parques solares del Caribe. Su plan de negocio propone instalar apiarios dentro de parques fotovoltaicos y vender la miel a cadenas con marca propia y con la marca Heliflora. Cada lote saldrá con análisis de laboratorio acreditado y un código QR que lleva hasta el apiario de origen."',
  ];
  const base = partesInstruccion.filter((l) => l !== '').join('\n');

  // Hasta 3 intentos: si la revisión automática encuentra cifras, condicional,
  // preguntas o un largo fuera de rango, se le devuelve a la IA para corregir.
  let instruccion = base;
  let resumen = '';
  let linkedin = '';
  let problemas: string[] = [];
  for (let intento = 0; intento < 3; intento++) {
    const r = await generarContenidoOnePager({ system, instruccion, documento: doc, maxTokens: 1500 });
    resumen = r.resumen; linkedin = r.linkedin;
    if (!resumen || !linkedin) throw new Error('IA_RESPUESTA_INCOMPLETA');
    problemas = revisarPost(linkedin, f.nombre);
    if (!problemas.length) break;
    instruccion = `${base}\n\nTu versión anterior del post fue:\n"""${linkedin}"""\nLa revisión encontró estos problemas; corrígelos y vuelve a entregar ambas piezas:\n- ${problemas.join('\n- ')}`;
  }
  // Lo que siga con cifras no se guarda: mejor un error visible que un post que
  // incumple la regla 10. El resto (posible condicional, largo) se deja pasar
  // porque la revisión puede equivocarse con un sustantivo.
  if (problemas.some((p) => p.startsWith('Tiene cifras'))) throw new Error('IA_POST_CON_CIFRAS');
  // Salvaguarda: si la IA omitió los hashtags fijos, los añadimos al final.
  if (!linkedin.includes('#SoyINALDE')) linkedin = `${linkedin}\n\n${HASHTAGS}`;
  return { resumen, linkedin, sha256: f.sha256 };
}

// Devuelve null si todo bien, o el mensaje de error. OJO con los dos fallos
// silenciosos que tenía: (1) si el SELECT previo fallaba, `prev` quedaba null y
// el upsert escribía one_pager_url/logo_url = null, BORRANDO justo las URLs que
// leía para preservarlas; (2) si el upsert fallaba, el llamador respondía ok y
// el admin perdía el texto que acababa de escribir.
async function guardarContenido(proyectoId: string, campos: Record<string, unknown>): Promise<string | null> {
  const { data: prev, error: errPrev } = await supabaseAdmin
    .from('proyecto_contenido').select('one_pager_url, logo_url').eq('proyecto_id', proyectoId).maybeSingle();
  if (errPrev) return errPrev.message;
  const { error } = await supabaseAdmin.from('proyecto_contenido').upsert({
    proyecto_id: proyectoId,
    one_pager_url: (prev as any)?.one_pager_url ?? null,
    logo_url: (prev as any)?.logo_url ?? null,
    ...campos,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'proyecto_id' });
  return error ? error.message : null;
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
    const errG = await guardarContenido(proyectoId, { resumen, linkedin, source_sha256: sha256, generado_en: new Date().toISOString(), aprobado: false });
    if (errG) return res.status(500).json({ error: 'GUARDAR_FALLIDO', detail: errG });
    res.json({ ok: true, resumen, linkedin });
  } catch (e: any) {
    const msg = e?.message ?? 'IA_ERROR';
    const code = ['SIN_FUENTE', 'SIN_ONE_PAGER', 'ONE_PAGER_ILEGIBLE'].includes(msg) ? 422 : msg.startsWith('IA_') || msg.startsWith('PROYECTO') ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

// POST generar TODOS los faltantes/cambiados de una cohorte (serial, con pausa).
// Corre en segundo plano: con decenas de proyectos y hasta 3 intentos por post
// tarda minutos, más que el timeout del navegador (15 s) y de nginx (120 s).
// La pantalla consulta el avance con GET …/generar-todo/estado. Un solo trabajo
// por cohorte a la vez (en memoria: el backend corre en una sola instancia).
interface TrabajoGeneracion {
  total: number; hechos: number; generados: number; saltados: number; sin_fuente: number; errores: number;
  en_curso: boolean; inicio: string; fin: string | null; actual: string | null;
}
const trabajos = new Map<string, TrabajoGeneracion>();

async function correrGeneracion(cohorteId: string, t: TrabajoGeneracion, proyectos: ProyectoFase2[]) {
  const proyIds = proyectos.map((e) => e.proyecto_id);
  const nombres = new Map(proyectos.map((e) => [e.proyecto_id, e.proyecto]));
  const { data: existentes } = await supabaseAdmin.from('proyecto_contenido').select('proyecto_id, source_sha256, aprobado, resumen').in('proyecto_id', proyIds.length ? proyIds : ['00000000-0000-0000-0000-000000000000']);
  const prevMap = new Map((existentes ?? []).map((c: any) => [c.proyecto_id, c]));
  for (const pid of proyIds) {
    t.actual = nombres.get(pid) ?? null;
    try {
      const f = await fuenteProyecto(pid);
      const prev: any = prevMap.get(pid);
      // Saltar si ya está aprobado o si el hash no cambió y ya hay resumen.
      if (prev?.aprobado || (f && prev && prev.source_sha256 === f.sha256 && prev.resumen)) { t.saltados++; continue; }
      const { resumen, linkedin, sha256 } = await generarUno(pid);
      // No contar como "generado" algo que no se guardó.
      const errG = await guardarContenido(pid, { resumen, linkedin, source_sha256: sha256, generado_en: new Date().toISOString(), aprobado: false });
      if (errG) { t.errores++; continue; }
      t.generados++;
      await new Promise((r) => setTimeout(r, 600)); // respirar entre llamadas
    } catch (e: any) {
      if (['SIN_FUENTE', 'SIN_ONE_PAGER', 'ONE_PAGER_ILEGIBLE'].includes(e?.message)) t.sin_fuente++; else t.errores++;
      if (!['SIN_FUENTE', 'SIN_ONE_PAGER', 'ONE_PAGER_ILEGIBLE'].includes(e?.message)) console.error(`[generar-todo] ${cohorteId} ${pid}:`, e?.message);
    } finally {
      t.hechos++;
    }
  }
}

router.post('/admin/:cohorteId/generar-todo', ...soloAdmin, async (req, res) => {
  if (!iaConfigurada()) return res.status(503).json({ error: 'IA_NO_CONFIGURADA', message: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  const cohorteId = req.params.cohorteId;
  const previo = trabajos.get(cohorteId);
  if (previo?.en_curso) return res.status(202).json({ ok: true, ya_en_curso: true, ...previo });
  const proyectos = await proyectosDeCohorte(cohorteId);
  const t: TrabajoGeneracion = {
    total: proyectos.length, hechos: 0, generados: 0, saltados: 0, sin_fuente: 0, errores: 0,
    en_curso: true, inicio: new Date().toISOString(), fin: null, actual: null,
  };
  trabajos.set(cohorteId, t);
  correrGeneracion(cohorteId, t, proyectos)
    .catch((e) => { console.error(`[generar-todo] ${cohorteId}:`, e?.message); t.errores++; })
    .finally(() => { t.en_curso = false; t.actual = null; t.fin = new Date().toISOString(); });
  res.status(202).json({ ok: true, ...t });
});

router.get('/admin/:cohorteId/generar-todo/estado', ...soloAdmin, (req, res) => {
  const t = trabajos.get(req.params.cohorteId);
  res.json(t ? { existe: true, ...t } : { existe: false, en_curso: false });
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
  // Aquí el admin acaba de escribir/editar el texto a mano: si esto falla en
  // silencio pierde su trabajo y la aprobación no queda, con la UI diciendo ok.
  const campos: Record<string, unknown> = { ...parsed.data };
  const errG = await guardarContenido(req.params.proyectoId, campos);
  if (errG) return res.status(500).json({ error: 'GUARDAR_FALLIDO', detail: errG });
  res.json({ ok: true });
});

// PATCH privado: un proyecto privado sigue en esta base pero sale de la
// programación (sql/54). Si ya tenía turno se le quita y se recalcula su
// jornada. Con la programación publicada no se puede sacar a nadie.
router.patch('/admin/proyecto/:proyectoId/privado', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ privado: z.boolean() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });
  const proyectoId = req.params.proyectoId;
  const { data: p } = await supabaseAdmin
    .from('proyectos').select('id, privado, anteproyectos(equipos(cohorte_id))').eq('id', proyectoId).maybeSingle();
  if (!p) return res.status(404).json({ error: 'PROYECTO_NO_ENCONTRADO' });
  const privado = parsed.data.privado;
  if (!!(p as any).privado === privado) return res.json({ ok: true, privado });
  const ante: any = Array.isArray((p as any).anteproyectos) ? (p as any).anteproyectos[0] : (p as any).anteproyectos;
  const eq: any = Array.isArray(ante?.equipos) ? ante.equipos[0] : ante?.equipos;
  if (eq?.cohorte_id && (await programacionPublicadaAt(eq.cohorte_id))) {
    return res.status(423).json({ error: 'PROGRAMACION_PUBLICADA', message: 'La programación de esta cohorte ya está publicada: no se puede sacar ni meter proyectos.' });
  }
  const { error } = await supabaseAdmin.from('proyectos').update({ privado }).eq('id', proyectoId);
  if (error) return res.status(500).json({ error: 'GUARDAR_FALLIDO', detail: error.message });
  let quitado = false;
  if (privado) {
    const { count } = await supabaseAdmin.from('slot_presentacion').select('id', { count: 'exact', head: true }).eq('proyecto_id', proyectoId);
    if (count) {
      const errQ = await quitarDeProgramacion(proyectoId);
      if (errQ) {
        await supabaseAdmin.from('proyectos').update({ privado: false }).eq('id', proyectoId);
        return res.status(500).json({ error: 'PROGRAMACION_NO_ACTUALIZADA', detail: errQ });
      }
      quitado = true;
    }
  }
  await supabaseAdmin.from('auditoria').insert({
    actor_tipo: 'super_admin', actor_id: req.user?.profesorId ?? null,
    accion: 'ADMIN_PROYECTO_PRIVADO', entidad_tipo: 'proyectos', entidad_id: proyectoId,
    detalles: { privado, quitado_de_programacion: quitado },
    timestamp: new Date().toISOString(),
  }).then(() => { /* el rastro no debe tumbar el cambio */ }, () => { /* idem */ });
  res.json({ ok: true, privado, quitado_de_programacion: quitado });
});

// PATCH sector del proyecto (el súper admin lo corrige desde la base de datos
// de proyectos). La lista cerrada vive en frontend/src/lib/sectores.ts; aquí
// solo se valida largo (la columna es varchar(100)). Ojo: cambiar el sector no
// reacomoda una programación ya armada, y cambia el agrupado de la vista pública.
const sectorSchema = z.object({ sector: z.string().trim().min(1).max(100) });
router.patch('/admin/proyecto/:proyectoId/sector', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = sectorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'SECTOR_INVALIDO', details: parsed.error.issues });
  const { data: p } = await supabaseAdmin.from('proyectos').select('id, sector').eq('id', req.params.proyectoId).maybeSingle();
  if (!p) return res.status(404).json({ error: 'PROYECTO_NO_ENCONTRADO' });
  const nuevo = parsed.data.sector;
  if (((p as any).sector ?? '') === nuevo) return res.json({ ok: true, sector: nuevo });
  const { error } = await supabaseAdmin.from('proyectos').update({ sector: nuevo }).eq('id', req.params.proyectoId);
  if (error) return res.status(500).json({ error: 'GUARDAR_FALLIDO', detail: error.message });
  await supabaseAdmin.from('auditoria').insert({
    actor_tipo: 'super_admin',
    actor_id: req.user?.profesorId ?? null,
    accion: 'ADMIN_CAMBIAR_SECTOR_PROYECTO',
    entidad_tipo: 'proyectos',
    entidad_id: req.params.proyectoId,
    detalles: { antes: (p as any).sector ?? null, despues: nuevo },
    timestamp: new Date().toISOString(),
  }).then(() => { /* el rastro no debe tumbar el cambio */ }, () => { /* idem */ });
  res.json({ ok: true, sector: nuevo });
});

// =====================================================================
// Módulo F — Migración de archivos: subir logo / one pager a Storage
// =====================================================================

// POST /admin/proyecto/:proyectoId/asset  (multipart: campo "archivo", body/query "tipo")
router.post('/admin/proyecto/:proyectoId/asset', ...soloAdmin, upload.single('archivo'), async (req, res) => {
  const proyectoId = req.params.proyectoId;
  const tipo = ((req.body?.tipo ?? req.query.tipo) as string) as TipoAssetNaves;
  if (tipo !== 'logo' && tipo !== 'one_pager') return res.status(400).json({ error: 'TIPO_INVALIDO' });
  const file = (req as any).file as { buffer: Buffer; mimetype: string; originalname?: string } | undefined;
  if (!file) return res.status(400).json({ error: 'NO_FILE' });
  // Se decide por el contenido, y se guarda con el tipo real del archivo.
  const regla = tipo === 'logo' ? REGLAS.logo : REGLAS.onePager;
  const formato = validarFormato(file, regla);
  if (!formato.ok) return res.status(400).json(errorFormato(formato.mensaje, regla));

  // Verifica que el proyecto exista
  const { data: p } = await supabaseAdmin.from('proyectos').select('id').eq('id', proyectoId).maybeSingle();
  if (!p) return res.status(404).json({ error: 'PROYECTO_NO_ENCONTRADO' });

  try {
    const { path } = await uploadAssetNaves(proyectoId, tipo, file.buffer, formato.mime);
    const col = tipo === 'logo' ? 'logo_path' : 'one_pager_path';
    // OJO: este upsert NO lanza; sin verificar su error el archivo quedaba
    // subido a Storage (y hasta devolvíamos una URL que se veía bien) pero sin
    // guardar el enlace: al recargar, el logo/one pager no estaba y el objeto
    // quedaba huérfano en el bucket.
    const { error: errDb } = await supabaseAdmin.from('proyecto_contenido')
      .upsert({ proyecto_id: proyectoId, [col]: path, updated_at: new Date().toISOString() }, { onConflict: 'proyecto_id' });
    if (errDb) {
      await deleteAssetNaves(path).catch(() => { /* no dejar huérfano */ });
      return res.status(500).json({ error: 'ASSET_DB_FAILED', detail: errDb.message });
    }
    res.json({ ok: true, url: crearUrlProxyArchivo(path, mimeFromPath(path)) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'UPLOAD_ERROR' });
  }
});

// DELETE /admin/proyecto/:proyectoId/asset?tipo=logo|one_pager
router.delete('/admin/proyecto/:proyectoId/asset', ...soloAdmin, async (req, res) => {
  const proyectoId = req.params.proyectoId;
  const tipo = req.query.tipo as TipoAssetNaves;
  if (tipo !== 'logo' && tipo !== 'one_pager') return res.status(400).json({ error: 'TIPO_INVALIDO' });
  const col = tipo === 'logo' ? 'logo_path' : 'one_pager_path';
  const { data: prev } = await supabaseAdmin.from('proyecto_contenido').select(col).eq('proyecto_id', proyectoId).maybeSingle();
  const path = (prev as any)?.[col];
  if (path) { try { await deleteAssetNaves(path); } catch { /* best-effort */ } }
  await supabaseAdmin.from('proyecto_contenido').upsert({ proyecto_id: proyectoId, [col]: null, updated_at: new Date().toISOString() }, { onConflict: 'proyecto_id' });
  res.json({ ok: true });
});

export default router;
