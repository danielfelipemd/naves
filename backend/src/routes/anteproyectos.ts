import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import { crearUrlProxyArchivo, mimeFromPath } from '../services/storage.js';
import { notificarRegistroAnteproyectoAParticipantes } from '../services/notificaciones-anteproyecto.js';
import { regenerarSabana } from './sabana.js';

const router = Router();
router.use(requireAuth());

// === GET /api/anteproyectos/mi-anteproyecto =================================
router.get('/mi-anteproyecto', async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  const { data: miembro } = await supabaseAdmin
    .from('miembros_equipo')
    .select('equipo_id')
    .eq('participante_id', pid)
    .maybeSingle();

  if (!miembro) return res.json({ anteproyecto: null });

  const SELECT_ANTE = `
      *,
      equipos:equipos!inner (
        id, tipo_trabajo_grado, director_id, director_asignado_at,
        proyecto_definitivo_id,
        director:directores ( id, nombre_completo )
      ),
      proyectos (
        *,
        hitos ( id, posicion, descripcion, fecha_inicio, fecha_fin )
      )
    `;

  let { data, error } = await supabaseAdmin
    .from('anteproyectos')
    .select(SELECT_ANTE)
    .eq('equipo_id', miembro.equipo_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  // AUTO-REPARACIÓN: todo equipo debe tener su anteproyecto en borrador (se crea
  // junto con el equipo). Si falta —porque aquel insert falló alguna vez— el
  // participante quedaba atrapado: el formulario cargaba sin id, el autoguardado
  // no persistía nada y "Enviar" no hacía nada. Lo creamos aquí y seguimos.
  // Es idempotente: equipo_id es UNIQUE, así que una carrera entre dos miembros
  // solo deja una fila (el segundo insert falla y releemos).
  if (!data) {
    console.warn(`[mi-anteproyecto] equipo ${miembro.equipo_id} sin anteproyecto; creando`);
    const { error: errIns } = await supabaseAdmin
      .from('anteproyectos').insert({ equipo_id: miembro.equipo_id, ultimo_editor_id: pid });
    // Un error de unicidad significa que otro miembro lo creó a la vez: no es
    // un fallo, releemos. Cualquier otro error sí lo es.
    const esCarrera = !!errIns && /duplicate|unique/i.test(errIns.message ?? '');
    if (errIns && !esCarrera) {
      console.error('[mi-anteproyecto] no se pudo auto-reparar:', errIns.message);
      return res.status(500).json({ error: 'ANTEPROYECTO_REPAIR_FAILED', detail: errIns.message });
    }
    const reread = await supabaseAdmin
      .from('anteproyectos')
      .select(SELECT_ANTE)
      .eq('equipo_id', miembro.equipo_id)
      .maybeSingle();
    if (reread.error) return res.status(500).json({ error: reread.error.message });
    data = reread.data;
    // Si tras reparar sigue sin haber fila, NO devolvemos null en silencio:
    // eso reproduce exactamente el bug original (formulario sin id, "Enviar"
    // mudo). Es mejor un error visible que una trampa invisible.
    if (!data) return res.status(500).json({ error: 'ANTEPROYECTO_REPAIR_FAILED' });
  }
  if (!data) return res.json({ anteproyecto: null });

  // URLs proxy (5 min) hacia nuestro dominio — nunca exponemos la URL firmada
  // de Supabase Storage al cliente.
  const ant: any = data;
  if (ant.archivo_anteproyecto_path) {
    ant.archivo_anteproyecto_url = crearUrlProxyArchivo(ant.archivo_anteproyecto_path, ant.archivo_anteproyecto_mime);
  }
  if (ant.archivo_proyecto_final_path) {
    ant.archivo_proyecto_final_url = crearUrlProxyArchivo(ant.archivo_proyecto_final_path, ant.archivo_proyecto_final_mime);
  }

  // Material de apoyo del proyecto definitivo (one pager, logo, modelo
  // financiero): lo sube el participante desde la pantalla de proyecto de grado
  // y alimenta la programación de presentaciones. Vive en proyecto_contenido,
  // colgado del proyecto definitivo, así que solo hay algo que mostrar una vez
  // elegido. Se entrega ya envuelto para que la pantalla no arme URLs ni rutas.
  // Fechas límite del proyecto de grado, resueltas por equipo → cohorte:
  //  - fecha_limite_proyecto: el hito 10 del cronograma (DATE). Lo usa el
  //    formulario de anteproyecto para el hito "Consolidación Documento Final".
  //  - fecha_limite_proyecto_final: el CORTE real para cargar el proyecto de
  //    grado, como datetime con hora. Sale del campo configurable de la cohorte;
  //    si no está, del hito 10 a fin del día (Bogotá). Lo usa la pantalla de
  //    trabajo de grado para mostrar fecha+hora y bloquear la carga vencida.
  ant.fecha_limite_proyecto = null;
  ant.fecha_limite_proyecto_final = null;
  if (ant.equipo_id) {
    const { data: eq } = await supabaseAdmin.from('equipos').select('cohorte_id').eq('id', ant.equipo_id).maybeSingle();
    const cohorteId = (eq as any)?.cohorte_id;
    if (cohorteId) {
      const [{ data: hito }, { data: coh }] = await Promise.all([
        supabaseAdmin.from('cohorte_hitos').select('fecha').eq('cohorte_id', cohorteId).eq('posicion', 10).maybeSingle(),
        supabaseAdmin.from('cohortes').select('fecha_limite_proyecto_final').eq('id', cohorteId).maybeSingle(),
      ]);
      const fHito = (hito as any)?.fecha ?? null;
      ant.fecha_limite_proyecto = fHito;
      const dt = (coh as any)?.fecha_limite_proyecto_final;
      ant.fecha_limite_proyecto_final = dt
        ? new Date(dt).toISOString()
        : (fHito ? new Date(`${fHito}T23:59:59-05:00`).toISOString() : null);
    }
  }

  ant.assets = { one_pager: null, logo: null, modelo_financiero: null };
  if (ant.equipos?.proyecto_definitivo_id) {
    const { data: cont } = await supabaseAdmin
      .from('proyecto_contenido')
      .select('one_pager_path, logo_path, modelo_financiero_path')
      .eq('proyecto_id', ant.equipos.proyecto_definitivo_id)
      .maybeSingle();
    const asset = (path: string | null) => path
      ? { cargado: true, url: crearUrlProxyArchivo(path, mimeFromPath(path)), nombre: path.split('/').pop() ?? '' }
      : null;
    if (cont) {
      ant.assets = {
        one_pager: asset((cont as any).one_pager_path ?? null),
        logo: asset((cont as any).logo_path ?? null),
        modelo_financiero: asset((cont as any).modelo_financiero_path ?? null),
      };
    }
  }

  res.json({ anteproyecto: ant });
});

