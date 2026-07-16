import { Router } from 'express';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth } from '../auth/middleware.js';
import { requirePermission } from '../auth/permissions.js';
import { decryptPII } from '../auth/crypto.js';
import { escaletaDeCohorte, toHHMM, type Fila, type JornadaEscaleta } from '../services/escaleta.js';

// Programación Interna (Fase 2) — lo que marketing, operaciones y el asistente
// de programa necesitan para saber qué actividad les toca. Solo lectura.
//
// Se alimenta de dos fuentes que ya existen:
//   1. La escaleta del evento (Módulo B) — qué pasa a cada hora.
//   2. Los panelistas y su logística (Módulo A) — quién viene cada jornada, a
//      quién hay que recoger y quién come. Ese dato lo dejan los propios
//      evaluadores en el formulario público de la programación de panelistas.
//
// NO es la ruta de admin con otro rol: /programacion/admin/:cohorteId devuelve
// además la configuración editable, los proyectos programables y los equipos sin
// definitivo — interno de coordinación. Por eso este router recorta aparte.

const router = Router();
router.use(requireAuth(), requirePermission('programacion_interna.ver'));

/**
 * La cohorte que ven las áreas. No pertenecen a ninguna (no hay cohorte_id en su
 * JWT), así que hay que resolverla.
 *
 * Se resuelve por PROGRAMACIÓN PUBLICADA, no por "la cohorte activa más
 * reciente": puede haber varias cohortes marcadas activas a la vez (hoy conviven
 * una real y una de pruebas), y esa heurística eligiría por fecha de inicio, que
 * no tiene nada que ver con qué evento se está montando. Con esta regla lo que
 * ven las áreas depende de un acto explícito del admin —publicar— y no de un
 * campo que alguien dejó marcado.
 *
 * Si hubiera varias publicadas, gana la última publicada.
 */
async function cohorteDeLasAreas(): Promise<{ id: string; etiqueta: string; publicada_at: string } | null> {
  const { data: configs } = await supabaseAdmin
    .from('programacion_config')
    .select('cohorte_id, publicada_at')
    .not('publicada_at', 'is', null)
    .order('publicada_at', { ascending: false });
  if (!configs?.length) return null;

  // Solo cohortes activas: una publicada de un evento ya cerrado no debe
  // reaparecer si alguien vuelve a activar algo.
  const { data: cohortes } = await supabaseAdmin
    .from('cohortes').select('id, etiqueta')
    .eq('activa', true)
    .in('id', configs.map((c: any) => c.cohorte_id));
  const activas = new Map((cohortes ?? []).map((c: any) => [c.id, c.etiqueta]));

  for (const c of configs as any[]) {
    const etiqueta = activas.get(c.cohorte_id);
    if (etiqueta) return { id: c.cohorte_id, etiqueta, publicada_at: c.publicada_at };
  }
  return null;
}

function filaPublica(f: Fila) {
  return {
    tipo: f.tipo,
    slot: f.slot ?? null,
    hora_inicio: toHHMM(f.ini),
    hora_fin: toHHMM(f.fin),
    titulo: f.tipo === 'proyecto' ? (f.proyecto ?? '') : (f.desc ?? ''),
    autores: f.autores ?? '',
    sector: f.sector ?? '',
  };
}

const tienePresentaciones = (j: JornadaEscaleta) => j.filas.some((f) => f.tipo === 'proyecto');

interface PanelistaJornada {
  nombre: string;
  email: string;
  confirmado: boolean;
  necesita_transporte: boolean;
  direccion_recogida: string | null;
  hora_recogida: string | null;
  almuerzo: boolean;
  desayuno: boolean;
}

/**
 * Panelistas activos de la cohorte, agrupados por jornada, con la logística ya
 * resuelta para la FECHA de esa jornada.
 *
 * La logística se guarda como JSONB con clave = fecha ISO (el panelista puede
 * pedir transporte el viernes y no el sábado), así que "¿necesita transporte?"
 * solo tiene respuesta una vez fijada la jornada. Resolverlo aquí evita que cada
 * pantalla reinterprete el JSONB por su cuenta.
 *
 * `necesita_transporte` a nivel de fila es el interruptor general: si el
 * panelista dijo que no necesita transporte, el mapa por fecha no manda.
 */
