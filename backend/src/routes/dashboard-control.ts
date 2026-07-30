import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { entregaFinalCompleta } from '../services/entrega-final.js';

// === Dashboard de control de cohorte (Comentario 15 QA, JMV 20-jul-2026) =====
//
// Cuánto ha avanzado una cohorte a lo largo del proceso NAVES. TODO se calcula
// por AGREGACIÓN de datos que ya existen (participantes, equipos, anteproyectos,
// entregas, checkboxes de Reunión 1/2, programación, perfil emprendedor del
// registro): esta ruta no guarda nada propio.
//
// El bloque de ACTAS resume la tabla `acta` del módulo de Actas de Grado
// (migración 38) con los mismos criterios de estado que usa su propio panel.
//
// El indicador manual de INFORME de cohorte (cohortes.informe_cohorte_realizado,
// migración 35) se retiró: el informe real lo produce el módulo AoL, así que la
// casilla suelta solo duplicaba el hito. La columna sigue en la base con su
// último valor; ninguna pantalla la lee ni la escribe.
//
// DOS ALCANCES en la misma ruta:
//   - 'cohorte' (super_admin): la cohorte entera, las tres modalidades.
//   - 'profesor': SOLO sus equipos asignados y SOLO Business Plan. Su dashboard
//     responde "¿cómo voy yo?", no "¿cómo va la cohorte?" — la foto global es de
//     la dirección. El acompañamiento del profesor es de Business Plan; Caso y
//     Proyecto de Investigación los lleva un director de proyecto.
//
// Cada paso de "control del proceso" viaja con su DETALLE (qué equipo/persona
// cumple y cuál no) para que la pantalla pueda abrirlo al hacer clic: un
// porcentaje sin nombres no le dice al profesor a quién llamar.
//
// La ruta entera es de SOLO LECTURA.

const router = Router();
// Al ser solo lectura el profesor también entra: necesita ver el avance de la
// cohorte que acompaña. El alcance se restringe abajo (solo sus cohortes).
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

/** Fila del detalle desplegable de un paso del proceso. */
interface DetalleItem {
  id: string;
  nombre: string;
  /** ¿Este equipo/participante ya cumple el paso? */
  ok: boolean;
  /** Contexto corto: la fecha de la reunión, lo que falta por subir, etc. */
  nota?: string | null;
}

function fechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Bogota',
  });
}