// === Validaciones del payload ===============================================
// El perfil emprendedor (rol, emociones, preocupaciones, emprendimiento previo)
// se llena en /mi-perfil y de ahi se copia a miembros_equipo via
// copyPerfilParticipanteAMiembro. Aqui en /anteproyecto solo se valida lo que
// es propio del anteproyecto. Los campos del perfil son opcionales en el
// payload; si llegan se aplican, si no, se respeta lo que ya hay en BD.
const miembroSchema = z.object({
  participante_id: z.string().uuid(),
  // Tope 4: el super_admin puede crear equipos excepcionales de 4 personas.
  posicion: z.number().int().min(1).max(4),
  fue_emprendedor: z.boolean().optional(),
  quiebra: z.enum(['nunca_despego', 'funcionamiento', 'vendido', 'quebro', 'na']).optional(),
  aprendizajes_quiebra: z.string().max(300).optional(),
  perfil: z.enum(['emprendedor', 'directivo', 'ambos']).optional(),
  emociones: z.array(z.enum(['crear', 'dinero', 'problema', 'autonomia', 'ninguna'])).optional(),
  preocupaciones: z.array(z.enum(['financiera', 'estres', 'habilidades', 'familia', 'ninguna'])).optional(),
});

const hitoSchema = z.object({
  posicion: z.number().int().min(1),
  descripcion: z.string().min(1).max(200),
  fecha_inicio: z.string(),
  fecha_fin: z.string(),
});

