import { supabaseAdmin } from '../db/supabase.js';

// Resolutor único de "qué proyectos entran a la Fase 2" de una cohorte.
//
// La Fase 2 (panelistas, programación, base de datos interna, contenido IA) es
// el evento de presentación: se presenta el PROYECTO FINAL ya entregado.
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

// Proyectos con proyecto final entregado, indexados por proyecto_id.
export async function proyectosFase2(cohorteId: string): Promise<Map<string, ProyectoFase2>> {
  const { data } = await supabaseAdmin
    .from('equipos')
    .select('id, proyecto_definitivo_id, miembros_equipo(posicion, participantes_lista(nombre_completo)), anteproyectos(archivo_proyecto_final_path, proyectos(id, nombre, sector, estado_seleccion))')
    .eq('cohorte_id', cohorteId);

  const map = new Map<string, ProyectoFase2>();
  for (const e of (data ?? []) as any[]) {
    const ante = pickAnte(e.anteproyectos);
    // Sin proyecto final cargado sigue siendo un anteproyecto: no entra.
    if (!ante?.archivo_proyecto_final_path) continue;
    if (!e.proyecto_definitivo_id) continue;
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
// administrador ve una tabla vacía y no sabe por qué.
export async function contarEquiposSinProyectoFinal(cohorteId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('equipos')
    .select('id, anteproyectos(archivo_proyecto_final_path)')
    .eq('cohorte_id', cohorteId);
  return ((data ?? []) as any[])
    .filter((e) => !pickAnte(e.anteproyectos)?.archivo_proyecto_final_path).length;
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