async function panelistasPorJornada(cohorteId: string): Promise<Map<string, PanelistaJornada[]>> {
  const out = new Map<string, PanelistaJornada[]>();

  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select('id, fecha').eq('cohorte_id', cohorteId);
  if (!jornadas?.length) return out;

  const { data: panelistas } = await supabaseAdmin
    .from('panelistas')
    .select('id, nombre_completo, email_encriptado, asiste_todas, confirmado')
    .eq('cohorte_id', cohorteId)
    .eq('activo', true)
    .order('nombre_completo');
  if (!panelistas?.length) return out;

  const ids = panelistas.map((p: any) => p.id);
  const [{ data: pj }, { data: logs }] = await Promise.all([
    supabaseAdmin.from('panelista_jornadas').select('panelista_id, jornada_id').in('panelista_id', ids),
    supabaseAdmin.from('logistica_panelista').select('*').in('panelista_id', ids),
  ]);

  const jornadasDe = new Map<string, string[]>();
  for (const r of (pj ?? []) as any[]) {
    jornadasDe.set(r.panelista_id, [...(jornadasDe.get(r.panelista_id) ?? []), r.jornada_id]);
  }
  const logDe = new Map((logs ?? []).map((l: any) => [l.panelista_id, l]));

  for (const j of jornadas as any[]) {
    const filas: PanelistaJornada[] = [];
    for (const p of panelistas as any[]) {
      const asiste = p.asiste_todas || (jornadasDe.get(p.id) ?? []).includes(j.id);
      if (!asiste) continue;

      const log: any = logDe.get(p.id) ?? {};
      // El correo va cifrado (patrón PII del sistema). Si un registro no
      // descifra, se muestra la fila igual: perder al panelista de la lista de
      // recogida es peor que quedarse sin su correo.
      let email = '';
      try { email = decryptPII(p.email_encriptado); } catch { email = ''; }

      const transporteEseDia = log.necesita_transporte === true
        && (log.transporte_por_fecha?.[j.fecha] ?? false) === true;

      filas.push({
        nombre: p.nombre_completo,
        email,
        confirmado: !!p.confirmado,
        necesita_transporte: transporteEseDia,
        direccion_recogida: transporteEseDia ? (log.direccion_recogida ?? null) : null,
        hora_recogida: transporteEseDia && log.hora_recogida ? String(log.hora_recogida).slice(0, 5) : null,
        almuerzo: (log.almuerzo_por_fecha?.[j.fecha] ?? false) === true,
        desayuno: (log.desayuno_por_fecha?.[j.fecha] ?? false) === true,
      });
    }
    out.set(j.id, filas);
  }
  return out;
}

// Los totales que operaciones ejecuta: cuántos recoger, cuántos platos pedir.
function resumen(ps: PanelistaJornada[]) {
  return {
    asisten: ps.length,
    confirmados: ps.filter((p) => p.confirmado).length,
    sin_confirmar: ps.filter((p) => !p.confirmado).length,
    transporte: ps.filter((p) => p.necesita_transporte).length,
    almuerzos: ps.filter((p) => p.almuerzo).length,
    desayunos: ps.filter((p) => p.desayuno).length,
  };
}

async function armarProgramacion(cohorteId: string) {
  const [{ evento_nombre, jornadas }, porJornada, { data: jRows }] = await Promise.all([
    escaletaDeCohorte(cohorteId),
    panelistasPorJornada(cohorteId),
    supabaseAdmin.from('jornadas').select('id, numero').eq('cohorte_id', cohorteId),
  ]);
  const idPorNumero = new Map((jRows ?? []).map((j: any) => [j.numero, j.id]));

  return {
    evento_nombre,
    jornadas: jornadas.filter(tienePresentaciones).map((j) => {
      const ps = porJornada.get(idPorNumero.get(j.numero) ?? '') ?? [];
      return { ...j, panelistas: ps, resumen: resumen(ps) };
    }),
  };
}

/**
 * GET /api/programacion-interna
 *
 * Las áreas SOLO ven la programación publicada. Mientras coordinación la está
 * armando, un borrador se reordena y cambia de hora; enseñárselo llevaría a
 * montar el evento sobre datos que van a cambiar. Por eso la puerta es
 * `publicada_at` y no "¿hay slots?".
 */
router.get('/', async (_req, res) => {
  const cohorte = await cohorteDeLasAreas();
  if (!cohorte) return res.json({ publicada: false, motivo: 'NO_PUBLICADA', jornadas: [] });

  const { evento_nombre, jornadas } = await armarProgramacion(cohorte.id);
  res.json({
    publicada: true,
    publicada_at: cohorte.publicada_at,
    evento_nombre,
    cohorte: cohorte.etiqueta,
    jornadas: jornadas.map((j) => ({
      numero: j.numero,
      fecha: j.fecha,
      fecha_legible: j.fecha_legible,
      filas: j.filas.map(filaPublica),
      panelistas: j.panelistas,
      resumen: j.resumen,
    })),
  });
});

/**
 * GET /api/programacion-interna/excel
 * Dos hojas por jornada: la escaleta y la lista de panelistas con su logística.
 */
