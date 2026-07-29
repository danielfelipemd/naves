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
  almuerzo: boolean;              // ¿esta jornada para a almorzar?
  almuerzoMin: number;            // cuánto dura ese almuerzo, en minutos
  almuerzoTrasSlot: number | null; // tras qué presentación cae; null = automático
}

/**
 * ¿Después de qué presentación cae el almuerzo?
 *
 * Si el admin lo fijó, se respeta (acotado: nunca antes de la 1ª presentación ni
 * después de la última, donde ya va el cierre). Si no, el sistema parte la
 * jornada por la mitad y se pega al corte de bloque más cercano: así el almuerzo
 * SUSTITUYE al break que iba a caer ahí en vez de sumar una segunda pausa
 * pegada. Sin cortes de bloque (todo cabe en un bloque) parte por la mitad seca.
 *
 * Devuelve 0 cuando no hay dónde partir el día (0 o 1 presentación).
 */
export function slotDelAlmuerzo(total: number, bloque: number, trasSlot: number | null): number {
  if (total < 2) return 0;
  if (trasSlot != null) return Math.min(Math.max(trasSlot, 1), total - 1);
  const mitad = Math.round(total / 2);
  const cortes: number[] = [];
  for (let n = bloque; n < total; n += bloque) cortes.push(n);
  if (!cortes.length) return mitad;
  return cortes.reduce((mejor, n) => (Math.abs(n - mitad) < Math.abs(mejor - mitad) ? n : mejor), cortes[0]);
}

// Porta construirDia del prototipo: dado la hora de inicio (1ª presentación),
// si hay foto/intro/almuerzo y la lista de equipos, devuelve las filas con horarios.
export function computarJornada(J: OpcionesJornada, proyectos: Array<any>, slotBase: number, esUltimoDia: boolean, C: Config): Fila[] {
  const { inicioMin, foto, introMin } = J;
  const filas: Fila[] = [];
  // Sin hora de inicio (toMin devuelve 0) no hay escaleta que calcular: la foto
  // y la introducción se programan hacia atrás desde la 1ª presentación, así que
  // partir de 0 daba horas negativas ("-1:-5"). No inventamos un horario: se
  // devuelven los proyectos asignados sin hora, y la pantalla pide la hora.
  const sinHora = inicioMin <= 0;
  if (sinHora) {
    proyectos.forEach((e, i) => filas.push({
      tipo: 'proyecto', slot: slotBase + i, proyecto_id: e.proyecto_id,
      proyecto: e.proyecto, autores: e.autores, sector: e.sector, ini: -1, fin: -1,
    }));
    return filas;
  }
  // Foto + intro se programan HACIA ATRÁS, terminando justo antes del slot 1.
  let t = inicioMin - C.trans - introMin - (foto ? C.foto : 0);
  if (foto) { filas.push({ tipo: 'foto', desc: 'Toma de foto de grupo — Puerta principal', ini: t, fin: t + C.foto }); t += C.foto; }
  filas.push({ tipo: 'intro', desc: 'Introducción', ini: t, fin: t + introMin }); t += introMin;
  t += C.trans; // t == inicioMin
  const total = proyectos.length;
  const trasAlmuerzo = J.almuerzo ? slotDelAlmuerzo(total, C.bloque, J.almuerzoTrasSlot) : 0;
  for (let i = 0; i < total; i++) {
    const e = proyectos[i];
    filas.push({ tipo: 'proyecto', slot: slotBase + i, proyecto_id: e.proyecto_id, proyecto: e.proyecto, autores: e.autores, sector: e.sector, ini: t, fin: t + C.expo });
    t += C.expo;
    const count = i + 1;
    const ultimo = i === total - 1;
    const finBloque = count % C.bloque === 0;
    const esAlmuerzo = !ultimo && count === trasAlmuerzo;
    if (ultimo) {
      t += C.trans;
      filas.push({ tipo: 'cierre', desc: (esUltimoDia ? 'Evaluación y Cierre' : 'Cierre de jornada') + ' — Toma de foto', ini: t, fin: t + C.cierre }); t += C.cierre;
    } else if (esAlmuerzo || finBloque) {
      t += C.trans;
      if (esAlmuerzo) {
        // El almuerzo SUSTITUYE al break cuando caen en el mismo punto: dos
        // pausas seguidas no son una jornada partida, son un hueco.
        filas.push({ tipo: 'almuerzo', desc: 'Almuerzo', ini: t, fin: t + J.almuerzoMin }); t += J.almuerzoMin;
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
// filas llegan con -1) o sin ningún proyecto asignado (solo foto e intro, que se
// programan HACIA ATRÁS y darían un "fin" anterior al inicio).
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
  'id, numero, fecha, hora_inicio, hora_fin, foto_inicial, intro_min, almuerzo, almuerzo_min, almuerzo_tras_slot';

// Traduce una fila de `jornadas` a las opciones que entiende el motor.
export function opcionesDeJornada(j: any): OpcionesJornada {
  return {
    inicioMin: toMin(j.hora_inicio),
    foto: !!j.foto_inicial,
    introMin: j.intro_min ?? 0,
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
export async function jornadaConSlots(jornada: any, C: Config, esUltimo: boolean, pf: Map<string, ProyectoFase2>) {
  const { data: slots } = await supabaseAdmin
    .from('slot_presentacion').select('orden, proyecto_id').eq('jornada_id', jornada.id).order('orden');
  // Un slot asignado a un equipo que ya NO entra a Fase 2 (entrega incompleta:
  // le falta alguno de los 4 documentos, o el proyecto fue borrado) NO debe
  // ocupar un renglón. Se omite y la escaleta renumera/recalcula los horarios sin
  // él. Si el equipo completa sus documentos vuelve a `pf` y su slot reaparece.
  const proyectos = (slots ?? [])
    .filter((s: any) => pf.has(s.proyecto_id))
    .map((s: any) => ({ ...(pf.get(s.proyecto_id) as ProyectoFase2), proyecto_id: s.proyecto_id }));
  const filas = computarJornada(opcionesDeJornada(jornada), proyectos, 1, esUltimo, C);
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
  const pf = await proyectosFase2(cohorteId);
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select(COLS_JORNADA)
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
  const pf = await proyectosFase2(cohorteId);
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas').select(COLS_JORNADA)
    .eq('cohorte_id', cohorteId).order('numero');
  const total = (jornadas ?? []).length;
  for (let i = 0; i < total; i++) {
    await jornadaConSlots((jornadas as any[])[i], C, i === total - 1, pf);
  }
}
