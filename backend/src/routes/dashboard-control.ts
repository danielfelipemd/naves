import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
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
// El bloque de ACTAS resume la tabla `acta` del módulo de Actas de Grado
// (migración 38) con los mismos criterios de estado que usa su propio panel.
//
// Solo lectura salvo el checkbox del informe (POST /:cohorteId/informe).

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;
// El dashboard es de SOLO LECTURA, así que el profesor también entra: necesita
// ver el avance de la cohorte que acompaña. El alcance se restringe abajo (solo
// sus cohortes). Marcar el informe sigue siendo exclusivo del super_admin.
const adminOProfesor = [requireAuth(), requireRole('super_admin', 'profesor')] as const;

/**
 * ¿Puede este usuario ver el dashboard de la cohorte? El super_admin, todas; el
 * profesor, solo aquellas donde tiene equipos asignados.
 */
async function puedeVerCohorte(req: AuthenticatedRequest, cohorteId: string): Promise<boolean> {
  if (req.user?.isSuperAdmin || req.user?.role === 'super_admin') return true;
  const profesorId = req.user?.profesorId;
  if (!profesorId) return false;
  const { data } = await supabaseAdmin
    .from('asignaciones_profesor')
    .select('equipo_id')
    .eq('profesor_id', profesorId)
    .eq('cohorte_id', cohorteId)
    .limit(1);
  return !!(data ?? []).length;
}

// El anteproyecto en supabase-js puede venir como objeto o como array (embed).
function pickAnte(raw: any) {
  return Array.isArray(raw) ? raw[0] : raw;
}

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';
const MODALIDADES: Modalidad[] = ['business_plan', 'caso', 'proyecto_investigacion'];
function esModalidad(t: any): t is Modalidad {
  return t === 'business_plan' || t === 'caso' || t === 'proyecto_investigacion';
}

// === GET /cohortes — cohortes que el usuario puede consultar aquí ===========
// El super_admin ve todas las activas; el profesor, solo donde tiene equipos.
// Sin esto el desplegable le ofrecía cohortes que después respondían 403.
router.get('/cohortes', ...adminOProfesor, async (req: AuthenticatedRequest, res) => {
  const esAdmin = !!req.user?.isSuperAdmin || req.user?.role === 'super_admin';
  const { data: todas, error } = await supabaseAdmin
    .from('cohortes').select('id, etiqueta, activa').eq('activa', true).order('etiqueta');
  if (error) return res.status(500).json({ error: error.message });
  if (esAdmin) return res.json({ cohortes: todas ?? [] });

  const profesorId = req.user?.profesorId;
  if (!profesorId) return res.json({ cohortes: [] });
  const { data: asig } = await supabaseAdmin
    .from('asignaciones_profesor').select('cohorte_id').eq('profesor_id', profesorId);
  const mias = new Set(((asig ?? []) as any[]).map((a) => a.cohorte_id));
  res.json({ cohortes: ((todas ?? []) as any[]).filter((c) => mias.has(c.id)) });
});

