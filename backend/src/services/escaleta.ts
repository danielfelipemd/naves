import { supabaseAdmin } from '../db/supabase.js';
import { proyectosFase2, type ProyectoFase2 } from './proyectos-fase2.js';

// Motor de escaleta del evento (Módulo B). Vive aquí, y no dentro de la ruta de
// admin, porque hay DOS consumidores con permisos distintos: la programación de
// presentaciones (super_admin, edita) y la Programación Interna (marketing,
// operaciones y asistente de programa, solo lee). Si cada uno calculara por su
// lado, las áreas podrían ver horarios que no son los que el admin publicó.

export interface Config { expo: number; trans: number; foto: number; cierre: number; break_min: number; bloque: number; }
export interface Fila { tipo: string; slot?: number; proyecto_id?: string | null; proyecto?: string; autores?: string; sector?: string; ini: number; fin: number; desc?: string; }

export const toMin = (hhmm: string | null): number => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};
export const toHHMM = (min: number): string => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const MESES_PROG = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_PROG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function fechaLegibleProg(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DIAS_PROG[dow]} ${d} de ${MESES_PROG[m]} de ${y}`;
}

// Porta construirDia del prototipo: dado la hora de inicio (1ª presentación),
// si hay foto/intro y la lista de equipos, devuelve las filas con horarios.
export function computarJornada(inicioMin: number, foto: boolean, introMin: number, proyectos: Array<any>, slotBase: number, esUltimoDia: boolean, C: Config): Fila[] {
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

// ¿Ya se publicó la programación de esta cohorte? Publicar es definitivo: a
// partir de ahí nada que altere los horarios puede tocarse (31_publicar_programacion.sql).
//
// Vive aquí, y no en la ruta de programación, porque las JORNADAS se editan y se
// borran desde la pantalla de Panelistas: borrar una jornada arrastra sus slots
// en cascada y destruiría una programación ya publicada por la puerta de atrás.
// Las dos rutas tienen que consultar el mismo candado.
export async function programacionPublicadaAt(cohorteId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('programacion_config').select('publicada_at').eq('cohorte_id', cohorteId).maybeSingle();
  return (data as any)?.publicada_at ?? null;
}

export async function getConfig(cohorteId: string): Promise<Config & { evento_nombre: string }> {
  const { data } = await supabaseAdmin.from('programacion_config').select('*').eq('cohorte_id', cohorteId).maybeSingle();
  const c: any = data ?? {};
  return {
    evento_nombre: c.evento_nombre ?? 'NAVES',
    expo: c.expo_min ?? 20, trans: c.trans_min ?? 5, foto: c.foto_min ?? 10,
    cierre: c.cierre_min ?? 20, break_min: c.break_min ?? 30, bloque: c.bloque ?? 5,
  };
}

// Estado completo de una jornada (filas calculadas).
export async function jornadaConSlots(jornada: any, C: Config, esUltimo: boolean, pf: Map<string, ProyectoFase2>) {
  const { data: slots } = await supabaseAdmin
    .from('slot_presentacion').select('orden, proyecto_id').eq('jornada_id', jornada.id).order('orden');
  const proyectos = (slots ?? []).map((s: any) => ({ ...(pf.get(s.proyecto_id) ?? { proyecto: '(sin asignar)', autores: '', sector: '' }), proyecto_id: s.proyecto_id }));
  const filas = computarJornada(toMin(jornada.hora_inicio), !!jornada.foto_inicial, jornada.intro_min ?? 0, proyectos, 1, esUltimo, C);
  return { jornada, proyectos, filas };
}

export interface JornadaEscaleta {
  numero: number;
  fecha: string;
  fecha_legible: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  filas: Fila[];
}

// La escaleta completa de una cohorte, jornada por jornada. Es la vista que
// consume la Programación Interna: solo horarios y qué ocurre en cada franja.
export async function escaletaDeCohorte(cohorteId: string): Promise<{ evento_nombre: string; jornadas: JornadaEscaleta[] }> {
  const C = await getConfig(cohorteId);
  const pf = await proyectosFase2(cohorteId);
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select('id, numero, fecha, hora_inicio, hora_fin, foto_inicial, intro_min')
    .eq('cohorte_id', cohorteId).order('numero');

  const out: JornadaEscaleta[] = [];
  const total = (jornadas ?? []).length;
  for (let i = 0; i < total; i++) {
    const j: any = (jornadas as any[])[i];
    const jc = await jornadaConSlots(j, C, i === total - 1, pf);
    out.push({
      numero: j.numero,
      fecha: j.fecha,
      fecha_legible: fechaLegibleProg(j.fecha),
      hora_inicio: j.hora_inicio,
      hora_fin: j.hora_fin,
      filas: jc.filas,
    });
  }
  return { evento_nombre: C.evento_nombre, jornadas: out };
}