// Permite '' (string vacio) para enums/regex: el autoguardado dispara mientras
// el participante esta llenando y muchas veces los campos llegan a vacio en
// transiciones de re-render. La validacion de "no vacio al enviar" vive en
// POST /:id/enviar.
const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);
const proyectoSchema = z.object({
  posicion: z.number().int().min(1).max(2),
  nombre: z.string().max(150),
  tipo: z.preprocess(emptyToUndef, z.enum(['emprendimiento', 'intraemprendimiento']).optional()),
  sector: z.string().max(100).optional(),
  ciiu: z.preprocess(emptyToUndef, z.string().regex(/^\d{4}$/).optional()),
  canvas_cliente: z.string().max(1000).optional(),
  canvas_problema: z.string().max(1000).optional(),
  canvas_solucion: z.string().max(1000).optional(),
  canvas_canales: z.string().max(300).optional(),
  canvas_relaciones: z.string().max(300).optional(),
  canvas_ingresos: z.string().max(300).optional(),
  canvas_recursos: z.string().max(300).optional(),
  canvas_actividades: z.string().max(300).optional(),
  canvas_socios: z.string().max(300).optional(),
  canvas_costos: z.string().max(300).optional(),
  estado: z.preprocess(emptyToUndef, z.enum(['idea', 'investigacion', 'prototipo', 'validacion', 'funcionamiento']).optional()),
  fuentes_primarias: z.string().max(300).optional(),
  fuentes_secundarias: z.string().max(300).optional(),
  hitos: z.array(hitoSchema).max(10),
});

const updateSchema = z.object({
  numero_miembros: z.number().int().min(1).max(4),
  numero_proyectos: z.number().int().min(1).max(2),
  miembros: z.array(miembroSchema),
  proyectos: z.array(proyectoSchema).min(1).max(2),
  // Flags de sábana (nivel equipo, BP) -- nullable mientras no contesten.
  buscando_socios: z.boolean().nullable().optional(),
  buscando_asociacion_otro_proyecto: z.boolean().nullable().optional(),
}).refine((d) => d.miembros.length === d.numero_miembros, {
  message: 'numero_miembros debe coincidir con miembros.length',
}).refine((d) => d.proyectos.length === d.numero_proyectos, {
  message: 'numero_proyectos debe coincidir con proyectos.length',
});

type PersistResult = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Persiste un payload de borrador (miembros, flags, proyectos, hitos) en BD.
 * Asume que ya se validaron: existencia, membership, estado=borrador, plazo,
 * CIIUs. Retorna { ok: true } o { ok: false, status, body } con el error
 * exacto a devolverle al cliente.
 *
 * Reutilizada por:
 *   - PUT /api/anteproyectos/:id (autoguardado normal)
 *   - POST /api/anteproyectos/:id/enviar cuando trae body completo
 *     (el envio guarda + marca como enviado en una sola llamada, asi el
 *     usuario no depende de que el ultimo autoguardado haya llegado).
 */
