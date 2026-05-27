import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import { crearUrlProxyArchivo } from '../services/storage.js';
import { notificarRegistroAnteproyectoAParticipantes } from '../services/notificaciones-anteproyecto.js';

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

const proyectoSchema = z.object({
  posicion: z.number().int().min(1).max(2),
  nombre: z.string().min(1).max(150),
  tipo: z.enum(['emprendimiento', 'intraemprendimiento']),
  sector: z.string().max(100).optional(),
  ciiu: z.string().regex(/^\d{4}$/).optional(),
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
  estado: z.enum(['idea', 'investigacion', 'prototipo', 'validacion', 'funcionamiento']).optional(),
  fuentes_primarias: z.string().max(300).optional(),
  fuentes_secundarias: z.string().max(300).optional(),
  hitos: z.array(hitoSchema).max(10),
});

const updateSchema = z.object({
  numero_miembros: z.number().int().min(1).max(3),
  numero_proyectos: z.number().int().min(1).max(2),
  miembros: z.array(miembroSchema),
  proyectos: z.array(proyectoSchema).min(1).max(2),
}).refine((d) => d.miembros.length === d.numero_miembros, {
  message: 'numero_miembros debe coincidir con miembros.length',
}).refine((d) => d.proyectos.length === d.numero_proyectos, {
  message: 'numero_proyectos debe coincidir con proyectos.length',
});

// === PUT /api/anteproyectos/:id (guardar borrador) ==========================
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Verificar que el usuario es miembro del equipo dueño
  const { data: ant } = await supabaseAdmin
    .from('anteproyectos')
    .select('id, equipo_id, estado')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!ant) return res.status(404).json({ error: 'NOT_FOUND' });

  const { data: yoMiembro } = await supabaseAdmin
    .from('miembros_equipo')
    .select('equipo_id')
    .eq('equipo_id', ant.equipo_id)
    .eq('participante_id', pid)
    .maybeSingle();
  if (!yoMiembro) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  // Verificar plazo
  const { data: cohorte } = await supabaseAdmin
    .from('equipos').select('cohortes(fecha_limite_entrega_anteproyecto)').eq('id', ant.equipo_id).maybeSingle();
  const limite = (cohorte?.cohortes as any)?.fecha_limite_entrega_anteproyecto;
  if (limite && new Date() >= new Date(limite)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: limite });
  }

  // Verificar CIIUs válidos
  const ciiusToCheck = parsed.data.proyectos.map((p) => p.ciiu).filter(Boolean) as string[];
  if (ciiusToCheck.length) {
    const { data: validCiius } = await supabaseAdmin
      .from('codigos_ciiu').select('codigo').in('codigo', ciiusToCheck);
    const validSet = new Set((validCiius ?? []).map((c) => c.codigo));
    const invalid = ciiusToCheck.filter((c) => !validSet.has(c));
    if (invalid.length) return res.status(400).json({ error: 'INVALID_CIIU', invalid });
  }

  // === Actualizar miembros (perfil emprendedor) =============================
  // El perfil ya viene cargado en miembros_equipo desde /mi-perfil. Solo
  // sobreescribimos campos que el cliente envia explicitamente; los que no
  // llegan se respetan tal cual estan en BD.
  for (const m of parsed.data.miembros) {
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

    const { data: row } = await supabaseAdmin
      .from('miembros_equipo').select('id').eq('equipo_id', ant.equipo_id).eq('participante_id', m.participante_id).maybeSingle();
    if (row) {
      // Solo reescribir emociones/preocupaciones si el cliente las envio.
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
    }
  }

  // === Reemplazar proyectos + hitos =========================================
  // Borrar proyectos existentes que estén en estado borrador (no podemos tocar 'definitivo' o 'archivado')
  const { data: existingProyectos } = await supabaseAdmin
    .from('proyectos')
    .select('id, estado_seleccion')
    .eq('anteproyecto_id', req.params.id);
  const eliminables = (existingProyectos ?? []).filter((p) => p.estado_seleccion === 'pendiente_seleccion');
  if (eliminables.length) {
    await supabaseAdmin.from('proyectos').delete().in('id', eliminables.map((p) => p.id));
  }

  // Insertar proyectos nuevos (con hitos)
  for (const p of parsed.data.proyectos) {
    const { hitos, ...proyectoData } = p;
    const { data: newProj, error } = await supabaseAdmin
      .from('proyectos')
      .insert({ ...proyectoData, anteproyecto_id: req.params.id })
      .select().single();
    if (error) return res.status(500).json({ error: error.message, paso: 'insert proyecto' });
    if (hitos.length) {
      const hitosWithProj = hitos.map((h) => ({ ...h, proyecto_id: newProj.id }));
      const { error: e2 } = await supabaseAdmin.from('hitos').insert(hitosWithProj);
      if (e2) return res.status(500).json({ error: e2.message, paso: 'insert hitos' });
    }
  }

  await supabaseAdmin
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
      equipos:equipos!inner ( tipo_trabajo_grado )
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
    return res.json({ ok: true, modalidad, fecha_envio: fechaEnvio });
  }

  // === Modalidad 'business_plan' (NAVES): validar proyectos + hitos + auto-definitivo
  const { data: proyectos } = await supabaseAdmin
    .from('proyectos')
    .select('id, nombre, hitos ( descripcion, fecha_inicio, fecha_fin )')
    .eq('anteproyecto_id', req.params.id);
  if (!proyectos || proyectos.length === 0) return res.status(400).json({ error: 'NO_PROYECTOS' });

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

  void notificarRegistroAnteproyectoAParticipantes({
    equipoId: ant.equipo_id,
    modalidad: 'business_plan',
    fechaIso: fechaEnvio,
  });
  res.json({
    ok: true,
    modalidad: 'business_plan',
    proyectos_count: proyectos.length,
    auto_definitivo: proyectos.length === 1,
    fecha_envio: fechaEnvio,
  });
});

export default router;
