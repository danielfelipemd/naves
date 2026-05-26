import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import { getSignedUrlTrabajoGrado } from '../services/storage.js';

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
      equipos:equipos!inner ( id, tipo_trabajo_grado ),
      proyectos (
        *,
        hitos ( id, posicion, descripcion, fecha_inicio, fecha_fin )
      )
    `)
    .eq('equipo_id', miembro.equipo_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.json({ anteproyecto: null });

  // Adjuntar URLs firmadas (5 min) si hay archivos
  const ant: any = data;
  if (ant.archivo_anteproyecto_path) {
    try { ant.archivo_anteproyecto_url = await getSignedUrlTrabajoGrado(ant.archivo_anteproyecto_path, 300); } catch { /* ignore */ }
  }
  if (ant.archivo_proyecto_final_path) {
    try { ant.archivo_proyecto_final_url = await getSignedUrlTrabajoGrado(ant.archivo_proyecto_final_path, 300); } catch { /* ignore */ }
  }

  res.json({ anteproyecto: ant });
});

// === Validaciones del payload ===============================================
const miembroSchema = z.object({
  participante_id: z.string().uuid(),
  posicion: z.number().int().min(1).max(3),
  celular: z.string().max(20).optional(),
  fue_emprendedor: z.boolean(),
  quiebra: z.enum(['nunca_despego', 'funcionamiento', 'vendido', 'quebro', 'na']).optional(),
  aprendizajes_quiebra: z.string().max(300).optional(),
  perfil: z.enum(['emprendedor', 'directivo', 'ambos']),
  emociones: z.array(z.enum(['crear', 'dinero', 'problema', 'autonomia'])).min(1),
  preocupaciones: z.array(z.enum(['financiera', 'estres', 'habilidades', 'familia'])).min(1),
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
  estado: z.enum(['idea', 'investigacion', 'prototipo', 'validacion']).optional(),
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

  // === Actualizar miembros (datos del perfil emprendedor) ===================
  for (const m of parsed.data.miembros) {
    await supabaseAdmin.from('miembros_equipo').update({
      fue_emprendedor: m.fue_emprendedor,
      quiebra: m.fue_emprendedor ? m.quiebra : null,
      aprendizajes_quiebra: m.fue_emprendedor ? m.aprendizajes_quiebra : null,
      perfil: m.perfil,
    }).eq('equipo_id', ant.equipo_id).eq('participante_id', m.participante_id);

    const { data: row } = await supabaseAdmin
      .from('miembros_equipo').select('id').eq('equipo_id', ant.equipo_id).eq('participante_id', m.participante_id).maybeSingle();
    if (row) {
      await supabaseAdmin.from('miembro_emociones').delete().eq('miembro_id', row.id);
      await supabaseAdmin.from('miembro_preocupaciones').delete().eq('miembro_id', row.id);
      if (m.emociones.length) {
        await supabaseAdmin.from('miembro_emociones').insert(m.emociones.map((emocion) => ({ miembro_id: row.id, emocion })));
      }
      if (m.preocupaciones.length) {
        await supabaseAdmin.from('miembro_preocupaciones').insert(m.preocupaciones.map((preocupacion) => ({ miembro_id: row.id, preocupacion })));
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

    await supabaseAdmin.from('anteproyectos').update({
      estado: 'enviado',
      fecha_envio: new Date().toISOString(),
      ultimo_editor_id: pid,
    }).eq('id', req.params.id);

    return res.json({ ok: true, modalidad });
  }

  // === Modalidad 'business_plan' (NAVES): validar proyectos + auto-definitivo
  const { data: proyectos } = await supabaseAdmin
    .from('proyectos')
    .select('id, hitos:hitos(count)')
    .eq('anteproyecto_id', req.params.id);
  if (!proyectos || proyectos.length === 0) return res.status(400).json({ error: 'NO_PROYECTOS' });

  // Si solo hay 1 proyecto, marcarlo automáticamente como definitivo
  if (proyectos.length === 1) {
    await supabaseAdmin.from('proyectos').update({ estado_seleccion: 'definitivo' }).eq('id', proyectos[0].id);
    await supabaseAdmin.from('equipos').update({ proyecto_definitivo_id: proyectos[0].id }).eq('id', ant.equipo_id);
  }

  await supabaseAdmin.from('anteproyectos').update({
    estado: 'enviado',
    fecha_envio: new Date().toISOString(),
    ultimo_editor_id: pid,
  }).eq('id', req.params.id);

  res.json({ ok: true, modalidad: 'business_plan', proyectos_count: proyectos.length, auto_definitivo: proyectos.length === 1 });
});

export default router;
