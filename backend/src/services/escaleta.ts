import { supabaseAdmin } from '../db/supabase.js';
import { proyectosProgramables, type ProyectoFase2 } from './proyectos-fase2.js';

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
  // Defensivo: un minuto negativo no es una hora, es un error de cálculo aguas
  // arriba. Sin esto, Math.floor y % con negativos escupían cosas como "-1:-5".
  if (!Number.isFinite(min) || min < 0) return '--:--';
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

// Lo que decide cada jornada por su cuenta. El resto de tiempos (exposición,
// transición, break, cierre, slots por bloque) son de la cohorte y viven en
// Config: valen igual para los dos días.
export interface OpcionesJornada {
  inicioMin: number;
  foto: boolean;
  introMin: number;
  // Break largo propio de la jornada. Es OTRA cosa que el break automático de
  // fin de bloque (C.break_min, común a toda la cohorte) y otra cosa que el
  // almuerzo: una jornada puede tener los tres.
  breakJornada: boolean;
  breakJornadaMin: number;
  breakJornadaTrasSlot: number | null;
  almuerzo: boolean;              // ¿esta jornada para a almorzar?
  almuerzoMin: number;            // cuánto dura ese almuerzo, en minutos
  almuerzoTrasSlot: number | null; // tras qué presentación cae; null = automático
}

/**
 * ¿Después de qué presentación cae una pausa larga (break de jornada o almuerzo)?
 *
 * Si el admin la fijó, se respeta (acotada: nunca antes de la 1ª presentación ni
 * después de la última, donde ya va el cierre). Si no, el sistema parte la
 * jornada por la mitad y se pega al corte de bloque más cercano: así la pausa
 * SUSTITUYE al break de bloque que iba a caer ahí en vez de sumar una segunda
 * pausa pegada. Sin cortes de bloque (todo cabe en un bloque) parte por la
 * mitad seca.
 *
 * Devuelve 0 cuando no hay dónde partir el día (0 o 1 presentación).
 */
export function slotDePausa(total: number, bloque: number, trasSlot: number | null): number {
  if (total < 2) return 0;
  if (trasSlot != null) return Math.min(Math.max(trasSlot, 1), total - 1);
  const mitad = Math.round(total / 2);
  const cortes: number[] = [];
  for (let n = bloque; n < total; n += bloque) cortes.push(n);
  if (!cortes.length) return mitad;
  return cortes.reduce((mejor, n) => (Math.abs(n - mitad) < Math.abs(mejor - mitad) ? n : mejor), cortes[0]);
}

