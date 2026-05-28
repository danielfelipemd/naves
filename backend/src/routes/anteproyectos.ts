import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import { crearUrlProxyArchivo } from '../services/storage.js';
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

  const { data, error } = await supabaseAdmin
    .from('anteproyectos')
    .select(`
      *,
      equipos:equipos!inner (
        id, tipo_trabajo_grado, director_id, director_asignado_at,
        director:directores ( id, nombre_completo )
      ),
      proyectos (
        *,
        hitos ( id, posicion, descripcion, fecha_inicio, fecha_fin )
      )
    `)
    .eq('equipo_id', miembro.equipo_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
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
  posicion: z.number().int().min(1).max(3),
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
  numero_miembros: z.number().int().min(1).max(3),
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

// === PUT /api/anteproyectos/:id (guardar borrador) ==========================
// Optimizado para que el autoguardado sea rapido (~600-800 ms): el handler
// hace muchos chequeos previos en PARALELO y los inserts de proyectos/hitos
// en batch en vez de loops. Antes tomaba 2-3 s, lo que hacia que el front
// se sintiera bloqueado entre keystrokes.
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // === Cargar contexto en PARALELO ==========================================
  // Antes eran 4 round-trips serializados (anteproyecto, miembro, cohorte,
  // CIIUs). Ahora es un solo round-trip paralelo.
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

  // GUARDRAIL: un autoguardado tardio NO puede sobreescribir un anteproyecto
  // ya enviado. Si el participante envio mientras un autosave estaba en
  // vuelo, ese autosave llegara despues y debe rechazarse.
  if (ant.estado !== 'borrador') {
    return res.status(409).json({ error: 'ALREADY_SUBMITTED', estado: ant.estado });
  }

  const esMiembro = (miembroRes.data ?? []).some((m: any) => m.equipo_id === ant.equipo_id);
  if (!esMiembro) {
    return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });
  }

  const limite = (ant.equipos as any)?.cohortes?.fecha_limite_entrega_anteproyecto;
  if (limite && new Date() >= new Date(limite)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: limite });
  }

  const validSet = new Set(((ciiusRes.data ?? []) as Array<{ codigo: string }>).map((c) => c.codigo));
  const invalid = ciiusToCheck.filter((c) => !validSet.has(c));
  if (invalid.length) return res.status(400).json({ error: 'INVALID_CIIU', invalid });

  // === Actualizar miembros (solo si el cliente envio cambios) ===============
  // El frontend del Anteproyecto solo manda participante_id + posicion, no
  // perfil ni emociones ni preocupaciones (eso ya quedo guardado en /mi-perfil).
  // Saltamos todo el loop si no hay nada para escribir — antes era 2 round-
  // trips por miembro de puro desperdicio.
  const miembrosConCambios = parsed.data.miembros.filter((m) =>
    m.fue_emprendedor !== undefined ||
    m.perfil !== undefined ||
    m.emociones !== undefined ||
    m.preocupaciones !== undefined,
  );
  if (miembrosConCambios.length > 0) {
    await Promise.all(miembrosConCambios.map(async (m) => {
      const updateRow: Record<string, unknown> = {};
      if (m.fue_emprendedor !== undefined) {
        updateRow.fue_emprendedor = m.fue_emprendedor;
        updateRow.quiebra = m.fue_emprendedor ? (m.quiebra ?? null) : null;
        updateRow.aprendizajes_quiebra = m.fue_emprendedor ? (m.aprendizajes_quiebra ?? null) : null;
      }
      if (m.perfil !== undefined) updateRow.perfil = m.perfil;
      if (Object.keys(updateRow).length) {
        await supabaseAdmin.from('miembros_equipo').update(updateRow)
          .eq('equipo_id', ant.equipo_id).eq('participante_id', m.participante_id);
      }
      if (m.emociones === undefined && m.preocupaciones === undefined) return;
      const { data: row } = await supabaseAdmin
        .from('miembros_equipo').select('id').eq('equipo_id', ant.equipo_id).eq('participante_id', m.participante_id).maybeSingle();
      if (!row) return;
      if (m.emociones) {
        await supabaseAdmin.from('miembro_emociones').delete().eq('miembro_id', row.id);
        if (m.emociones.length) {
          await supabaseAdmin.from('miembro_emociones').insert(m.emociones.map((emocion) => ({ miembro_id: row.id, emocion })));
        }
      }
      if (m.preocupaciones) {
        await supabaseAdmin.from('miembro_preocupaciones').delete().eq('miembro_id', row.id);
        if (m.preocupaciones.length) {
          await supabaseAdmin.from('miembro_preocupaciones').insert(m.preocupaciones.map((preocupacion) => ({ miembro_id: row.id, preocupacion })));
        }
      }
    }));
  }

  // === Persistir flags de sabana y cargar existingProyectos en PARALELO ====
  const equipoUpdate: Record<string, unknown> = {};
  if (parsed.data.buscando_socios !== undefined) equipoUpdate.buscando_socios = parsed.data.buscando_socios;
  if (parsed.data.buscando_asociacion_otro_proyecto !== undefined) equipoUpdate.buscando_asociacion_otro_proyecto = parsed.data.buscando_asociacion_otro_proyecto;
  const [flagsRes, existingRes] = await Promise.all([
    Object.keys(equipoUpdate).length
      ? supabaseAdmin.from('equipos').update(equipoUpdate).eq('id', ant.equipo_id)
      : Promise.resolve({ error: null }),
    supabaseAdmin.from('proyectos').select('id, estado_seleccion').eq('anteproyecto_id', req.params.id),
  ]);
  if (flagsRes.error) return res.status(500).json({ error: flagsRes.error.message, paso: 'update equipos' });

  const existingProyectos = existingRes.data ?? [];
  const eliminables = existingProyectos.filter((p) => p.estado_seleccion === 'pendiente_seleccion');

  // === Reemplazar proyectos en BATCH =======================================
  // Antes: 1 DELETE + N inserts proyecto + N inserts hitos = ~3-5 round-trips.
  // Ahora: 1 DELETE + 1 BATCH INSERT proyectos + 1 BATCH INSERT hitos = 3.
  if (eliminables.length) {
    const { error } = await supabaseAdmin.from('proyectos').delete().in('id', eliminables.map((p) => p.id));
    if (error) return res.status(500).json({ error: error.message, paso: 'delete proyectos' });
  }

  if (parsed.data.proyectos.length > 0) {
    const proyectosToInsert = parsed.data.proyectos.map((p) => {
      const { hitos: _hitos, ...proyectoData } = p;
      return { ...proyectoData, anteproyecto_id: req.params.id };
    });
    const { data: newProjs, error: errProj } = await supabaseAdmin
      .from('proyectos')
      .insert(proyectosToInsert)
      .select('id, posicion');
    if (errProj) return res.status(500).json({ error: errProj.message, paso: 'insert proyectos' });

    const allHitos: Array<{ proyecto_id: string; posicion: number; descripcion: string; fecha_inicio: string; fecha_fin: string }> = [];
    for (const p of parsed.data.proyectos) {
      const newProj = (newProjs ?? []).find((np) => np.posicion === p.posicion);
      if (!newProj) continue;
      for (const h of p.hitos) {
        allHitos.push({ ...h, proyecto_id: newProj.id });
      }
    }
    if (allHitos.length > 0) {
      const { error: errHito } = await supabaseAdmin.from('hitos').insert(allHitos);
      if (errHito) return res.status(500).json({ error: errHito.message, paso: 'insert hitos' });
    }
  }

  // === Marcar fecha de ultima edicion (fire-and-forget) ====================
  // No bloqueamos la respuesta al cliente — el UPDATE de fecha es info
  // metadata, no afecta lo que el participante ve al recargar.
  void supabaseAdmin
    .from('anteproyectos')
    .update({ ultimo_editor_id: pid, fecha_actualizacion: new Date().toISOString() })
    .eq('id', req.params.id);

  res.json({ ok: true });
});

