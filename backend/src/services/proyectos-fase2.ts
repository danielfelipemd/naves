import { supabaseAdmin } from '../db/supabase.js';

// Resolutor único de "qué proyectos entran a la Fase 2" de una cohorte.
//
// La Fase 2 (panelistas, programación, base de datos interna, contenido IA)
// ocurre DESPUÉS de la selección: su unidad es el PROYECTO DEFINITIVO, uno por
// equipo. El anteproyecto es solo el camino para llegar a él (proyectos cuelga
// de anteproyectos, que cuelga de equipos), nunca el eje.
//
// Regla: un equipo sin proyecto definitivo NO entra a la Fase 2. No se le
// inventa un proyecto provisional ni se concatenan sus ideas candidatas.

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

// Proyectos definitivos de la cohorte, indexados por proyecto_id.
export async function proyectosFase2(cohorteId: string): Promise<Map<string, ProyectoFase2>> {
  const { data } = await supabaseAdmin
    .from('equipos')
    .select('id, proyecto_definitivo_id, miembros_equipo(posicion, participantes_lista(nombre_completo)), anteproyectos(proyectos(id, nombre, sector, estado_seleccion))')
    .eq('cohorte_id', cohorteId);

  const map = new Map<string, ProyectoFase2>();
  for (const e of (data ?? []) as any[]) {
    if (!e.proyecto_definitivo_id) continue; // sin selección hecha → fuera de Fase 2
    const proyectos = (pickAnte(e.anteproyectos)?.proyectos ?? []) as any[];
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

// Equipos de la cohorte que aún no eligieron proyecto definitivo y por tanto no
// entran a la Fase 2. Se cuentan para poder decirlo en pantalla: si no, el
// administrador ve menos proyectos de los que espera y no sabe por qué.
export async function contarEquiposSinDefinitivo(cohorteId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('equipos')
    .select('id', { count: 'exact', head: true })
    .eq('cohorte_id', cohorteId)
    .is('proyecto_definitivo_id', null);
  return count ?? 0;
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
