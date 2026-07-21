import { supabaseAdmin } from '../../db/supabase.js';

// =====================================================================
// AoL §8 — Firma de la calificación (R7). Inserta aol_calificacion + una fila en
// `medicion` por integrante × trait. Como `medicion` referencia las tablas del
// esquema AoL (estudiante/criterio/cohorte del histórico), al firmar se
// MATERIALIZA la cohorte/trabajo/integrantes actuales en ese esquema.
//
// Convención de mapeo (anotada en docs/aol/PREGUNTAS.md para confirmar con JMV):
//  - cohorte.codigo = "<MODALIDAD> <AÑO_INI>-<AÑO_FIN>" (ej. "FS 2024-2026"),
//    derivado de la etiqueta de la cohorte de la plataforma.
//  - proyecto.titulo = nombre del proyecto definitivo.
//  - estudiante = por nombre_completo del integrante (match por normalizado).
// =====================================================================

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Deriva {codigo, modalidad, anio_inicio, anio_fin} de la etiqueta de plataforma
// (p. ej. "MBA INT 24-26", "QA MBA FS 24-26").
function parseCohorte(etiqueta: string): { codigo: string; modalidad: string; anio_inicio: number; anio_fin: number } {
  const modalidad = /\bINT\b/i.test(etiqueta) ? 'INT' : 'FS';
  const anios = etiqueta.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})/);
  const to4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const anio_inicio = anios ? to4(anios[1]) : 0;
  const anio_fin = anios ? to4(anios[2]) : 0;
  return { codigo: `${modalidad} ${anio_inicio}-${anio_fin}`, modalidad, anio_inicio, anio_fin };
}

async function materializarCohorte(etiqueta: string): Promise<number> {
  const c = parseCohorte(etiqueta);
  const { data: existente } = await supabaseAdmin.from('cohorte').select('id').eq('codigo', c.codigo).maybeSingle();
  if (existente) return (existente as any).id;
  const { data, error } = await supabaseAdmin.from('cohorte').insert({
    codigo: c.codigo, modalidad: c.modalidad, anio_inicio: c.anio_inicio, anio_fin: c.anio_fin,
    anio_medicion: c.anio_fin, tiene_detalle_individual: true,
    notas: 'Cohorte activa creada por el módulo AoL de la plataforma.',
  }).select('id').maybeSingle();
  if (error) throw new Error('AOL_COHORTE: ' + error.message);
  return (data as any).id;
}

async function materializarProyecto(cohorteAolId: number, titulo: string): Promise<number> {
  const { data: ex } = await supabaseAdmin.from('proyecto').select('id').eq('cohorte_id', cohorteAolId).eq('titulo', titulo).maybeSingle();
  if (ex) return (ex as any).id;
  const { data, error } = await supabaseAdmin.from('proyecto').insert({ cohorte_id: cohorteAolId, titulo }).select('id').maybeSingle();
  if (error) throw new Error('AOL_PROYECTO: ' + error.message);
  return (data as any).id;
}

async function materializarEstudiante(cohorteAolId: number, proyectoAolId: number, nombreCompleto: string): Promise<number> {
  const nn = norm(nombreCompleto);
  const { data: ex } = await supabaseAdmin.from('estudiante').select('id').eq('cohorte_id', cohorteAolId).eq('nombre_normalizado', nn).maybeSingle();
  if (ex) {
    await supabaseAdmin.from('estudiante').update({ proyecto_id: proyectoAolId }).eq('id', (ex as any).id);
    return (ex as any).id;
  }
  const partes = nombreCompleto.trim().split(/\s+/);
  const mitad = Math.ceil(partes.length / 2);
  const { data, error } = await supabaseAdmin.from('estudiante').insert({
    cohorte_id: cohorteAolId, proyecto_id: proyectoAolId,
    nombres: partes.slice(0, mitad).join(' '), apellidos: partes.slice(mitad).join(' '),
    nombre_completo: nombreCompleto, nombre_normalizado: nn,
  }).select('id').maybeSingle();
  if (error) throw new Error('AOL_ESTUDIANTE: ' + error.message);
  return (data as any).id;
}