const ESTADO_PARTICIPANTE: Record<string, string> = {
  activo: 'Activo',
  pendiente_activacion: 'Sin activar la cuenta',
  desactivado: 'Desactivado',
};

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

  const esAdmin = !!req.user?.isSuperAdmin || req.user?.role === 'super_admin';
  const alcance: 'cohorte' | 'profesor' = esAdmin ? 'cohorte' : 'profesor';

  const { data: cohorte, error: errCoh } = await supabaseAdmin
    .from('cohortes')
    .select('id, etiqueta')
    .eq('id', cohorteId)
    .maybeSingle();
  if (errCoh) return res.status(500).json({ error: errCoh.message });
  if (!cohorte) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  // --- Alcance del profesor: sus equipos asignados en esta cohorte ----------
  let misEquipoIds: Set<string> | null = null;
  if (!esAdmin) {
    const { data: asig } = await supabaseAdmin
      .from('asignaciones_profesor')
      .select('equipo_id')
      .eq('profesor_id', req.user?.profesorId ?? '')
      .eq('cohorte_id', cohorteId);
    misEquipoIds = new Set(((asig ?? []) as any[]).map((a) => a.equipo_id).filter(Boolean));
  }

  // --- Equipos + su anteproyecto + sus miembros ----------------------------
  const { data: eqData } = await supabaseAdmin
    .from('equipos')
    .select(
      'id, nombre_equipo, tipo_trabajo_grado, proyecto_definitivo_id, ' +
        'reunion_1_profesor_at, reunion_2_profesor_at, ' +
        'anteproyectos(estado, archivo_proyecto_final_path), ' +
        'miembros_equipo(posicion, participante_id, participantes_lista(nombre_completo))',
    )
    .eq('cohorte_id', cohorteId);
  // El profesor solo cuenta sus equipos y solo los de Business Plan.
  const equipos = ((eqData ?? []) as any[]).filter((e) =>
    esAdmin || (misEquipoIds!.has(e.id) && e.tipo_trabajo_grado === 'business_plan'));
  const totalEquipos = equipos.length;

  const miembrosDe = (e: any): any[] =>
    ((e.miembros_equipo ?? []) as any[]).sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0));

  // --- Participantes en el alcance -----------------------------------------
  // El super_admin ve la cohorte entera; el profesor, solo quienes componen sus
  // equipos (un participante suelto de otra célula no es asunto suyo).
  const { data: partData } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, nombre_completo, estado, perfil, fue_emprendedor, quiebra')
    .eq('cohorte_id', cohorteId)
    .order('nombre_completo');
  const misParticipanteIds = new Set<string>();
  for (const e of equipos) {
    for (const m of miembrosDe(e)) if (m.participante_id) misParticipanteIds.add(m.participante_id);
  }
  const participantes = ((partData ?? []) as any[])
    .filter((p) => esAdmin || misParticipanteIds.has(p.id));
  const totalParticipantes = participantes.length;
  const participantesActivos = participantes.filter((p) => p.estado === 'activo').length;

  // --- Nombre con el que se identifica cada equipo -------------------------
  // El equipo no tiene nombre propio: lo identifica su proyecto. En Caso/PI vive
  // en equipos.nombre_equipo; en Business Plan sale de los proyectos del
  // anteproyecto. Si no hay ninguno, los nombres de los participantes. Mismo
  // criterio que /profesor-consulta/equipos, para que el profesor reconozca al
  // equipo con la misma etiqueta en las dos pantallas.
  const equipoIds = equipos.map((e) => e.id);
  const nombreProyectosPorEquipo = new Map<string, string>();
  const proyectoIdsPorEquipo = new Map<string, string[]>();
  if (equipoIds.length) {
    const { data: antes } = await supabaseAdmin
      .from('anteproyectos')
      .select('equipo_id, proyectos(id, nombre, posicion, estado_seleccion)')
      .in('equipo_id', equipoIds);
    for (const a of ((antes ?? []) as any[])) {
      const vivos = ((a.proyectos ?? []) as any[])
        .filter((p) => p.estado_seleccion !== 'archivado')
        .sort((x, y) => (x.posicion ?? 0) - (y.posicion ?? 0));
      proyectoIdsPorEquipo.set(a.equipo_id, vivos.map((p) => p.id));
      const nombres = vivos.map((p) => String(p.nombre ?? '').trim()).filter(Boolean);
      if (nombres.length) nombreProyectosPorEquipo.set(a.equipo_id, nombres.join(' · '));
    }
  }
  const nombreEquipo = (e: any): string =>
    e.nombre_equipo
    ?? nombreProyectosPorEquipo.get(e.id)
    ?? (miembrosDe(e).map((m) => m.participantes_lista?.nombre_completo).filter(Boolean).join(' · ')
      || 'Equipo sin nombre');

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
  const docsDeEquipo = (e: any) => {
    const a = pickAnte(e.anteproyectos);
    const cont = e.proyecto_definitivo_id ? contenidoPorProyecto.get(e.proyecto_definitivo_id) : null;
    return {
      archivoFinalPath: a?.archivo_proyecto_final_path ?? null,
      onePagerPath: cont?.one_pager_path ?? null,
      logoPath: cont?.logo_path ?? null,
      modeloFinancieroPath: cont?.modelo_financiero_path ?? null,
    };
  };
  const definitivoEntregadoDeEquipo = (e: any) =>
    entregaFinalCompleta(e.tipo_trabajo_grado, docsDeEquipo(e));
  /** Qué documentos le faltan al equipo para que la entrega final cuente. */
  const faltantesDeEquipo = (e: any): string[] => {
    const d = docsDeEquipo(e);
    const falta: string[] = [];
    if (!d.archivoFinalPath) falta.push('documento final');
    if (e.tipo_trabajo_grado === 'business_plan') {
      if (!d.onePagerPath) falta.push('one pager');
      if (!d.logoPath) falta.push('logo');
      if (!d.modeloFinancieroPath) falta.push('modelo financiero');
    }
    return falta;
  };
  const definitivosEntregados = equipos.filter(definitivoEntregadoDeEquipo).length;
  const reunion1 = equipos.filter((e) => e.reunion_1_profesor_at).length;
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
  for (const e of equipos) {
    const t = tipoPorEquipo.get(e.id);
    if (t) participantesPorModalidad[t] += miembrosDe(e).length;
  }

  // --- Proyectos programados en jornadas -----------------------------------
  // Se cuenta POR EQUIPO (el total del paso son equipos): un equipo está
  // programado si alguno de sus proyectos vivos ocupa un slot de la cohorte.
  // Contar slots contra un total de equipos podía pasarse del 100%.
  const proyectosProgramados = new Set<string>();
  const { data: jornadas } = await supabaseAdmin
    .from('jornadas')
    .select('id')
    .eq('cohorte_id', cohorteId);
  const jornadaIds = ((jornadas ?? []) as any[]).map((j) => j.id);
  if (jornadaIds.length) {
    const { data: slots } = await supabaseAdmin
      .from('slot_presentacion')
      .select('proyecto_id')
      .in('jornada_id', jornadaIds)
      .not('proyecto_id', 'is', null);
    for (const s of ((slots ?? []) as any[])) proyectosProgramados.add(s.proyecto_id);
  }
  const programadoDeEquipo = (e: any) =>
    (proyectoIdsPorEquipo.get(e.id) ?? []).some((pid) => proyectosProgramados.has(pid))
    || (!!e.proyecto_definitivo_id && proyectosProgramados.has(e.proyecto_definitivo_id));
  const programados = equipos.filter(programadoDeEquipo).length;

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
  // El profesor solo ve las actas de SUS participantes.
  const { data: actasData } = await supabaseAdmin
    .from('acta')
    .select('estado, participante_id')
    .eq('cohorte_id', cohorteId);
  const actas = ((actasData ?? []) as any[])
    .filter((a) => esAdmin || misParticipanteIds.has(a.participante_id));
  const cuentaActas = (estados: string[]) => actas.filter((a) => estados.includes(a.estado)).length;

  // --- Detalle desplegable de cada paso del proceso -------------------------
  // Mismo criterio de conteo que el número de la barra: si el detalle y el
  // porcentaje se calcularan por caminos distintos acabarían discrepando.
  const detalleEquipos = (
    ok: (e: any) => boolean,
    nota?: (e: any) => string | null,
  ): DetalleItem[] =>
    equipos
      .map((e) => ({ id: e.id, nombre: nombreEquipo(e), ok: ok(e), nota: nota ? nota(e) : null }))
      .sort((a, b) => Number(a.ok) - Number(b.ok) || a.nombre.localeCompare(b.nombre));

  const miembrosComoNota = (e: any): string | null => {
    const nombres = miembrosDe(e).map((m) => m.participantes_lista?.nombre_completo).filter(Boolean);
    return nombres.length ? nombres.join(' · ') : null;
  };

  // Orden de lectura: primero el acompañamiento vivo (reuniones y entregas), que
  // es lo que se mueve semana a semana; al final el arranque de la cohorte
  // (participantes, equipos, anteproyectos), que se completa temprano y se queda
  // clavado en 100 % ocupando la parte alta de la lista.
  const pasos = [
    {
      clave: 'reunion_1',
      label: 'Reunión 1 realizada',
      ayuda: esAdmin
        ? 'Reuniones que el profesor marcó como realizadas en la sábana.'
        : 'Reuniones que ya marcaste como realizadas en la sábana.',
      n: reunion1,
      total: totalEquipos,
      detalle: detalleEquipos(
        (e) => !!e.reunion_1_profesor_at,
        // Si está pendiente, se listan los participantes: son a quienes hay que
        // convocar, y el nombre del equipo por sí solo no los nombra.
        (e) => (e.reunion_1_profesor_at
          ? `Marcada el ${fechaCorta(e.reunion_1_profesor_at)}`
          : miembrosComoNota(e)),
      ),
    },
    {
      clave: 'reunion_2',
      label: 'Reunión 2 realizada',
      ayuda: esAdmin
        ? 'Reuniones que el profesor marcó como realizadas en la sábana.'
        : 'Reuniones que ya marcaste como realizadas en la sábana.',
      n: reunion2,
      total: totalEquipos,
      detalle: detalleEquipos(
        (e) => !!e.reunion_2_profesor_at,
        (e) => (e.reunion_2_profesor_at
          ? `Marcada el ${fechaCorta(e.reunion_2_profesor_at)}`
          : miembrosComoNota(e)),
      ),
    },
    {
      clave: 'trabajos_definitivos',
      label: 'Trabajos definitivos entregados',
      ayuda: 'La entrega final cuenta solo con TODOS sus documentos subidos.',
      n: definitivosEntregados,
      total: totalEquipos,
      detalle: detalleEquipos(definitivoEntregadoDeEquipo, (e) => {
        const falta = faltantesDeEquipo(e);
        return falta.length ? `Falta: ${falta.join(', ')}` : null;
      }),
    },
    {
      clave: 'programados',
      label: 'Proyectos programados en jornadas',
      ayuda: 'Equipos con presentación asignada en la programación de la cohorte.',
      n: programados,
      total: totalEquipos,
      detalle: detalleEquipos(programadoDeEquipo),
    },
    // --- Arranque de la cohorte (cierra la lista) ---------------------------
    {
      clave: 'participantes',
      label: 'Participantes cargados',
      ayuda: 'Participantes con la cuenta ya activada.',
      n: participantesActivos,
      total: totalParticipantes,
      detalle: participantes.map((p) => ({
        id: p.id,
        nombre: p.nombre_completo ?? 'Sin nombre',
        ok: p.estado === 'activo',
        // Al activo no se le repite el estado: ya lo dice la etiqueta "Listo".
        nota: p.estado === 'activo' ? null : (ESTADO_PARTICIPANTE[p.estado] ?? p.estado),
      })).sort((a, b) => Number(a.ok) - Number(b.ok) || a.nombre.localeCompare(b.nombre)),
    },
    {
      clave: 'equipos',
      label: 'Equipos conformados',
      ayuda: 'Equipos con participantes registrados.',
      n: equipos.filter((e) => miembrosDe(e).length > 0).length,
      total: totalEquipos,
      detalle: detalleEquipos((e) => miembrosDe(e).length > 0, miembrosComoNota),
    },
    {
      clave: 'anteproyectos',
      label: 'Anteproyectos entregados',
      ayuda: 'El equipo envió su anteproyecto (ya no está en borrador).',
      n: anteEntregados,
      total: totalEquipos,
      detalle: detalleEquipos(anteEntregadoDeEquipo, (e) => {
        const a = pickAnte(e.anteproyectos);
        if (!a) return 'Sin anteproyecto creado';
        return a.estado === 'borrador' ? 'Todavía en borrador' : null;
      }),
    },
  ];

  res.json({
    alcance,
    cohorte: { id: cohorte.id, etiqueta: cohorte.etiqueta },
    bloque1: {
      participantes_activos: participantesActivos,
      participantes_total: totalParticipantes,
      proyectos: totalEquiposBP,
      equipos_totales: totalEquipos,
      anteproyectos_entregados: {
        n: anteEntregados,
        total: totalEquipos,
        por_modalidad: anteEntregadosPorModalidad,
      },
      trabajos_definitivos_entregados: { n: definitivosEntregados, total: totalEquipos },
      // Lo que el profesor mira primero: cómo va él con sus reuniones.
      reunion_1: { n: reunion1, total: totalEquipos },
      reunion_2: { n: reunion2, total: totalEquipos },
    },
    bloque2: pasos,
    bloque3: {
      actas: {
        disponible: true,
        // Total de actas del alcance (una por participante).
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
    },
    bloque4: {
      // El reparto por modalidad solo tiene sentido en la foto de cohorte: en el
      // alcance del profesor todo es Business Plan y serían dos gráficas de una
      // sola barra.
      trabajos_por_modalidad: esAdmin ? trabajosPorModalidad : undefined,
      participantes_por_modalidad: esAdmin ? participantesPorModalidad : undefined,
      perfil_emprendedor: perfilEmprendedor,
      experiencia_previa: experienciaPrevia,
      desenlace_experiencia_previa: desenlacePrevio,
      emociones: emociones,
      preocupaciones: preocupaciones,
    },
  });
});

export default router;
