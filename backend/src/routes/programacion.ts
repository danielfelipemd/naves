import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { notificar, limpiarNotificaciones } from '../services/notify.js';
import { proyectosFase2, autoresAuthPorProyecto, contarEquiposSinDefinitivo, type ProyectoFase2 } from '../services/proyectos-fase2.js';
import { crearUrlProxyArchivo, mimeFromPath } from '../services/storage.js';

// URL servida de un asset: proxy con token efímero si está en Storage; si no, el
// enlace externo. Mismo criterio que el Módulo C.
function urlAsset(path: string | null, urlExterna: string | null): string | null {
  if (path) return crearUrlProxyArchivo(path, mimeFromPath(path));
  return urlExterna ?? null;
}

// Módulo B (Fase 2) — Calendario / Programación de presentaciones.
// Asigna PROYECTOS DEFINITIVOS a slots por jornada y calcula los horarios.
// La Fase 2 va después de la selección: un equipo que aún no eligió su proyecto
// definitivo no es programable (ver datosProyectos).

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;

const toMin = (hhmm: string | null): number => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number): string => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const MESES_PROG = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_PROG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fechaLegibleProg(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DIAS_PROG[dow]} ${d} de ${MESES_PROG[m]} de ${y}`;
}

interface Config { expo: number; trans: number; foto: number; cierre: number; break_min: number; bloque: number; }
interface Fila { tipo: string; slot?: number; proyecto_id?: string | null; proyecto?: string; autores?: string; sector?: string; ini: number; fin: number; desc?: string; }

// Porta construirDia del prototipo: dado la hora de inicio (1ª presentación),
// si hay foto/intro y la lista de equipos, devuelve las filas con horarios.
function computarJornada(inicioMin: number, foto: boolean, introMin: number, proyectos: Array<any>, slotBase: number, esUltimoDia: boolean, C: Config): Fila[] {
  const filas: Fila[] = [];
  // Foto + intro se programan HACIA ATRÁS, terminando justo antes del slot 1.
  let t = inicioMin - C.trans - introMin - (foto ? C.foto : 0);
  if (foto) { filas.push({ tipo: 'foto', desc: 'Toma de foto de grupo — Puerta principal', ini: t, fin: t + C.foto }); t += C.foto; }
  filas.push({ tipo: 'intro', desc: 'Introducción', ini: t, fin: t + introMin }); t += introMin;
  t += C.trans; // t == inicioMin
  const total = proyectos.length;
  for (let i = 0; i < total; i++) {
    const e = proyectos[i];
    filas.push({ tipo: 'proyecto', slot: slotBase + i, proyecto_id: e.proyecto_id, proyecto: e.proyecto, autores: e.autores, sector: e.sector, ini: t, fin: t + C.expo });
    t += C.expo;
    const count = i + 1;
    const finBloque = count % C.bloque === 0;
    const ultimo = i === total - 1;
    if (finBloque || ultimo) {
      t += C.trans;
      if (ultimo) {
        filas.push({ tipo: 'cierre', desc: (esUltimoDia ? 'Evaluación y Cierre' : 'Cierre de jornada') + ' — Toma de foto', ini: t, fin: t + C.cierre }); t += C.cierre;
      } else {
        filas.push({ tipo: 'break', desc: 'Break — Toma de foto', ini: t, fin: t + C.break_min }); t += C.break_min; t += C.trans;
      }
    } else {
      t += C.trans;
    }
  }
  return filas;
}

async function getConfig(cohorteId: string): Promise<Config & { evento_nombre: string }> {
  const { data } = await supabaseAdmin.from('programacion_config').select('*').eq('cohorte_id', cohorteId).maybeSingle();
  const c: any = data ?? {};
  return {
    evento_nombre: c.evento_nombre ?? 'NAVES',
    expo: c.expo_min ?? 20, trans: c.trans_min ?? 5, foto: c.foto_min ?? 10,
    cierre: c.cierre_min ?? 20, break_min: c.break_min ?? 30, bloque: c.bloque ?? 5,
  };
}

// Estado completo de una jornada (filas calculadas).
async function jornadaConSlots(jornada: any, C: Config, esUltimo: boolean, pf: Map<string, ProyectoFase2>) {
  const { data: slots } = await supabaseAdmin
    .from('slot_presentacion').select('orden, proyecto_id').eq('jornada_id', jornada.id).order('orden');
  const proyectos = (slots ?? []).map((s: any) => ({ ...(pf.get(s.proyecto_id) ?? { proyecto: '(sin asignar)', autores: '', sector: '' }), proyecto_id: s.proyecto_id }));
  const filas = computarJornada(toMin(jornada.hora_inicio), !!jornada.foto_inicial, jornada.intro_min ?? 0, proyectos, 1, esUltimo, C);
  return { jornada, proyectos, filas };
}

// Contenido publicable (logo, one pager, resumen, post) por proyecto. Lo consume
// la tabla de programación, que muestra la ficha completa de cada presentación.
async function contenidoPorProyecto(proyIds: string[]): Promise<Map<string, any>> {
  if (!proyIds.length) return new Map();
  const { data } = await supabaseAdmin.from('proyecto_contenido').select('*').in('proyecto_id', proyIds);
  return new Map((data ?? []).map((c: any) => [c.proyecto_id, c]));
}

// GET /api/programacion/admin/:cohorteId — estado completo
router.get('/admin/:cohorteId', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const C = await getConfig(cohorteId);
  const pf = await proyectosFase2(cohorteId);
  const contenido = await contenidoPorProyecto([...pf.keys()]);
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select('id, numero, fecha, hora_inicio, hora_fin, foto_inicial, intro_min')
    .eq('cohorte_id', cohorteId).order('numero');

  const jornadasOut = [];
  for (let i = 0; i < (jornadas ?? []).length; i++) {
    const jc = await jornadaConSlots((jornadas as any[])[i], C, i === (jornadas ?? []).length - 1, pf);
    jornadasOut.push({
      id: jc.jornada.id, numero: jc.jornada.numero, fecha: jc.jornada.fecha,
      fecha_legible: fechaLegibleProg(jc.jornada.fecha),
      hora_inicio: jc.jornada.hora_inicio, hora_fin: jc.jornada.hora_fin,
      foto_inicial: jc.jornada.foto_inicial, intro_min: jc.jornada.intro_min,
      slots: jc.filas.filter((f) => f.tipo === 'proyecto').map((f) => {
        const c = f.proyecto_id ? contenido.get(f.proyecto_id) : null;
        return {
          slot: f.slot, proyecto_id: f.proyecto_id, proyecto: f.proyecto, autores: f.autores, sector: f.sector,
          hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin),
          resumen: c?.resumen ?? null, linkedin: c?.linkedin ?? null,
          one_pager_url: urlAsset(c?.one_pager_path ?? null, c?.one_pager_url ?? null),
          logo_url: urlAsset(c?.logo_path ?? null, c?.logo_url ?? null),
        };
      }),
      actividades: jc.filas.filter((f) => f.tipo !== 'proyecto').map((f) => ({ tipo: f.tipo, desc: f.desc, hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin) })),
    });
  }

  // Proyectos programables: los definitivos de la cohorte, con marca de asignado.
  const { data: slotsAll } = await supabaseAdmin
    .from('slot_presentacion').select('proyecto_id, jornada_id')
    .in('jornada_id', (jornadas ?? []).map((j: any) => j.id));
  const asignados = new Set((slotsAll ?? []).map((s: any) => s.proyecto_id).filter(Boolean));
  const proyectosDisponibles = [...pf.values()].map((d) => ({ ...d, asignado: asignados.has(d.proyecto_id) }))
    .sort((a, b) => a.proyecto.localeCompare(b.proyecto));

  res.json({
    cohorte_id: cohorteId, config: C, jornadas: jornadasOut, proyectos: proyectosDisponibles,
    equipos_sin_definitivo: await contarEquiposSinDefinitivo(cohorteId),
  });
});

// PUT config
const configSchema = z.object({
  evento_nombre: z.string().max(120).optional(),
  expo_min: z.number().int().min(1).max(120).optional(),
  trans_min: z.number().int().min(0).max(60).optional(),
  foto_min: z.number().int().min(0).max(120).optional(),
  cierre_min: z.number().int().min(0).max(120).optional(),
  break_min: z.number().int().min(0).max(240).optional(),
  bloque: z.number().int().min(1).max(50).optional(),
});
router.put('/admin/:cohorteId/config', ...soloAdmin, async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { error } = await supabaseAdmin.from('programacion_config')
    .upsert({ cohorte_id: req.params.cohorteId, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: 'cohorte_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// PUT jornada — config + asignación ordenada de proyectos, recalcula y persiste horarios
const jornadaSchema = z.object({
  foto_inicial: z.boolean().optional(),
  intro_min: z.number().int().min(0).max(120).optional(),
  proyecto_ids: z.array(z.string().uuid()).optional(),
});
router.put('/admin/jornada/:jornadaId', ...soloAdmin, async (req, res) => {
  const parsed = jornadaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const jid = req.params.jornadaId;

  const upd: Record<string, unknown> = {};
  if (parsed.data.foto_inicial !== undefined) upd.foto_inicial = parsed.data.foto_inicial;
  if (parsed.data.intro_min !== undefined) upd.intro_min = parsed.data.intro_min;
  if (Object.keys(upd).length) await supabaseAdmin.from('jornadas').update(upd).eq('id', jid);

  const { data: jornada } = await supabaseAdmin.from('jornadas').select('id, cohorte_id, hora_inicio, foto_inicial, intro_min, numero').eq('id', jid).maybeSingle();
  if (!jornada) return res.status(404).json({ error: 'NOT_FOUND' });

  if (parsed.data.proyecto_ids !== undefined) {
    const C = await getConfig((jornada as any).cohorte_id);
    const pf = await proyectosFase2((jornada as any).cohorte_id);

    // Solo se programan proyectos definitivos de esta cohorte. Un id ajeno o de
    // un equipo que aún no eligió definitivo entraría como slot fantasma (sin
    // nombre ni autores), así que se rechaza en vez de guardarlo.
    const ajenos = parsed.data.proyecto_ids.filter((id) => !pf.has(id));
    if (ajenos.length) return res.status(400).json({ error: 'PROYECTO_NO_PROGRAMABLE', proyecto_ids: ajenos });
    const repetidos = parsed.data.proyecto_ids.length !== new Set(parsed.data.proyecto_ids).size;
    if (repetidos) return res.status(400).json({ error: 'PROYECTO_DUPLICADO' });

    const proyectos = parsed.data.proyecto_ids.map((id) => pf.get(id)!);
    const filas = computarJornada(toMin((jornada as any).hora_inicio), !!(jornada as any).foto_inicial, (jornada as any).intro_min ?? 0, proyectos, 1, false, C);
    const slots = filas.filter((f) => f.tipo === 'proyecto');
    // Reemplazar slots de la jornada. OJO: es un borrar-y-reinsertar; si el
    // insert falla y no lo miramos, la jornada queda SIN horario y el admin
    // cree que guardó. Verificamos ambos pasos y avisamos si algo falla.
    const { error: errDel } = await supabaseAdmin.from('slot_presentacion').delete().eq('jornada_id', jid);
    if (errDel) return res.status(500).json({ error: 'SLOTS_DELETE_FAILED', detail: errDel.message });
    if (slots.length) {
      const { error: errIns } = await supabaseAdmin.from('slot_presentacion').insert(slots.map((f) => ({
        jornada_id: jid, orden: f.slot, proyecto_id: f.proyecto_id ?? null,
        hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin),
      })));
      if (errIns) {
        // uq_slot_proyecto: el proyecto ya está programado en OTRA jornada.
        if (errIns.code === '23505') return res.status(409).json({ error: 'PROYECTO_YA_PROGRAMADO', detail: errIns.message });
        return res.status(500).json({ error: 'SLOTS_INSERT_FAILED', detail: errIns.message });
      }
    }
  }
  res.json({ ok: true });
});

// GET Excel de calificación (server-side)
router.get('/admin/:cohorteId/excel', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const C = await getConfig(cohorteId);
  const pf = await proyectosFase2(cohorteId);
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select('id, numero, fecha, hora_inicio, foto_inicial, intro_min')
    .eq('cohorte_id', cohorteId).order('numero');

  const wb = new ExcelJS.Workbook();
  const AMARILLO = 'FFFFE066', NEGRO = 'FF1A1A1A', GRIS = 'FFBFBFBF';
  const thin = { style: 'thin' as const, color: { argb: GRIS } };
  const borde = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const fechaLegible = (iso: string) => { const [y, m, d] = iso.split('-'); const meses = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']; return `${parseInt(d, 10)} de ${meses[parseInt(m, 10)]} de ${y}`; };

  for (let i = 0; i < (jornadas ?? []).length; i++) {
    const j: any = (jornadas as any[])[i];
    const jc = await jornadaConSlots(j, C, i === (jornadas ?? []).length - 1, pf);
    const ws = wb.addWorksheet((`J${j.numero} ${fechaLegible(j.fecha)}`).slice(0, 31), { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 8 }, { width: 11 }, { width: 11 }, { width: 30 }, { width: 40 }, { width: 16 }, { width: 16 }, { width: 14 }] as any;
    ws.addRow([`${C.evento_nombre} — Hoja de calificación del panelista`]); ws.mergeCells('A1:H1'); ws.getCell('A1').font = { bold: true, size: 14 };
    ws.addRow([`Jornada ${j.numero} · ${fechaLegible(j.fecha)}`]); ws.mergeCells('A2:H2'); ws.getCell('A2').font = { bold: true, size: 12, color: { argb: 'FF6B6B6B' } };
    const rP = ws.addRow(['Panelista:']); ws.mergeCells('B3:H3'); ws.getCell('A3').font = { bold: true }; ws.getCell('B3').border = { bottom: { style: 'medium', color: { argb: NEGRO } } }; rP.height = 24;
    ws.addRow([]);
    const head = ws.addRow(['Slot', 'Inicio', 'Fin', 'Proyecto / Actividad', 'Autores', 'Calif. present. (1–5)', 'Calif. proyecto (1–5)', '¿Invertiría? (Sí/No)']);
    head.height = 44;
    head.eachCell((c) => { c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }; c.fill = fill(NEGRO); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = borde; });
    for (const f of jc.filas) {
      const esProy = f.tipo === 'proyecto';
      const r = ws.addRow(esProy
        ? [f.slot, toHHMM(f.ini), toHHMM(f.fin), f.proyecto, f.autores, '', '', '']
        : ['', toHHMM(f.ini), toHHMM(f.fin), f.desc, '', '', '', '']);
      r.height = esProy ? 40 : 22;
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.border = borde; c.alignment = { vertical: 'middle', wrapText: true, horizontal: (col === 4 || col === 5) ? 'left' : 'center' };
        if (!esProy) c.fill = fill(AMARILLO);
      });
      if (!esProy) { ws.mergeCells(`D${r.number}:E${r.number}`); }
    }
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="NAVES_Programacion_${cohorteId}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// POST /admin/:cohorteId/notificar — publica la programación: notifica a los
// integrantes del equipo de cada proyecto ya asignado la fecha/hora de su
// presentación.
router.post('/admin/:cohorteId/notificar', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select('id, numero, fecha').eq('cohorte_id', cohorteId);
  const jById = new Map((jornadas ?? []).map((j: any) => [j.id, j]));
  const ids = (jornadas ?? []).map((j: any) => j.id);
  if (!ids.length) return res.json({ ok: true, notificados: 0, proyectos: 0 });

  const { data: slots } = await supabaseAdmin
    .from('slot_presentacion').select('jornada_id, orden, proyecto_id, hora_inicio, hora_fin').in('jornada_id', ids);
  const asignados = (slots ?? []).filter((s: any) => s.proyecto_id);
  if (!asignados.length) return res.json({ ok: true, notificados: 0, proyectos: 0 });

  // Integrantes (auth_user_id) del equipo dueño de cada proyecto programado.
  const pf = await proyectosFase2(cohorteId);
  const proyectoIds = [...new Set(asignados.map((s: any) => s.proyecto_id))] as string[];
  const authsPorProyecto = await autoresAuthPorProyecto(
    proyectoIds.map((id) => pf.get(id)).filter(Boolean) as ProyectoFase2[],
  );

  const evento = (await getConfig(cohorteId)).evento_nombre ?? 'NAVES';
  const items: Array<{ destinatario_auth_id: string; tipo: string; titulo: string; cuerpo: string; enlace: string }> = [];
  const todosAuth: string[] = [];
  for (const s of asignados as any[]) {
    const j: any = jById.get(s.jornada_id); if (!j) continue;
    const auths = authsPorProyecto.get(s.proyecto_id) ?? [];
    const fl = fechaLegibleProg(j.fecha);
    for (const a of auths) {
      todosAuth.push(a);
      items.push({
        destinatario_auth_id: a, tipo: 'presentacion_programada',
        titulo: `Tu presentación de ${evento} quedó programada`,
        cuerpo: `${fl} · Jornada ${j.numero}, slot ${s.orden} · ${String(s.hora_inicio).slice(0, 5)}–${String(s.hora_fin).slice(0, 5)}.`,
        enlace: '/mi-presentacion',
      });
    }
  }
  // Evitar duplicados si se re-publica
  await limpiarNotificaciones('presentacion_programada', [...new Set(todosAuth)]);
  const n = await notificar(items);
  res.json({ ok: true, notificados: n, proyectos: proyectoIds.length });
});

export default router;