async function persistirBorradorEnBD(params: {
  anteId: string;
  equipoId: string;
  participanteId: string;
  payload: z.infer<typeof updateSchema>;
}): Promise<PersistResult> {
  const { anteId, equipoId, participanteId, payload } = params;

  // === Miembros (perfil emprendedor) — solo si el payload trae cambios =====
  // El formulario de anteproyecto solo manda participante_id + posicion, asi
  // que este loop normalmente queda no-op. Saltearlo evita 2 round-trips por
  // miembro de puro desperdicio.
  const miembrosConCambios = payload.miembros.filter((m) =>
    m.fue_emprendedor !== undefined ||
    m.perfil !== undefined ||
    m.emociones !== undefined ||
    m.preocupaciones !== undefined,
  );
  if (miembrosConCambios.length > 0) {
    // Hoy el formulario no manda emociones/preocupaciones, así que este bloque
    // casi no corre; pero el esquema las acepta, y si un cliente empezara a
    // enviarlas un borrar-y-reinsertar sin verificar dejaría el perfil del
    // miembro VACÍO respondiendo ok. Cada escritura devuelve su error.
    const errores = await Promise.all(miembrosConCambios.map(async (m): Promise<string | null> => {
      const updateRow: Record<string, unknown> = {};
      if (m.fue_emprendedor !== undefined) {
        updateRow.fue_emprendedor = m.fue_emprendedor;
        updateRow.quiebra = m.fue_emprendedor ? (m.quiebra ?? null) : null;
        updateRow.aprendizajes_quiebra = m.fue_emprendedor ? (m.aprendizajes_quiebra ?? null) : null;
      }
      if (m.perfil !== undefined) updateRow.perfil = m.perfil;
      if (Object.keys(updateRow).length) {
        const { error } = await supabaseAdmin.from('miembros_equipo').update(updateRow)
          .eq('equipo_id', equipoId).eq('participante_id', m.participante_id);
        if (error) return error.message;
      }
      if (m.emociones === undefined && m.preocupaciones === undefined) return null;
      const { data: row, error: errRow } = await supabaseAdmin
        .from('miembros_equipo').select('id').eq('equipo_id', equipoId).eq('participante_id', m.participante_id).maybeSingle();
      if (errRow) return errRow.message;
      if (!row) return null;
      if (m.emociones) {
        const { error: eDel } = await supabaseAdmin.from('miembro_emociones').delete().eq('miembro_id', row.id);
        if (eDel) return eDel.message;
        if (m.emociones.length) {
          const { error } = await supabaseAdmin.from('miembro_emociones').insert(m.emociones.map((emocion) => ({ miembro_id: row.id, emocion })));
          if (error) return error.message;
        }
      }
      if (m.preocupaciones) {
        const { error: pDel } = await supabaseAdmin.from('miembro_preocupaciones').delete().eq('miembro_id', row.id);
        if (pDel) return pDel.message;
        if (m.preocupaciones.length) {
          const { error } = await supabaseAdmin.from('miembro_preocupaciones').insert(m.preocupaciones.map((preocupacion) => ({ miembro_id: row.id, preocupacion })));
          if (error) return error.message;
        }
      }
      return null;
    }));
    const primerError = errores.find(Boolean);
    if (primerError) return { ok: false, status: 500, body: { error: primerError, paso: 'perfil de miembros' } };
  }

  // === Flags equipo + SELECT proyectos existentes en PARALELO =============
  const equipoUpdate: Record<string, unknown> = {};
  if (payload.buscando_socios !== undefined) equipoUpdate.buscando_socios = payload.buscando_socios;
  if (payload.buscando_asociacion_otro_proyecto !== undefined) equipoUpdate.buscando_asociacion_otro_proyecto = payload.buscando_asociacion_otro_proyecto;
  // OJO: el resultado del UPDATE de flags NO se puede descartar (antes era una
  // elisión `[, existingRes]` y su error era inalcanzable). Si falla, el equipo
  // se queda sin los flags de sábana: cada autoguardado responde ok, pero al
  // enviar el backend rechaza con FLAG_BUSCANDO_SOCIOS_REQUERIDO una pregunta
  // que el estudiante YA contestó, y no hay forma de salir de ahí.
  const [flagsRes, existingRes] = await Promise.all([
    Object.keys(equipoUpdate).length
      ? supabaseAdmin.from('equipos').update(equipoUpdate).eq('id', equipoId)
      : Promise.resolve({ error: null } as { error: null }),
    supabaseAdmin.from('proyectos').select('id, estado_seleccion').eq('anteproyecto_id', anteId),
  ]);
  if ((flagsRes as any)?.error) {
    return { ok: false, status: 500, body: { error: (flagsRes as any).error.message, paso: 'flags equipo' } };
  }
  if (existingRes?.error) {
    return { ok: false, status: 500, body: { error: existingRes.error.message, paso: 'leer proyectos' } };
  }
  const eliminables = ((existingRes?.data ?? []) as Array<{ id: string; estado_seleccion: string }>)
    .filter((p) => p.estado_seleccion === 'pendiente_seleccion');

  // === DELETE proyectos eliminables + BATCH INSERT proyectos nuevos =======
  // Antes era 1 DELETE + N INSERTs serializados. Ahora 1 DELETE + 1 INSERT
  // batch que devuelve los IDs nuevos, luego 1 INSERT batch global de hitos.
  if (eliminables.length) {
    const { error } = await supabaseAdmin.from('proyectos').delete().in('id', eliminables.map((p) => p.id));
    if (error) return { ok: false, status: 500, body: { error: error.message, paso: 'delete proyectos' } };
  }

  if (payload.proyectos.length > 0) {
    const proyectosToInsert = payload.proyectos.map((p) => {
      const { hitos: _hitos, ...proyectoData } = p;
      return { ...proyectoData, anteproyecto_id: anteId };
    });
    const { data: newProjs, error: errProj } = await supabaseAdmin
      .from('proyectos')
      .insert(proyectosToInsert)
      .select('id, posicion');
    if (errProj) return { ok: false, status: 500, body: { error: errProj.message, paso: 'insert proyectos' } };

    const allHitos: Array<{ proyecto_id: string; posicion: number; descripcion: string; fecha_inicio: string; fecha_fin: string }> = [];
    for (const p of payload.proyectos) {
      const newProj = (newProjs ?? []).find((np) => np.posicion === p.posicion);
      if (!newProj) continue;
      for (const h of p.hitos) {
        allHitos.push({ ...h, proyecto_id: newProj.id });
      }
    }
    if (allHitos.length > 0) {
      const { error: errHito } = await supabaseAdmin.from('hitos').insert(allHitos);
      if (errHito) return { ok: false, status: 500, body: { error: errHito.message, paso: 'insert hitos' } };
    }
  }

  // === fecha_actualizacion (fire-and-forget, no bloquea) ==================
  // Capturamos el rechazo: un blip de red haría que esta promesa rechace y,
  // sin catch, tumbaría el proceso (este helper corre en cada autoguardado).
  Promise.resolve(
    supabaseAdmin
      .from('anteproyectos')
      .update({ ultimo_editor_id: participanteId, fecha_actualizacion: new Date().toISOString() })
      .eq('id', anteId)
  ).catch((e) => console.warn('[fecha_actualizacion] update falló:', (e as Error)?.message));

  return { ok: true };
}