// Porta construirDia del prototipo: dada la hora de INICIO DE LA JORNADA, si hay
// foto/intro/almuerzo y la lista de equipos, devuelve las filas con horarios.
//
// La hora de inicio es la de la primera actividad del día (foto o introducción),
// no la de la primera presentación. Antes era al revés y la foto y la intro se
// calculaban hacia atrás: el admin ponía 07:25 y la jornada arrancaba a las
// 06:40, que no es lo que nadie espera al escribir la hora de inicio (JMV,
// 17-nov-2026).
export function computarJornada(J: OpcionesJornada, proyectos: Array<any>, slotBase: number, esUltimoDia: boolean, C: Config): Fila[] {
  const { inicioMin, foto, introMin } = J;
  const filas: Fila[] = [];
  // Sin hora de inicio (toMin devuelve 0) no hay escaleta que calcular. No
  // inventamos un horario: se devuelven los proyectos asignados sin hora (-1), y
  // la pantalla pide la hora. Quien guarde estas filas debe guardar la hora como
  // null (toHHMM(-1) da "--:--", que la base rechaza).
  const sinHora = inicioMin <= 0;
  if (sinHora) {
    proyectos.forEach((e, i) => filas.push({
      tipo: 'proyecto', slot: slotBase + i, proyecto_id: e.proyecto_id,
      proyecto: e.proyecto, autores: e.autores, sector: e.sector, ini: -1, fin: -1,
    }));
    return filas;
  }
  // Foto + intro abren la jornada a la hora de inicio; luego una transición y
  // la primera presentación. Sin foto ni intro, la jornada abre presentando.
  let t = inicioMin;
  if (foto) { filas.push({ tipo: 'foto', desc: 'Toma de foto de grupo — Puerta principal', ini: t, fin: t + C.foto }); t += C.foto; }
  if (introMin > 0) { filas.push({ tipo: 'intro', desc: 'Introducción', ini: t, fin: t + introMin }); t += introMin; }
  if (foto || introMin > 0) t += C.trans;
  const total = proyectos.length;
  const trasAlmuerzo = J.almuerzo ? slotDePausa(total, C.bloque, J.almuerzoTrasSlot) : 0;
  let trasBreakJornada = J.breakJornada ? slotDePausa(total, C.bloque, J.breakJornadaTrasSlot) : 0;
  // Si el break de la jornada y el almuerzo caen en el mismo punto (típico
  // cuando los dos están en automático), manda el almuerzo: dos pausas largas
  // seguidas no parten la jornada, hacen un hueco. Para tenerlos los dos hay
  // que fijar al menos uno "tras el slot N".
  if (trasBreakJornada && trasBreakJornada === trasAlmuerzo) trasBreakJornada = 0;
  for (let i = 0; i < total; i++) {
    const e = proyectos[i];
    filas.push({ tipo: 'proyecto', slot: slotBase + i, proyecto_id: e.proyecto_id, proyecto: e.proyecto, autores: e.autores, sector: e.sector, ini: t, fin: t + C.expo });
    t += C.expo;
    const count = i + 1;
    const ultimo = i === total - 1;
    const finBloque = count % C.bloque === 0;
    const esAlmuerzo = !ultimo && count === trasAlmuerzo;
    const esBreakJornada = !ultimo && count === trasBreakJornada;
    if (ultimo) {
      t += C.trans;
      filas.push({ tipo: 'cierre', desc: (esUltimoDia ? 'Evaluación y Cierre' : 'Cierre de jornada') + ' — Toma de foto', ini: t, fin: t + C.cierre }); t += C.cierre;
    } else if (esAlmuerzo || esBreakJornada || finBloque) {
      t += C.trans;
      if (esAlmuerzo) {
        // El almuerzo SUSTITUYE al break de bloque cuando caen en el mismo
        // punto: dos pausas seguidas no son una jornada partida, son un hueco.
        filas.push({ tipo: 'almuerzo', desc: 'Almuerzo', ini: t, fin: t + J.almuerzoMin }); t += J.almuerzoMin;
      } else if (esBreakJornada) {
        // El break largo de la jornada: mismo criterio, sustituye al de bloque.
        filas.push({ tipo: 'break', desc: 'Break — Toma de foto', ini: t, fin: t + J.breakJornadaMin }); t += J.breakJornadaMin;
      } else {
        filas.push({ tipo: 'break', desc: 'Break — Toma de foto', ini: t, fin: t + C.break_min }); t += C.break_min;
      }
      t += C.trans;
    } else {
      t += C.trans;
    }
  }
  return filas;
}

// La hora de FIN de una jornada no se elige: es un resultado. La jornada termina
// cuando termina su última franja — el cierre, que va justo después del último
// slot. Ponerla a mano era pedir un dato que el sistema ya sabe calcular, y que
// se quedaba desfasado en cuanto se agregaba o quitaba un proyecto.
//
// Devuelve null cuando no hay escaleta que terminar: sin hora de inicio (las
// filas llegan con -1) o sin ningún proyecto asignado (solo foto e intro).
export function finDeJornada(filas: Fila[]): string | null {
  if (!filas.some((f) => f.tipo === 'proyecto')) return null;
  const fin = filas.reduce((max, f) => (f.fin > max ? f.fin : max), -1);
  return fin > 0 ? toHHMM(fin) : null;
}

