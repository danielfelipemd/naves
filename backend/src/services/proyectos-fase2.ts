import { supabaseAdmin } from '../db/supabase.js';
import { entregaFinalCompleta } from './entrega-final.js';

// Resolutor único de "qué proyectos entran a la Fase 2" de una cohorte.
//
// La Fase 2 (panelistas, programación, base de datos interna, contenido IA) es
// el evento de presentación: se presenta el PROYECTO FINAL ya entregado.
//
// SOLO BUSINESS PLAN presenta. Caso y Proyecto de Investigación NO participan del
// evento: no se programan, no aparecen en la programación interna ni se les pide
// material (one pager, logo, modelo financiero). Su trabajo de grado termina con
// la entrega a su director, sin sustentación en NAVES.
//
// REGLA: un equipo entra a la Fase 2 solo cuando ha CARGADO SU PROYECTO FINAL.
// Mientras no lo entregue sigue siendo un anteproyecto y no existe como
// proyecto: no se programa, no aparece en la base de datos interna y no se le
// genera contenido. Haber elegido el proyecto definitivo NO basta — esa
// selección solo dice cuál de las ideas se va a desarrollar, no que exista ya
// un proyecto que presentar.
//
// El anteproyecto es además el camino estructural para llegar al proyecto
// (proyectos cuelga de anteproyectos, que cuelga de equipos), pero nunca el eje.

export interface ProyectoFase2 {
  proyecto_id: string;
  equipo_id: string;
  proyecto: string;
  autores: string;
  sector: string;
}

function pickAnte(raw: any) { return Array.isArray(raw) ? raw[0] : raw; }

function autoresDe(equipo: any): string {
  return ((equipo.miembros_equipo ?? []) as any[])
    .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
    .map((m) => m.participantes_lista?.nombre_completo)
    .filter(Boolean)
    .join(', ');
}

// Material (one pager / logo / modelo financiero) por proyecto definitivo,
// indexado por proyecto_id. Vive en proyecto_contenido.
async function contenidoPorProyecto(proyectoIds: Array<string | null | undefined>): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const ids = [...new Set(proyectoIds.filter(Boolean) as string[])];
  if (!ids.length) return map;
  const { data } = await supabaseAdmin
    .from('proyecto_contenido')
    .select('proyecto_id, one_pager_path, logo_path, modelo_financiero_path')
    .in('proyecto_id', ids);
  for (const c of (data ?? []) as any[]) map.set(c.proyecto_id, c);
  return map;
}

// ¿La entrega final del equipo está COMPLETA? En Business Plan exige los 4
// documentos: PDF + one pager + logo + modelo financiero. Un documento faltante
// ⇒ el equipo NO entra a la Fase 2 (no es programable, no aparece en la BD
// interna ni se le genera contenido). Decisión del área: los 4 sí o sí.
function equipoConEntregaCompleta(e: any, contMap: Map<string, any>): boolean {
  const ante = pickAnte(e.anteproyectos);
  const cont = e.proyecto_definitivo_id ? contMap.get(e.proyecto_definitivo_id) : null;
  return entregaFinalCompleta('business_plan', {
    archivoFinalPath: ante?.archivo_proyecto_final_path,
    onePagerPath: cont?.one_pager_path,
    logoPath: cont?.logo_path,
    modeloFinancieroPath: cont?.modelo_financiero_path,
  });
}

// Proyectos con la entrega final COMPLETA (los 4 documentos), indexados por proyecto_id.
export async function proyectosFase2(cohorteId: string): Promise<Map<string, ProyectoFase2>> {
  const { data } = await supabaseAdmin
    .from('equipos')
    .select('id, proyecto_definitivo_id, miembros_equipo(posicion, participantes_lista(nombre_completo)), anteproyectos(archivo_proyecto_final_path, proyectos(id, nombre, sector, estado_seleccion))')
    .eq('cohorte_id', cohorteId)
    // Solo Business Plan presenta (ver cabecera): Caso/PI quedan fuera del evento.
    .eq('tipo_trabajo_grado', 'business_plan');

  const equipos = (data ?? []) as any[];
  const contMap = await contenidoPorProyecto(equipos.map((e) => e.proyecto_definitivo_id));

  const map = new Map<string, ProyectoFase2>();
  for (const e of equipos) {
    if (!e.proyecto_definitivo_id) continue;
    // Entrega incompleta (le falta el PDF o alguno de los 3 documentos): no entra.
    if (!equipoConEntregaCompleta(e, contMap)) continue;
    const ante = pickAnte(e.anteproyectos);
    const proyectos = (ante?.proyectos ?? []) as any[];
    const def = proyectos.find((p) => p.id === e.proyecto_definitivo_id);
    if (!def) continue;
    map.set(def.id, {
      proyecto_id: def.id,
      equipo_id: e.id,
      proyecto: def.nombre ?? '(sin nombre)',
      autores: autoresDe(e),
      sector: def.sector ?? '',
    });
  }
  return map;
}

// Equipos de la cohorte que aún NO han entregado su proyecto final y por tanto
// no entran a la Fase 2. Se cuentan para poder decirlo en pantalla: si no, el
// administrador ve una tabla vacía y no sabe por qué. Solo Business Plan: contar
// Caso/PI aquí daría un número alarmante de "faltantes" que en realidad nunca
// presentan.
export async function contarEquiposSinProyectoFinal(cohorteId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('equipos')
    .select('id, proyecto_definitivo_id, anteproyectos(archivo_proyecto_final_path)')
    .eq('cohorte_id', cohorteId)
    .eq('tipo_trabajo_grado', 'business_plan');
  const equipos = (data ?? []) as any[];
  const contMap = await contenidoPorProyecto(equipos.map((e) => e.proyecto_definitivo_id));
  // "Faltantes" = sin entrega completa (le falta el PDF o alguno de los 4 documentos).
  return equipos.filter((e) => !equipoConEntregaCompleta(e, contMap)).length;
}

// auth_user_id de los integrantes del equipo dueño de cada proyecto.
export async function autoresAuthPorProyecto(
  proyectos: ProyectoFase2[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const equipoIds = [...new Set(proyectos.map((p) => p.equipo_id))];
  if (!equipoIds.length) return out;

  const { data } = await supabaseAdmin
    .from('miembros_equipo')
    .select('equipo_id, participantes_lista(auth_user_id)')
    .in('equipo_id', equipoIds);

  const porEquipo = new Map<string, string[]>();
  for (const m of (data ?? []) as any[]) {
    const auth = m.participantes_lista?.auth_user_id;
    if (!auth) continue;
    const arr = porEquipo.get(m.equipo_id) ?? [];
    arr.push(auth);
    porEquipo.set(m.equipo_id, arr);
  }
  for (const p of proyectos) out.set(p.proyecto_id, porEquipo.get(p.equipo_id) ?? []);
  return out;
}