// === PUT /api/anteproyectos/:id (guardar borrador) ==========================
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // === Cargar contexto en PARALELO =========================================
  // Antes eran 4 round-trips serializados (anteproyecto, miembro, cohorte,
  // CIIUs). Ahora todos al tiempo via Promise.all.
  const ciiusToCheck = parsed.data.proyectos.map((p) => p.ciiu).filter(Boolean) as string[];
  const [antRes, miembroRes, ciiusRes] = await Promise.all([
    supabaseAdmin
      .from('anteproyectos')
      .select('id, equipo_id, estado, equipos!inner ( cohortes!inner ( fecha_limite_entrega_anteproyecto ) )')
      .eq('id', req.params.id)
      .maybeSingle(),
    supabaseAdmin
      .from('miembros_equipo')
      .select('id, equipo_id')
      .eq('participante_id', pid),
    ciiusToCheck.length > 0
      ? supabaseAdmin.from('codigos_ciiu').select('codigo').in('codigo', ciiusToCheck)
      : Promise.resolve({ data: [] as Array<{ codigo: string }>, error: null }),
  ]);

  const ant = antRes.data;
  if (!ant) return res.status(404).json({ error: 'NOT_FOUND' });

  // GUARDRAIL: si el anteproyecto ya fue enviado, rechazamos el PUT. Esto
  // protege contra autoguardados tardios que llegan despues del envio y
  // podrian sobreescribir datos ya entregados.
  if (ant.estado !== 'borrador') {
    return res.status(409).json({ error: 'ALREADY_SUBMITTED', estado: ant.estado });
  }

  const esMiembro = (miembroRes.data ?? []).some((m: any) => m.equipo_id === ant.equipo_id);
  if (!esMiembro) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  const limite = (ant.equipos as any)?.cohortes?.fecha_limite_entrega_anteproyecto;
  if (limite && new Date() >= new Date(limite)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: limite });
  }

  const validSet = new Set(((ciiusRes.data ?? []) as Array<{ codigo: string }>).map((c) => c.codigo));
  const invalid = ciiusToCheck.filter((c) => !validSet.has(c));
  if (invalid.length) return res.status(400).json({ error: 'INVALID_CIIU', invalid });

  const result = await persistirBorradorEnBD({
    anteId: req.params.id,
    equipoId: ant.equipo_id,
    participanteId: pid,
    payload: parsed.data,
  });
  if (!result.ok) return res.status(result.status).json(result.body);
  res.json({ ok: true });
});