// `jornadas.hora_fin` se conserva como columna porque hay consumidores que
// muestran la hora de fin sin calcular la escaleta: el listado de Panelistas, el
// correo de logística y el portal de confirmación del panelista. Es una copia
// derivada, así que se reescribe cuando deja de coincidir con el cálculo.
async function persistirHoraFin(jornadaId: string, guardada: string | null | undefined, calculada: string | null): Promise<void> {
  const norm = (h: string | null | undefined) => (h ? String(h).slice(0, 5) : null);
  if (norm(guardada) === norm(calculada)) return;
  await supabaseAdmin.from('jornadas').update({ hora_fin: calculada }).eq('id', jornadaId);
}

// Las jornadas de presentación salen del cronograma de la cohorte: el hito 12
// ("Primera jornada presentaciones (ANCLA)") y el 13 ("Segunda jornada
// presentaciones"). Ver 08_cohorte_hitos.sql.
const HITO_JORNADA: Array<{ posicion: number; numero: number }> = [
  { posicion: 12, numero: 1 },
  { posicion: 13, numero: 2 },
];

/**
 * Alinea las jornadas de la cohorte con las fechas del cronograma.
 *
 * Antes la fecha de las presentaciones vivía en DOS sitios sin relación:
 * `cohorte_hitos` (12/13), que se fija al crear la cohorte, y `jornadas`, que se
 * tecleaba a mano en la pantalla de Panelistas. Nada comprobaba que coincidieran
 * y de hecho no coincidían: en la cohorte de prueba la jornada quedó con la
 * fecha del hito 11 (la reunión de preparación). Preguntar una fecha que el
 * sistema ya conoce es pedirle al usuario que la teclee mal.
 *
 * Ahora el cronograma manda: la jornada sigue al hito. Solo se sincroniza si la
 * programación NO está publicada — una vez publicada es definitiva y mover la
 * fecha por detrás sería exactamente lo que el candado impide.
 *
 * La HORA no viene del cronograma (los hitos son DATE) y se conserva: es
 * configuración del evento, no del calendario académico.
 */
