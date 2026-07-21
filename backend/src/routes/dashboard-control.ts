import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { entregaFinalCompleta } from '../services/entrega-final.js';

// === Dashboard de control de cohorte (Comentario 15 QA, JMV 20-jul-2026) =====
//
// Vista de control para el super_admin: cuánto ha avanzado una cohorte a lo
// largo del proceso NAVES. Casi todo se calcula por AGREGACIÓN de datos que ya
// existen (participantes, equipos, anteproyectos, entregas, checkboxes de
// Reunión 1/2, programación, perfil emprendedor del registro). El único dato
// propio es el indicador binario del INFORME de cohorte
// (cohortes.informe_cohorte_realizado, migración 35).
//
// El bloque de ACTAS depende del módulo de Actas de Grado, que todavía no
// existe: se devuelve con disponible:false y contadores en 0.
//
// Solo lectura salvo el checkbox del informe (POST /:cohorteId/informe).

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;

// El anteproyecto en supabase-js puede venir como objeto o como array (embed).
function pickAnte(raw: any) {
  return Array.isArray(raw) ? raw[0] : raw;
}

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';
const MODALIDADES: Modalidad[] = ['business_plan', 'caso', 'proyecto_investigacion'];
function esModalidad(t: any): t is Modalidad {
  return t === 'business_plan' || t === 'caso' || t === 'proyecto_investigacion';
}