// === POST /api/anteproyectos/:id/enviar =====================================
router.post('/:id/enviar', async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Cargar anteproyecto + miembro en PARALELO (antes eran 2 round-trips
  // serializados antes de cualquier trabajo real).
  const [antRes, yoRes] = await Promise.all([
    supabaseAdmin
      .from('anteproyectos')
      .select(`
        id, equipo_id, estado,
        archivo_anteproyecto_path, archivo_proyecto_final_path,
        equipos:equipos!inner ( tipo_trabajo_grado, cohorte_id )
      `)
      .eq('id', req.params.id)
      .maybeSingle(),
    supabaseAdmin
      .from('miembros_equipo').select('id, equipo_id').eq('participante_id', pid),
  ]);
  const ant = antRes.data;
  if (!ant) return res.status(404).json({ error: 'NOT_FOUND' });
  if (ant.estado !== 'borrador') return res.status(409).json({ error: 'ALREADY_SUBMITTED', estado: ant.estado });

  const esMiembro = (yoRes.data ?? []).some((m: any) => m.equipo_id === ant.equipo_id);
  if (!esMiembro) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  const modalidad = (ant.equipos as any)?.tipo_trabajo_grado;

  // === Modalidades 'caso' / 'proyecto_investigacion': solo se exigen los 2 archivos
  if (modalidad === 'caso' || modalidad === 'proyecto_investigacion') {
    const faltantes: string[] = [];
    if (!ant.archivo_anteproyecto_path) faltantes.push('anteproyecto');
    if (!ant.archivo_proyecto_final_path) faltantes.push('proyecto_final');
    if (faltantes.length) return res.status(400).json({ error: 'ARCHIVOS_FALTANTES', faltantes });

    // CRÍTICO: si este update falla en silencio, el participante ve la
    // constancia de envío pero el anteproyecto sigue en 'borrador'.
    const fechaEnvio = new Date().toISOString();
    const { error: errEnvioArch } = await supabaseAdmin.from('anteproyectos').update({
      estado: 'enviado',
      fecha_envio: fechaEnvio,
      ultimo_editor_id: pid,
    }).eq('id', req.params.id);
    if (errEnvioArch) return res.status(500).json({ error: 'ENVIO_FALLIDO', detail: errEnvioArch.message });

    // Mismo correo unificado para todas las modalidades (sin info de director
    // porque para caso/PI ya se notifico al cargar el archivo, aqui es solo
    // el envio definitivo).
    void notificarRegistroAnteproyectoAParticipantes({
      equipoId: ant.equipo_id,
      modalidad: modalidad as 'business_plan' | 'caso' | 'proyecto_investigacion' | null,
      fechaIso: fechaEnvio,
    });

    // Regenerar el snapshot de la sabana de la cohorte para que el admin
    // vea el equipo recien enviado sin tener que tocar "Generar" a mano.
    const cohorteId = (ant.equipos as any)?.cohorte_id;
    if (cohorteId) void regenerarSabana(cohorteId).catch(() => { /* best effort */ });

    return res.json({ ok: true, modalidad, fecha_envio: fechaEnvio });
  }

  // === Modalidad 'business_plan' (NAVES): persistir payload + validar + enviar
  //
  // Si el cliente envia body con el payload completo del formulario, lo
  // persistimos AQUI MISMO antes de validar y marcar como enviado. Esto
  // garantiza que "Enviar anteproyecto" no dependa de que el ultimo
  // autoguardado haya llegado: el envio es autosuficiente. Si no llega body
  // (clientes viejos), seguimos validando contra lo que haya en BD.
  const bodyParsed = updateSchema.safeParse(req.body);
  if (bodyParsed.success) {
    // Plazo y CIIUs (mismo guardrail que el PUT)
    const { data: cohorte } = await supabaseAdmin
      .from('equipos').select('cohortes(fecha_limite_entrega_anteproyecto)').eq('id', ant.equipo_id).maybeSingle();
    const limite = (cohorte?.cohortes as any)?.fecha_limite_entrega_anteproyecto;
    if (limite && new Date() >= new Date(limite)) {
      return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: limite });
    }
    const ciiusToCheck = bodyParsed.data.proyectos.map((p) => p.ciiu).filter(Boolean) as string[];
    if (ciiusToCheck.length) {
      const { data: validCiius } = await supabaseAdmin
        .from('codigos_ciiu').select('codigo').in('codigo', ciiusToCheck);
      const validSet = new Set((validCiius ?? []).map((c) => c.codigo));
      const invalid = ciiusToCheck.filter((c) => !validSet.has(c));
      if (invalid.length) return res.status(400).json({ error: 'INVALID_CIIU', invalid });
    }
    const persist = await persistirBorradorEnBD({
      anteId: req.params.id,
      equipoId: ant.equipo_id,
      participanteId: pid,
      payload: bodyParsed.data,
    });
    if (!persist.ok) return res.status(persist.status).json(persist.body);
  }

  // Flags de sábana (a nivel equipo) son obligatorios al enviar
  const { data: equipoFlags } = await supabaseAdmin
    .from('equipos')
    .select('buscando_socios, buscando_asociacion_otro_proyecto')
    .eq('id', ant.equipo_id)
    .maybeSingle();
  if (equipoFlags?.buscando_socios === null || equipoFlags?.buscando_socios === undefined) {
    return res.status(400).json({
      error: 'FLAG_BUSCANDO_SOCIOS_REQUERIDO',
      mensaje: 'Indica si tu equipo está buscando socios antes de enviar.',
    });
  }
  if (equipoFlags?.buscando_asociacion_otro_proyecto === null || equipoFlags?.buscando_asociacion_otro_proyecto === undefined) {
    return res.status(400).json({
      error: 'FLAG_BUSCANDO_ASOCIACION_REQUERIDO',
      mensaje: 'Indica si tu equipo busca asociación con otro proyecto antes de enviar.',
    });
  }

  const { data: proyectos } = await supabaseAdmin
    .from('proyectos')
    .select('id, nombre, tipo, sector, ciiu, hitos ( posicion, descripcion, fecha_inicio, fecha_fin )')
    .eq('anteproyecto_id', req.params.id);
  if (!proyectos || proyectos.length === 0) return res.status(400).json({ error: 'NO_PROYECTOS' });

  // Cada proyecto debe tener nombre y tipo antes de enviar. El borrador
  // admite estos campos vacios para que el autoguardado funcione mientras
  // se escribe.
  for (const p of proyectos as any[]) {
    if (!p.nombre || !String(p.nombre).trim()) {
      return res.status(400).json({
        error: 'NOMBRE_PROYECTO_REQUERIDO',
        mensaje: 'Cada proyecto debe tener un nombre antes de enviar.',
      });
    }
    if (!p.tipo) {
      return res.status(400).json({
        error: 'TIPO_PROYECTO_REQUERIDO',
        mensaje: `Elige el tipo (Emprendimiento / Intraemprendimiento) del proyecto "${p.nombre}".`,
      });
    }
  }

  // Mínimo 5 hitos completos (descripcion + ambas fechas) por proyecto
  for (const p of proyectos as any[]) {
    const validos = (p.hitos ?? []).filter((h: any) => h?.descripcion && h?.fecha_inicio && h?.fecha_fin).length;
    if (validos < 5) {
      return res.status(400).json({
        error: 'HITOS_INSUFICIENTES',
        proyecto: p.nombre,
        hitos_validos: validos,
        minimo: 5,
      });
    }
  }

  // Si solo hay 1 proyecto, marcarlo automáticamente como definitivo
  if (proyectos.length === 1) {
    const [rp, re] = await Promise.all([
      supabaseAdmin.from('proyectos').update({ estado_seleccion: 'definitivo' }).eq('id', proyectos[0].id),
      supabaseAdmin.from('equipos').update({ proyecto_definitivo_id: proyectos[0].id }).eq('id', ant.equipo_id),
    ]);
    if (rp.error || re.error) {
      return res.status(500).json({ error: 'ENVIO_FALLIDO', detail: (rp.error ?? re.error)?.message });
    }
  }

  // CRÍTICO: este update es el que realmente registra el envío. Si su error se
  // ignora, el participante ve "¡Anteproyecto enviado!" con su constancia y
  // recibe el correo, pero en la base sigue en 'borrador' y la coordinación
  // nunca lo ve. Verificar SIEMPRE antes de notificar y responder ok.
  const fechaEnvio = new Date().toISOString();
  const { error: errEnvio } = await supabaseAdmin.from('anteproyectos').update({
    estado: 'enviado',
    fecha_envio: fechaEnvio,
    ultimo_editor_id: pid,
  }).eq('id', req.params.id);
  if (errEnvio) return res.status(500).json({ error: 'ENVIO_FALLIDO', detail: errEnvio.message });

  // El correo de confirmación incluye el cronograma de hitos del/los proyecto(s).
  void notificarRegistroAnteproyectoAParticipantes({
    equipoId: ant.equipo_id,
    modalidad: 'business_plan',
    fechaIso: fechaEnvio,
    bp: {
      proyectos: (proyectos as any[]).map((p) => ({
        nombre: p.nombre,
        tipo: p.tipo ?? null,
        sector: p.sector ?? null,
        ciiu: p.ciiu ?? null,
        hitos: ((p.hitos as any[]) ?? [])
          .filter((h) => h?.descripcion && h?.fecha_inicio && h?.fecha_fin)
          .map((h) => ({
            posicion: h.posicion ?? 0,
            descripcion: String(h.descripcion),
            fecha_inicio: String(h.fecha_inicio),
            fecha_fin: String(h.fecha_fin),
          })),
      })),
    },
  });
  // Regenerar el snapshot de la sabana de la cohorte para que el admin
  // vea el equipo recien enviado sin tener que tocar "Generar" a mano.
  const cohorteId = (ant.equipos as any)?.cohorte_id;
  if (cohorteId) void regenerarSabana(cohorteId).catch(() => { /* best effort */ });

  res.json({
    ok: true,
    modalidad: 'business_plan',
    proyectos_count: proyectos.length,
    auto_definitivo: proyectos.length === 1,
    fecha_envio: fechaEnvio,
  });
});

export default router;
