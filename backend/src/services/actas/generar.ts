import { supabaseAdmin } from '../../db/supabase.js';
import { decryptPII } from '../../auth/crypto.js';

// =====================================================================
// Actas de Grado — generación "cero digitación" (§1). Una acta por participante,
// con los datos copiados de la sábana/programación/participantes. Si falta un
// dato, el acta queda en 'faltan_datos' con la lista de faltantes (se corrige en
// el origen, nunca a mano). También arma la cadena de firmas por modalidad (§3).
// =====================================================================

interface Firma { rol: string; nombre: string | null; email: string | null; orden: number; paralelo?: boolean; estado: 'pendiente' | 'firmada'; firmada_en?: string | null; certificado?: any; }

// Cadena de firmas por modalidad (§3).
function cadenaFirmas(modalidad: string, director: { nombre: string | null; email: string | null }, jurados: any[], dirMba: string | null): Firma[] {
  const f: Firma[] = [{ rol: 'participante', nombre: null, email: null, orden: 1, estado: 'pendiente' }];
  if (modalidad === 'business_plan') {
    f.push({ rol: 'profesor', nombre: director.nombre, email: director.email, orden: 2, estado: 'pendiente' });
    f.push({ rol: 'director_mba', nombre: dirMba, email: null, orden: 3, estado: 'pendiente' });
  } else {
    f.push({ rol: 'director_proyecto', nombre: director.nombre, email: director.email, orden: 2, estado: 'pendiente' });
    for (const j of jurados ?? []) f.push({ rol: 'jurado', nombre: j.nombre ?? null, email: j.email ?? null, orden: 3, paralelo: true, estado: 'pendiente' });
    f.push({ rol: 'director_mba', nombre: dirMba, email: null, orden: 4, estado: 'pendiente' });
  }
  return f;
}

const dec = (v: any) => { try { return v ? decryptPII(v) : null; } catch { return null; } };