// === POST /api/anteproyectos/:id/enviar =====================================
router.post('/:id/enviar', async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  const { data: ant } = await supabaseAdmin
    .from('anteproyectos')
    .select(`
      id, equipo_id, estado,
      archivo_anteproyecto_path, archivo_proyecto_final_path,
      equipos:equipos!inner ( tipo_trabajo_grado, cohorte_id )
    `)
    .eq('id', req.params.id)
    .maybeSingle();
  if (!ant) return res.status(404).json({ error: 'NOT_FOUND' });
  if (ant.estado !== 'borrador') return res.status(409).json({ error: 'ALREADY_SUBMITTED', estado: ant.estado });

  // Soy miembro?
  const { data: yo } = await supabaseAdmin
    .from('miembros_equipo').select('id').eq('equipo_id', ant.equipo_id).eq('participante_id', pid).maybeSingle();
  if (!yo) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  const modalidad = (ant.equipos as any)?.tipo_trabajo_grado;

  // === Modalidades 'caso' / 'proyecto_investigacion': solo se exigen los 2 archivos
  if (modalidad === 'caso' || modalidad === 'proyecto_investigacion') {
    const faltantes: string[] = [];
    if (!ant.archivo_anteproyecto_path) faltantes.push('anteproyecto');
    if (!ant.archivo_proyecto_final_path) faltantes.push('proyecto_final');
    if (faltantes.length) return res.status(400).json({ error: 'ARCHIVOS_FALTANTES', faltantes });

    const fechaEnvio = new Date().toISOString();
    await supabaseAdmin.from('anteproyectos').update({
      estado: 'enviado',
      fecha_envio: fechaEnvio,
      ultimo_editor_id: pid,
    }).eq('id', req.params.id);

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

  // === Modalidad 'business_plan' (NAVES): validar proyectos + hitos + auto-definitivo
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
    await supabaseAdmin.from('proyectos').update({ estado_seleccion: 'definitivo' }).eq('id', proyectos[0].id);
    await supabaseAdmin.from('equipos').update({ proyecto_definitivo_id: proyectos[0].id }).eq('id', ant.equipo_id);
  }

  const fechaEnvio = new Date().toISOString();
  await supabaseAdmin.from('anteproyectos').update({
    estado: 'enviado',
    fecha_envio: fechaEnvio,
    ultimo_editor_id: pid,
  }).eq('id', req.params.id);

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