export interface FirmaInput {
  puntajes: Record<string, number>;        // { "1": 2, ..., "6": 3 }
  parrafo: string;
  autor: string;
  analisisId: number | null;
  versionCerebro: string;
  versionRubrica?: string;
  sugerenciaIa?: Record<string, number>;   // puntajes sugeridos por la IA (para origen)
  ajustesIndividuales?: Record<string, Record<string, number>>; // { nombreNorm: { trait: puntaje } }
}

export async function firmarCalificacion(proyectoPlataformaId: string, input: FirmaInput): Promise<{ ok: true; total: number; on_standard: boolean }> {
  // Resolver cohorte de plataforma + integrantes.
  const { data: proy } = await supabaseAdmin
    .from('proyectos').select('id, nombre, anteproyecto_id').eq('id', proyectoPlataformaId).maybeSingle();
  if (!proy) throw new Error('PROYECTO_NO_ENCONTRADO');
  // El equipo/integrantes salen del anteproyecto (proyectos.anteproyecto_id).
  const { data: ante } = await supabaseAdmin
    .from('anteproyectos')
    .select('equipos(cohorte_id, cohortes(etiqueta), miembros_equipo(posicion, participantes_lista(nombre_completo)))')
    .eq('id', (proy as any).anteproyecto_id).maybeSingle();
  const eq = (ante as any)?.equipos;
  const etiqueta = eq?.cohortes?.etiqueta ?? eq?.cohorte_id ?? '';
  const integrantes: string[] = (((eq as any)?.miembros_equipo ?? []) as any[])
    .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
    .map((m) => m.participantes_lista?.nombre_completo).filter(Boolean);
  if (!integrantes.length) throw new Error('SIN_INTEGRANTES');

  const cohorteAolId = await materializarCohorte(etiqueta);
  const proyectoAolId = await materializarProyecto(cohorteAolId, (proy as any).nombre);

  const traitsIds = [1, 2, 3, 4, 5, 6];
  const total = traitsIds.reduce((s, t) => s + (Number(input.puntajes[String(t)]) || 0), 0);
  const on_standard = total >= 12; // promedio ≥ 2.0 sobre 6 traits

  // aol_calificacion (upsert por unique proyecto_plataforma_id).
  const { error: eCal } = await supabaseAdmin.from('aol_calificacion').upsert({
    proyecto_plataforma_id: proyectoPlataformaId,
    cohorte_codigo: parseCohorte(etiqueta).codigo,
    analisis_id: input.analisisId,
    puntajes: input.puntajes, parrafo: input.parrafo,
    total, on_standard, autor: input.autor,
    version_cerebro: input.versionCerebro, version_rubrica: input.versionRubrica ?? '1.0',
  }, { onConflict: 'proyecto_plataforma_id' });
  if (eCal) throw new Error('AOL_CALIFICACION: ' + eCal.message);

  // medicion: una fila por integrante × trait.
  const filas: any[] = [];
  for (const nombre of integrantes) {
    const estId = await materializarEstudiante(cohorteAolId, proyectoAolId, nombre);
    const ajuste = input.ajustesIndividuales?.[norm(nombre)];
    for (const t of traitsIds) {
      const puntajeEquipo = Number(input.puntajes[String(t)]) || 0;
      const puntaje = ajuste?.[String(t)] != null ? Number(ajuste[String(t)]) : puntajeEquipo;
      const sugerido = input.sugerenciaIa?.[String(t)];
      const origen = sugerido != null && sugerido === puntaje ? 'ia_confirmada' : 'manual';
      filas.push({
        estudiante_id: estId, criterio_id: t, puntaje, origen, autor: input.autor,
        version_cerebro: input.versionCerebro, version_rubrica: input.versionRubrica ?? '1.0',
      });
    }
  }
  const { error: eMed } = await supabaseAdmin.from('medicion').insert(filas);
  if (eMed) throw new Error('AOL_MEDICION: ' + eMed.message);

  return { ok: true, total, on_standard };
}