router.get('/excel', async (_req, res) => {
  const cohorte = await cohorteDeLasAreas();
  if (!cohorte) return res.status(404).json({ error: 'PROGRAMACION_NO_PUBLICADA' });

  const { evento_nombre, jornadas } = await armarProgramacion(cohorte.id);
  if (!jornadas.length) return res.status(404).json({ error: 'PROGRAMACION_NO_PUBLICADA' });

  const wb = new ExcelJS.Workbook();
  const AMARILLO = 'FFFFE066', NEGRO = 'FF1A1A1A', GRIS = 'FFBFBFBF';
  const thin = { style: 'thin' as const, color: { argb: GRIS } };
  const borde = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const encabezar = (ws: ExcelJS.Worksheet, cols: string[]) => {
    const h = ws.addRow(cols);
    h.height = 28;
    h.eachCell((c) => {
      c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      c.fill = fill(NEGRO);
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = borde;
    });
  };
  const titular = (ws: ExcelJS.Worksheet, hasta: string, t1: string, t2: string) => {
    ws.addRow([t1]); ws.mergeCells(`A1:${hasta}1`);
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.addRow([t2]); ws.mergeCells(`A2:${hasta}2`);
    ws.getCell('A2').font = { bold: true, size: 12, color: { argb: 'FF6B6B6B' } };
    ws.addRow([]);
  };

  for (const j of jornadas) {
    // Hoja 1 — escaleta
    const ws = wb.addWorksheet(`J${j.numero} Programación`.slice(0, 31), { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 8 }, { width: 11 }, { width: 11 }, { width: 40 }, { width: 40 }, { width: 22 }] as any;
    titular(ws, 'F', `${evento_nombre} — Programación Interna`, `Jornada ${j.numero} · ${j.fecha_legible}`);
    encabezar(ws, ['Slot', 'Inicio', 'Fin', 'Actividad / Proyecto', 'Autores', 'Sector']);
    for (const f of j.filas) {
      const esProy = f.tipo === 'proyecto';
      const r = ws.addRow(esProy
        ? [f.slot, toHHMM(f.ini), toHHMM(f.fin), f.proyecto, f.autores, f.sector]
        : ['', toHHMM(f.ini), toHHMM(f.fin), f.desc, '', '']);
      r.height = esProy ? 34 : 22;
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.border = borde;
        c.alignment = { vertical: 'middle', wrapText: true, horizontal: (col === 4 || col === 5) ? 'left' : 'center' };
        if (!esProy) c.fill = fill(AMARILLO);
      });
      if (!esProy) ws.mergeCells(`D${r.number}:F${r.number}`);
    }

    // Hoja 2 — panelistas y logística
    const wl = wb.addWorksheet(`J${j.numero} Panelistas`.slice(0, 31), { views: [{ showGridLines: false }] });
    wl.columns = [{ width: 30 }, { width: 32 }, { width: 13 }, { width: 12 }, { width: 38 }, { width: 12 }, { width: 11 }, { width: 11 }] as any;
    titular(wl, 'H', `${evento_nombre} — Panelistas y logística`, `Jornada ${j.numero} · ${j.fecha_legible}`);
    encabezar(wl, ['Panelista', 'Correo', 'Confirmado', 'Transporte', 'Dirección de recogida', 'Hora recogida', 'Desayuno', 'Almuerzo']);
    for (const p of j.panelistas) {
      const r = wl.addRow([
        p.nombre, p.email,
        p.confirmado ? 'Sí' : 'No',
        p.necesita_transporte ? 'Sí' : 'No',
        p.direccion_recogida ?? '',
        p.hora_recogida ?? '',
        p.desayuno ? 'Sí' : 'No',
        p.almuerzo ? 'Sí' : 'No',
      ]);
      r.height = 22;
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.border = borde;
        c.alignment = { vertical: 'middle', wrapText: true, horizontal: (col === 1 || col === 2 || col === 5) ? 'left' : 'center' };
      });
    }
    if (!j.panelistas.length) {
      const r = wl.addRow(['Sin panelistas asignados a esta jornada']);
      wl.mergeCells(`A${r.number}:H${r.number}`);
      r.getCell(1).alignment = { horizontal: 'center' };
      r.getCell(1).font = { color: { argb: 'FF6B6B6B' }, italic: true };
    }
    const t = wl.addRow([]);
    const tot = wl.addRow([
      `Totales — asisten ${j.resumen.asisten} · sin confirmar ${j.resumen.sin_confirmar} · transporte ${j.resumen.transporte} · desayunos ${j.resumen.desayunos} · almuerzos ${j.resumen.almuerzos}`,
    ]);
    wl.mergeCells(`A${tot.number}:H${tot.number}`);
    tot.getCell(1).font = { bold: true };
    void t;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="NAVES_Programacion_Interna_${cohorte.id}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;