// === GET /:cohorteId — dashboard completo de la cohorte =====================
router.get('/:cohorteId', ...adminOProfesor, async (req: AuthenticatedRequest, res) => {
  const cohorteId = req.params.cohorteId;
  if (!(await puedeVerCohorte(req, cohorteId))) {
    return res.status(403).json({
      error: 'COHORTE_FUERA_DE_ALCANCE',
      mensaje: 'Solo puedes ver el dashboard de las cohortes en las que tienes equipos asignados.',
    });
  }

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
    .select('id, estado, perfil, fue_emprendedor, quiebra')
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
  const anteEntregadoDeEquipo = (e: any) => {
    const a = pickAnte(e.anteproyectos);
    return !!(a && a.estado && a.estado !== 'borrador');
  };
  const anteEntregados = equipos.filter(anteEntregadoDeEquipo).length;

  // "Proyectos (equipos)" cuenta ÚNICAMENTE los equipos de Business Plan NAVES:
  // los de Caso y Proyecto de Investigación no son proyectos NAVES y mezclarlos
  // inflaba el indicador.
  const equiposBP = equipos.filter((e) => e.tipo_trabajo_grado === 'business_plan');
  const totalEquiposBP = equiposBP.length;

  // Los anteproyectos entregados se desglosan POR MODALIDAD (un solo número
  // agregado no dice nada: son tres procesos distintos).
  const anteEntregadosPorModalidad: Record<Modalidad, { n: number; total: number }> = {
    business_plan: { n: 0, total: 0 },
    caso: { n: 0, total: 0 },
    proyecto_investigacion: { n: 0, total: 0 },
  };
  for (const e of equipos) {
    const tipo = e.tipo_trabajo_grado;
    if (!esModalidad(tipo)) continue;
    anteEntregadosPorModalidad[tipo].total++;
    if (anteEntregadoDeEquipo(e)) anteEntregadosPorModalidad[tipo].n++;
  }

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

  // --- Perfil emprendedor del registro -------------------------------------
  // Caracterización completa: además del rol declarado se grafican las otras
  // preguntas del perfil (experiencia previa, desenlace de esa experiencia, qué
  // los motiva y qué les preocupa). Con una sola variable la caracterización
  // quedaba demasiado pobre.
  const perfilEmprendedor: Record<string, number> = {
    emprendedor: 0,
    directivo: 0,
    ambos: 0,
    sin_responder: 0,
  };
  const experienciaPrevia: Record<string, number> = { si: 0, no: 0, sin_responder: 0 };
  const desenlacePrevio: Record<string, number> = {
    nunca_despego: 0, funcionamiento: 0, vendido: 0, quebro: 0, na: 0,
  };
  for (const p of participantes) {
    if (p.perfil === 'emprendedor' || p.perfil === 'directivo' || p.perfil === 'ambos') {
      perfilEmprendedor[p.perfil]++;
    } else {
      perfilEmprendedor.sin_responder++;
    }
    if (p.fue_emprendedor === true) experienciaPrevia.si++;
    else if (p.fue_emprendedor === false) experienciaPrevia.no++;
    else experienciaPrevia.sin_responder++;
    // El desenlace solo aplica a quienes ya emprendieron.
    if (p.fue_emprendedor === true && p.quiebra && desenlacePrevio[p.quiebra] !== undefined) {
      desenlacePrevio[p.quiebra]++;
    }
  }

  // Emociones y preocupaciones son de selección múltiple: cada participante
  // puede aportar a varias categorías (los totales no suman el número de
  // participantes, y así se rotula en la gráfica).
  const emociones: Record<string, number> = {
    crear: 0, dinero: 0, problema: 0, autonomia: 0, ninguna: 0,
  };
  const preocupaciones: Record<string, number> = {
    financiera: 0, estres: 0, habilidades: 0, familia: 0, ninguna: 0,
  };
  const participanteIds = participantes.map((p) => p.id);
  if (participanteIds.length) {
    const [{ data: ems }, { data: prs }] = await Promise.all([
      supabaseAdmin.from('participante_emociones').select('emocion').in('participante_id', participanteIds),
      supabaseAdmin.from('participante_preocupaciones').select('preocupacion').in('participante_id', participanteIds),
    ]);
    for (const e of ((ems ?? []) as any[])) {
      if (emociones[e.emocion] !== undefined) emociones[e.emocion]++;
    }
    for (const p of ((prs ?? []) as any[])) {
      if (preocupaciones[p.preocupacion] !== undefined) preocupaciones[p.preocupacion]++;
    }
  }

  // --- Actas de grado (módulo de Actas, migración 38) -----------------------
  // Se usan los mismos criterios de estado que el panel de /admin/actas para que
  // los números coincidan. Los estados son acumulativos (un acta completa ya
  // pasó por generada y enviada), así que cada contador incluye a los
  // posteriores: realizadas ≥ enviadas ≥ firmadas.
  const { data: actasData } = await supabaseAdmin
    .from('acta')
    .select('estado')
    .eq('cohorte_id', cohorteId);
  const actas = (actasData ?? []) as any[];
  const cuentaActas = (estados: string[]) => actas.filter((a) => estados.includes(a.estado)).length;

  res.json({
    cohorte: { id: cohorte.id, etiqueta: cohorte.etiqueta },
    bloque1: {
      participantes_activos: participantesActivos,
      proyectos: totalEquiposBP,
      equipos_totales: totalEquipos,
      anteproyectos_entregados: {
        n: anteEntregados,
        total: totalEquipos,
        por_modalidad: anteEntregadosPorModalidad,
      },
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
      actas: {
        disponible: true,
        // Total de actas creadas para la cohorte (una por participante).
        total: actas.length,
        // Realizada = ya generada, es decir salió de 'faltan_datos'.
        realizadas: cuentaActas(['generada', 'enviada', 'en_firmas_internas', 'lista_para_cierre', 'completa', 'archivada']),
        // Enviada = salió a la cadena de firmas.
        enviadas: cuentaActas(['enviada', 'en_firmas_internas', 'lista_para_cierre', 'completa', 'archivada']),
        // Firmada = cadena de firmas completa (mismo criterio que el tile
        // "Completas" del panel de actas).
        firmadas: cuentaActas(['completa', 'archivada']),
        // Con datos incompletos todavía no se puede generar el acta.
        faltan_datos: cuentaActas(['faltan_datos']),
      },
      informe_cohorte: { realizado: !!cohorte.informe_cohorte_realizado },
    },
    bloque4: {
      trabajos_por_modalidad: trabajosPorModalidad,
      participantes_por_modalidad: participantesPorModalidad,
      perfil_emprendedor: perfilEmprendedor,
      experiencia_previa: experienciaPrevia,
      desenlace_experiencia_previa: desenlacePrevio,
      emociones: emociones,
      preocupaciones: preocupaciones,
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