// Genera/actualiza las actas de una cohorte. Idempotente (upsert por participante).
export async function generarActasCohorte(cohorteId: string): Promise<{ generadas: number; faltan_datos: number }> {
  const { data: coh } = await supabaseAdmin.from('cohortes').select('director_mba_nombre, director_mba_cargo').eq('id', cohorteId).maybeSingle();
  const dirMba = (coh as any)?.director_mba_nombre ?? null;
  const dirMbaCargo = (coh as any)?.director_mba_cargo ?? null;

  // Equipos de la cohorte con miembros, modalidad, director, proyecto definitivo.
  const { data: equipos } = await supabaseAdmin
    .from('equipos')
    .select(`id, tipo_trabajo_grado, director_id, proyecto_definitivo_id,
      miembros_equipo(posicion, participantes_lista(id, nombre_completo))`)
    .eq('cohorte_id', cohorteId);
  const eqs = (equipos ?? []) as any[];

  const equipoIds = eqs.map((e) => e.id);
  const directorIds = [...new Set(eqs.map((e) => e.director_id).filter(Boolean))];
  const proyIds = eqs.map((e) => e.proyecto_definitivo_id).filter(Boolean);

  // Profesor asignado (BP) por equipo.
  const { data: asigs } = equipoIds.length
    ? await supabaseAdmin.from('asignaciones_profesor').select('equipo_id, profesor_id, profesores:profesor_id(nombre_completo)').in('equipo_id', equipoIds)
    : { data: [] as any[] };
  const profPorEquipo = new Map(((asigs ?? []) as any[]).map((a) => [a.equipo_id, a.profesores?.nombre_completo ?? null]));

  // Directores de proyecto (Caso/PI).
  const { data: dirs } = directorIds.length
    ? await supabaseAdmin.from('directores').select('id, nombre_completo, email_encriptado').in('id', directorIds)
    : { data: [] as any[] };
  const dirById = new Map(((dirs ?? []) as any[]).map((d) => [d.id, { nombre: d.nombre_completo, email: dec(d.email_encriptado) }]));

  // Nombre del proyecto definitivo.
  const { data: proys } = proyIds.length
    ? await supabaseAdmin.from('proyectos').select('id, nombre').in('id', proyIds)
    : { data: [] as any[] };
  const nombreProy = new Map(((proys ?? []) as any[]).map((p) => [p.id, p.nombre]));

  // Fecha de sustentación: jornada del slot del proyecto definitivo.
  const { data: slots } = proyIds.length
    ? await supabaseAdmin.from('slot_presentacion').select('proyecto_id, jornadas:jornada_id(fecha)').in('proyecto_id', proyIds)
    : { data: [] as any[] };
  const fechaPorProy = new Map(((slots ?? []) as any[]).map((s) => [s.proyecto_id, s.jornadas?.fecha ?? null]));

  // Resultado/jurados capturados por microformulario (Caso/PI).
  const { data: micros } = await supabaseAdmin.from('acta_microformulario').select('proyecto_id, datos, usado').eq('cohorte_id', cohorteId).eq('usado', true);
  const microPorProy = new Map(((micros ?? []) as any[]).map((m) => [m.proyecto_id, m.datos ?? {}]));

  // Actas existentes (para conservar nota/observaciones ya capturadas).
  const { data: existentes } = await supabaseAdmin.from('acta').select('participante_id, nota, observaciones, estado').eq('cohorte_id', cohorteId);
  const actaPrev = new Map(((existentes ?? []) as any[]).map((a) => [a.participante_id, a]));

  let generadas = 0, faltanDatos = 0;
  const filas: any[] = [];

  for (const e of eqs) {
    const modalidad = e.tipo_trabajo_grado;
    const proyId = e.proyecto_definitivo_id;
    const nombreProyecto = proyId ? (nombreProy.get(proyId) ?? null) : null;
    const fecha = proyId ? (fechaPorProy.get(proyId) ?? null) : null;
    const director = modalidad === 'business_plan'
      ? { nombre: profPorEquipo.get(e.id) ?? null, email: null }
      : (e.director_id ? dirById.get(e.director_id) ?? { nombre: null, email: null } : { nombre: null, email: null });
    const micro = proyId ? microPorProy.get(proyId) : null;
    const jurados = modalidad === 'business_plan' ? [] : (micro?.jurados ?? []);

    for (const m of (e.miembros_equipo ?? []) as any[]) {
      const p = m.participantes_lista;
      if (!p?.id) continue;
      const prev = actaPrev.get(p.id);
      // La nota sale del microformulario (Caso/PI) o de lo ya capturado; si no, falta.
      const nota = micro?.nota ?? prev?.nota ?? null;

      const faltan: string[] = [];
      if (!nombreProyecto) faltan.push('nombre del proyecto');
      if (!fecha) faltan.push('fecha de sustentación (programación)');
      if (!director.nombre) faltan.push(modalidad === 'business_plan' ? 'profesor asignado' : 'director de proyecto');
      if (modalidad !== 'business_plan' && !jurados.length) faltan.push('jurados (microformulario)');
      if (!nota) faltan.push('resultado de la sustentación');
      if (!dirMba) faltan.push('Director MBA de la cohorte (config)');

      const estado = faltan.length ? 'faltan_datos' : (prev && prev.estado !== 'faltan_datos' ? prev.estado : 'generada');
      if (estado === 'faltan_datos') faltanDatos++; else generadas++;

      filas.push({
        cohorte_id: cohorteId, participante_id: p.id, equipo_id: e.id, proyecto_id: proyId, modalidad, estado,
        nombre_participante: p.nombre_completo, nombre_proyecto: nombreProyecto, fecha_sustentacion: fecha,
        lugar: 'INALDE Business School', director_nombre: director.nombre, director_id: e.director_id ?? null,
        jurados, nota, observaciones: prev?.observaciones ?? null,
        director_mba_nombre: dirMba, director_mba_cargo: dirMbaCargo,
        firmas: cadenaFirmas(modalidad, director, jurados, dirMba), faltan,
      });
    }
  }

  if (filas.length) {
    const { error } = await supabaseAdmin.from('acta').upsert(filas, { onConflict: 'participante_id' });
    if (error) throw new Error('ACTA_UPSERT: ' + error.message);
  }
  return { generadas, faltan_datos: faltanDatos };
}