// === GET /:cohorteId — dashboard completo de la cohorte =====================
router.get('/:cohorteId', ...soloAdmin, async (req, res) => {
  const cohorteId = req.params.cohorteId;

  const { data: cohorte, error: errCoh } = await supabaseAdmin
    .from('cohortes')
    .select('id, etiqueta, informe_cohorte_realizado')
    .eq('id', cohorteId)
    .maybeSingle();
  if (errCoh) return res.status(500).json({ error: errCoh.message });
  if (!cohorte) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  // --- Participantes de la cohorte -----------------------------------------
  const { data: partData } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, estado, perfil')
    .eq('cohorte_id', cohorteId);
  const participantes = (partData ?? []) as any[];
  const totalParticipantes = participantes.length;
  const participantesActivos = participantes.filter((p) => p.estado === 'activo').length;

  // --- Equipos + su anteproyecto -------------------------------------------
  const { data: eqData } = await supabaseAdmin
    .from('equipos')
    .select(
      'id, tipo_trabajo_grado, proyecto_definitivo_id, reunion_1_profesor_at, reunion_2_profesor_at, ' +
        'anteproyectos(estado, archivo_proyecto_final_path)',
    )
    .eq('cohorte_id', cohorteId);
  const equipos = (eqData ?? []) as any[];
  const totalEquipos = equipos.length;

  // Entregado = el equipo envió su anteproyecto (cualquier estado distinto de
  // 'borrador').
  const anteEntregados = equipos.filter((e) => {
    const a = pickAnte(e.anteproyectos);
    return a && a.estado && a.estado !== 'borrador';
  }).length;

  // Definitivo entregado = entrega final COMPLETA. Para Business Plan no basta
  // el PDF: exige también one pager, logo y modelo financiero (los 4 documentos).
  // Traemos el material del proyecto definitivo de cada equipo BP para poder
  // exigirlo (vive en proyecto_contenido, colgado del proyecto).
  const defProyectoIds = equipos
    .filter((e) => e.tipo_trabajo_grado === 'business_plan' && e.proyecto_definitivo_id)
    .map((e) => e.proyecto_definitivo_id as string);
  const contenidoPorProyecto = new Map<string, any>();
  if (defProyectoIds.length) {
    const { data: conts } = await supabaseAdmin
      .from('proyecto_contenido')
      .select('proyecto_id, one_pager_path, logo_path, modelo_financiero_path')
      .in('proyecto_id', defProyectoIds);
    for (const c of (conts ?? []) as any[]) contenidoPorProyecto.set(c.proyecto_id, c);
  }
  const definitivosEntregados = equipos.filter((e) => {
    const a = pickAnte(e.anteproyectos);
    const cont = e.proyecto_definitivo_id ? contenidoPorProyecto.get(e.proyecto_definitivo_id) : null;
    return entregaFinalCompleta(e.tipo_trabajo_grado, {
      archivoFinalPath: a?.archivo_proyecto_final_path,
      onePagerPath: cont?.one_pager_path,
      logoPath: cont?.logo_path,
      modeloFinancieroPath: cont?.modelo_financiero_path,
    });
  }).length;
  const reunion1 = equipos.filter((e) => e.reunion_1_profesor_at).length;
  const definitivosElegidos = equipos.filter((e) => e.proyecto_definitivo_id).length;
  const reunion2 = equipos.filter((e) => e.reunion_2_profesor_at).length;

  // --- Caracterización por modalidad ---------------------------------------
  const trabajosPorModalidad: Record<Modalidad, number> = {
    business_plan: 0,
    caso: 0,
    proyecto_investigacion: 0,
  };
  const tipoPorEquipo = new Map<string, Modalidad>();
  for (const e of equipos) {
    const tipo = e.tipo_trabajo_grado;
    if (esModalidad(tipo)) {
      tipoPorEquipo.set(e.id, tipo);
      trabajosPorModalidad[tipo]++;
    }
  }

  // Participantes por la modalidad de su equipo (cuenta miembros).
  const participantesPorModalidad: Record<Modalidad, number> = {
    business_plan: 0,
    caso: 0,
    proyecto_investigacion: 0,
  };
  const equipoIds = equipos.map((e) => e.id);
  if (equipoIds.length) {
    const { data: miembros } = await supabaseAdmin
      .from('miembros_equipo')
      .select('equipo_id')
      .in('equipo_id', equipoIds);
    for (const m of (miembros ?? []) as any[]) {
      const t = tipoPorEquipo.get(m.equipo_id);
      if (t) participantesPorModalidad[t]++;
    }
  }

  // --- Proyectos programados en jornadas -----------------------------------
  let programados = 0;
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas')
    .select('id')
    .eq('cohorte_id', cohorteId);
  const jornadaIds = ((jornadas ?? []) as any[]).map((j) => j.id);
  if (jornadaIds.length) {
    const { count } = await supabaseAdmin
      .from('slot_presentacion')
      .select('*', { count: 'exact', head: true })
      .in('jornada_id', jornadaIds)
      .not('proyecto_id', 'is', null);
    programados = count ?? 0;
  }

  // --- Perfil emprendedor del registro (rol declarado) ---------------------
  const perfilEmprendedor: Record<string, number> = {
    emprendedor: 0,
    directivo: 0,
    ambos: 0,
    sin_responder: 0,
  };
  for (const p of participantes) {
    if (p.perfil === 'emprendedor' || p.perfil === 'directivo' || p.perfil === 'ambos') {
      perfilEmprendedor[p.perfil]++;
    } else {
      perfilEmprendedor.sin_responder++;
    }
  }

  res.json({
    cohorte: { id: cohorte.id, etiqueta: cohorte.etiqueta },
    bloque1: {
      participantes_activos: participantesActivos,
      proyectos: totalEquipos,
      anteproyectos_entregados: { n: anteEntregados, total: totalEquipos },
      trabajos_definitivos_entregados: { n: definitivosEntregados, total: totalEquipos },
    },
    bloque2: [
      { label: 'Participantes cargados', n: participantesActivos, total: totalParticipantes },
      { label: 'Equipos conformados', n: totalEquipos, total: totalEquipos },
      { label: 'Anteproyectos entregados', n: anteEntregados, total: totalEquipos },
      { label: 'Reunión 1 realizada', n: reunion1, total: totalEquipos },
      { label: 'Proyectos definitivos elegidos', n: definitivosElegidos, total: totalEquipos },
      { label: 'Reunión 2 realizada', n: reunion2, total: totalEquipos },
      { label: 'Trabajos definitivos entregados', n: definitivosEntregados, total: totalEquipos },
      { label: 'Proyectos programados en jornadas', n: programados, total: totalEquipos },
    ],
    bloque3: {
      // El módulo de Actas de Grado aún no existe: se reporta como no disponible.
      actas: { disponible: false, realizadas: 0, enviadas: 0, firmadas: 0 },
      informe_cohorte: { realizado: !!cohorte.informe_cohorte_realizado },
    },
    bloque4: {
      trabajos_por_modalidad: trabajosPorModalidad,
      participantes_por_modalidad: participantesPorModalidad,
      perfil_emprendedor: perfilEmprendedor,
    },
  });
});

// === POST /:cohorteId/informe — marca el informe de cohorte ================
const informeSchema = z.object({ realizado: z.boolean() });
router.post('/:cohorteId/informe', ...soloAdmin, async (req, res) => {
  const parsed = informeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const { data: cohorte } = await supabaseAdmin
    .from('cohortes')
    .select('id')
    .eq('id', req.params.cohorteId)
    .maybeSingle();
  if (!cohorte) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  const { error } = await supabaseAdmin
    .from('cohortes')
    .update({ informe_cohorte_realizado: parsed.data.realizado })
    .eq('id', req.params.cohorteId);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true, realizado: parsed.data.realizado });
});

export default router;