export async function sincronizarJornadasDesdeHitos(cohorteId: string): Promise<void> {
  if (await programacionPublicadaAt(cohorteId)) return;

  const { data: hitos } = await supabaseAdmin
    .from('cohorte_hitos').select('posicion, fecha')
    .eq('cohorte_id', cohorteId)
    .in('posicion', HITO_JORNADA.map((h) => h.posicion));
  if (!hitos?.length) return;
  const fechaDe = new Map((hitos as any[]).map((h) => [h.posicion, h.fecha]));

  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select('id, numero, fecha').eq('cohorte_id', cohorteId);
  const jornadaDe = new Map((jornadas ?? []).map((j: any) => [j.numero, j]));

  for (const { posicion, numero } of HITO_JORNADA) {
    const fecha = fechaDe.get(posicion);
    // Hito sin fecha: no hay jornada que derivar. No se borra la existente —
    // podría tener proyectos ya asignados y borrarla los arrastraría en cascada.
    if (!fecha) continue;

    const j: any = jornadaDe.get(numero);
    if (!j) {
      await supabaseAdmin.from('jornadas').insert({ cohorte_id: cohorteId, numero, fecha });
    } else if (j.fecha !== fecha) {
      await supabaseAdmin.from('jornadas').update({ fecha }).eq('id', j.id);
    }
  }
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

// Columnas de `jornadas` que necesita el motor. Constante porque son CINCO
// consultas repartidas en tres archivos: olvidar una columna en una de ellas no
// rompe el build, solo hace que esa pantalla calcule con el valor por defecto y
// muestre una escaleta distinta a la de al lado.
export const COLS_JORNADA =
  'id, numero, fecha, hora_inicio, hora_fin, foto_inicial, intro_min, '
  + 'break_jornada, break_jornada_min, break_jornada_tras_slot, '
  + 'almuerzo, almuerzo_min, almuerzo_tras_slot';

// Traduce una fila de `jornadas` a las opciones que entiende el motor.
export function opcionesDeJornada(j: any): OpcionesJornada {
  return {
    inicioMin: toMin(j.hora_inicio),
    foto: !!j.foto_inicial,
    introMin: j.intro_min ?? 0,
    breakJornada: !!j.break_jornada,
    breakJornadaMin: j.break_jornada_min ?? 60,
    breakJornadaTrasSlot: j.break_jornada_tras_slot ?? null,
    almuerzo: !!j.almuerzo,
    almuerzoMin: j.almuerzo_min ?? 60,
    almuerzoTrasSlot: j.almuerzo_tras_slot ?? null,
  };
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
// La numeración de las presentaciones es CORRIDA en todo el evento: si la
// jornada 1 termina en la 20, la jornada 2 empieza en la 21 (JMV, 17-nov-2026).
// En la base cada jornada guarda su orden desde 1; el número que se muestra es
// ese orden más los proyectos de las jornadas anteriores. `slotBase` es el
// número de la primera presentación de esta jornada.
export async function jornadaConSlots(jornada: any, C: Config, esUltimo: boolean, pf: Map<string, ProyectoFase2>, slotBase = 1) {
  const { data: slots } = await supabaseAdmin
    .from('slot_presentacion').select('orden, proyecto_id').eq('jornada_id', jornada.id).order('orden');
  // Un slot asignado a un equipo que ya NO entra a Fase 2 (entrega incompleta:
  // le falta alguno de los 4 documentos, o el proyecto fue borrado) NO debe
  // ocupar un renglón. Se omite y la escaleta renumera/recalcula los horarios sin
  // él. Si el equipo completa sus documentos vuelve a `pf` y su slot reaparece.
  const proyectos = (slots ?? [])
    .filter((s: any) => pf.has(s.proyecto_id))
    .map((s: any) => ({ ...(pf.get(s.proyecto_id) as ProyectoFase2), proyecto_id: s.proyecto_id }));
  const filas = computarJornada(opcionesDeJornada(jornada), proyectos, slotBase, esUltimo, C);
  // El fin se recalcula en CADA lectura, no solo al editar la jornada: la
  // escaleta se mueve sin pasar por la pantalla de programación (basta con que un
  // equipo complete o pierda alguno de sus 4 documentos y entre o salga de `pf`,
  // o que cambien los tiempos del evento). Recalcular al leer es lo único que
  // garantiza que la copia guardada nunca contradiga lo que se está mostrando.
  const hora_fin = finDeJornada(filas);
  await persistirHoraFin(jornada.id, jornada.hora_fin, hora_fin);
  return { jornada: { ...jornada, hora_fin }, proyectos, filas };
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
  const pf = await proyectosProgramables(cohorteId);
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select(COLS_JORNADA)
    .eq('cohorte_id', cohorteId).order('numero');

  const out: JornadaEscaleta[] = [];
  const total = (jornadas ?? []).length;
  let base = 1;
  for (let i = 0; i < total; i++) {
    const j: any = (jornadas as any[])[i];
    const jc = await jornadaConSlots(j, C, i === total - 1, pf, base);
    base += jc.proyectos.length;
    out.push({
      numero: j.numero,
      fecha: j.fecha,
      fecha_legible: fechaLegibleProg(j.fecha),
      hora_inicio: j.hora_inicio,
      hora_fin: jc.jornada.hora_fin,
      filas: jc.filas,
    });
  }
  return { evento_nombre: C.evento_nombre, jornadas: out };
}

// Recalcula (y guarda) la hora de fin de todas las jornadas de una cohorte.
// Lo llaman las pantallas de panelistas, que muestran el horario de la jornada
// pero no construyen la escaleta: sin esto verían la última copia guardada, que
// puede ser de antes del último cambio en la programación.
export async function recalcularFinesDeJornadas(cohorteId: string): Promise<void> {
  const C = await getConfig(cohorteId);
  const pf = await proyectosProgramables(cohorteId);
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select(COLS_JORNADA)
    .eq('cohorte_id', cohorteId).order('numero');
  const total = (jornadas ?? []).length;
  for (let i = 0; i < total; i++) {
    await jornadaConSlots((jornadas as any[])[i], C, i === total - 1, pf);
  }
}

// Horario de cada proyecto programado, calculado con la escaleta del momento
// (la misma que se ve en la pantalla de programación). Los avisos, «Mi
// presentación», el .ics y el Excel de la base de proyectos leen de aquí: así
// nunca muestran una hora guardada que ya no coincide con la pantalla (p. ej.
// después de cambiar los tiempos del evento o la hora de inicio de un día).
export interface HorarioCalculado { jornada_id: string; jornada: number; fecha: string; slot: number; hora_inicio: string | null; hora_fin: string | null; }
export async function horariosCalculados(cohorteId: string): Promise<Map<string, HorarioCalculado>> {
  const C = await getConfig(cohorteId);
  const pf = await proyectosProgramables(cohorteId);
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select(COLS_JORNADA)
    .eq('cohorte_id', cohorteId).order('numero');
  const out = new Map<string, HorarioCalculado>();
  const total = (jornadas ?? []).length;
  let base = 1;
  for (let i = 0; i < total; i++) {
    const j: any = (jornadas as any[])[i];
    const jc = await jornadaConSlots(j, C, i === total - 1, pf, base);
    base += jc.proyectos.length;
    for (const f of jc.filas) {
      if (f.tipo !== 'proyecto' || !f.proyecto_id) continue;
      out.set(f.proyecto_id, {
        jornada_id: j.id, jornada: j.numero, fecha: j.fecha, slot: f.slot!,
        hora_inicio: f.ini >= 0 ? toHHMM(f.ini) : null, hora_fin: f.fin >= 0 ? toHHMM(f.fin) : null,
      });
    }
  }
  return out;
}

// Reescribe las horas guardadas en slot_presentacion para que coincidan con la
// escaleta calculada. Las horas guardadas son una copia: solo se escribían al
// repartir o al reordenar, y se quedaban viejas si después cambiaban los tiempos
// del evento o las opciones de una jornada. Se llama tras cada cambio y antes de
// publicar o avisar. Un slot de un proyecto que ya no es programable queda sin
// hora. No toca el orden. Devuelve cuántos slots corrigió.
export async function sincronizarHorasGuardadas(cohorteId: string): Promise<number> {
  const calc = await horariosCalculados(cohorteId);
  const { data: jornadas } = await supabaseAdmin.from('jornadas').select('id').eq('cohorte_id', cohorteId);
  const ids = (jornadas ?? []).map((j: any) => j.id);
  if (!ids.length) return 0;
  const { data: slots } = await supabaseAdmin
    .from('slot_presentacion').select('id, jornada_id, proyecto_id, hora_inicio, hora_fin').in('jornada_id', ids);
  const norm = (h: string | null | undefined) => (h ? String(h).slice(0, 5) : null);
  let corregidos = 0;
  for (const s of (slots ?? []) as any[]) {
    const h = s.proyecto_id ? calc.get(s.proyecto_id) : undefined;
    const ini = h && h.jornada_id === s.jornada_id ? h.hora_inicio : null;
    const fin = h && h.jornada_id === s.jornada_id ? h.hora_fin : null;
    if (norm(s.hora_inicio) === ini && norm(s.hora_fin) === fin) continue;
    const { error } = await supabaseAdmin.from('slot_presentacion').update({ hora_inicio: ini, hora_fin: fin }).eq('id', s.id);
    if (!error) corregidos++;
  }
  return corregidos;
}

// Lo que falta para poder publicar: proyectos programables sin turno, días con
// presentaciones pero sin hora de inicio, y proyectos fijados a un día que
// quedaron en otro. Lista vacía = se puede publicar.
export async function problemasParaPublicar(cohorteId: string): Promise<string[]> {
  const pf = await proyectosProgramables(cohorteId);
  const calc = await horariosCalculados(cohorteId);
  const problemas: string[] = [];
  const sinTurno = [...pf.values()].filter((p) => !calc.has(p.proyecto_id)).map((p) => p.proyecto);
  if (sinTurno.length) problemas.push(`${sinTurno.length} proyecto(s) sin programar: ${sinTurno.join('; ')}.`);
  const sinHora = [...new Set([...calc.values()].filter((h) => !h.hora_inicio).map((h) => h.jornada))].sort();
  if (sinHora.length) problemas.push(`La(s) jornada(s) ${sinHora.join(', ')} tiene(n) presentaciones pero no tiene(n) hora de inicio.`);
  if (pf.size) {
    const { data: fijos } = await supabaseAdmin.from('proyectos').select('id, jornada_fija').in('id', [...pf.keys()]).not('jornada_fija', 'is', null);
    const malUbicados = ((fijos ?? []) as any[])
      .filter((p) => calc.has(p.id) && calc.get(p.id)!.jornada !== p.jornada_fija)
      .map((p) => `${pf.get(p.id)!.proyecto} (fijado a la jornada ${p.jornada_fija}, está en la ${calc.get(p.id)!.jornada})`);
    if (malUbicados.length) problemas.push(`Proyecto(s) en un día distinto al fijado: ${malUbicados.join('; ')}.`);
  }
  return problemas;
}

// Saca un proyecto de la programación (p. ej. al marcarlo privado, sql/54) y
// recalcula la jornada en la que estaba: los que quedan se renumeran y corren
// sus horarios para no dejar un hueco. Devuelve null si todo bien o el error.
// Ojo: llamar DESPUÉS de marcar el proyecto como privado, para que
// proyectosProgramables ya no lo incluya.
export async function quitarDeProgramacion(proyectoId: string): Promise<string | null> {
  const { data: slots } = await supabaseAdmin.from('slot_presentacion').select('jornada_id').eq('proyecto_id', proyectoId);
  for (const jid of [...new Set(((slots ?? []) as any[]).map((s) => s.jornada_id as string))]) {
    const { data: jornada } = await supabaseAdmin.from('jornadas').select(`cohorte_id, ${COLS_JORNADA}`).eq('id', jid).maybeSingle();
    if (!jornada) continue;
    const { data: prev } = await supabaseAdmin
      .from('slot_presentacion').select('jornada_id, orden, proyecto_id, hora_inicio, hora_fin').eq('jornada_id', jid).order('orden');
    const pf = await proyectosProgramables((jornada as any).cohorte_id);
    const C = await getConfig((jornada as any).cohorte_id);
    const restantes = ((prev ?? []) as any[]).filter((s) => s.proyecto_id && s.proyecto_id !== proyectoId);
    const conDatos = restantes.filter((s) => pf.has(s.proyecto_id));
    // Los que no están en pf (p. ej. entrega incompleta) se conservan al final,
    // sin hora: jornadaConSlots ya los omite al mostrar.
    const sinDatos = restantes.filter((s) => !pf.has(s.proyecto_id));
    const filas = computarJornada(opcionesDeJornada(jornada), conDatos.map((s) => pf.get(s.proyecto_id)!), 1, false, C)
      .filter((f) => f.tipo === 'proyecto');
    const nuevas = [
      ...filas.map((f) => ({
        jornada_id: jid, orden: f.slot, proyecto_id: f.proyecto_id ?? null,
        hora_inicio: f.ini >= 0 ? toHHMM(f.ini) : null, hora_fin: f.fin >= 0 ? toHHMM(f.fin) : null,
      })),
      ...sinDatos.map((s, i) => ({ jornada_id: jid, orden: filas.length + i + 1, proyecto_id: s.proyecto_id, hora_inicio: null, hora_fin: null })),
    ];
    const { error: errDel } = await supabaseAdmin.from('slot_presentacion').delete().eq('jornada_id', jid);
    if (errDel) return errDel.message;
    if (nuevas.length) {
      const { error: errIns } = await supabaseAdmin.from('slot_presentacion').insert(nuevas);
      if (errIns) {
        if ((prev ?? []).length) await supabaseAdmin.from('slot_presentacion').insert(prev as any[]);
        return errIns.message;
      }
    }
  }
  return null;
}
