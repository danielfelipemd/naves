import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import { getSignedUrlTrabajoGrado } from '../services/storage.js';
import { sendEmail } from '../services/email.js';
import { decryptPII } from '../auth/crypto.js';

const router = Router();
router.use(requireAuth());

/**
 * Envia un correo de confirmacion de envio del anteproyecto a TODOS los miembros del equipo.
 * Falla silenciosamente: nunca bloquea la respuesta al cliente.
 */
async function notificarEnvioAnteproyecto(equipoId: string, fechaEnvio: string, modalidad: string | null) {
  try {
    const { data: equipo } = await supabaseAdmin
      .from('equipos')
      .select(`
        id, nombre_equipo, cohorte_id,
        miembros_equipo (
          participantes_lista ( nombre_completo, email_encriptado )
        )
      `)
      .eq('id', equipoId)
      .maybeSingle();
    if (!equipo) return;

    const fechaStr = new Date(fechaEnvio).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const modalidadLabel = modalidad === 'caso' ? 'Caso'
      : modalidad === 'proyecto_investigacion' ? 'Proyecto de investigación'
      : 'Business Plan';
    const equipoNombre = (equipo as any).nombre_equipo || '(sin nombre)';
    const cohorte = (equipo as any).cohorte_id ?? '';

    const miembros = (((equipo as any).miembros_equipo ?? []) as any[])
      .map((m) => m.participantes_lista)
      .filter(Boolean);

    for (const m of miembros) {
      let email = '';
      try { email = decryptPII(m.email_encriptado); } catch { continue; }
      if (!email) continue;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="border-bottom: 3px solid #e30613; padding-bottom: 12px; margin-bottom: 18px;">
            <p style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 11px; margin: 0;">Confirmación de envío</p>
            <h2 style="color: #1a1a1a; margin: 4px 0 0 0;">Tu anteproyecto fue enviado</h2>
          </div>
          <p>Hola <strong>${m.nombre_completo}</strong>,</p>
          <p>Te confirmamos que el anteproyecto de tu equipo fue enviado correctamente al programa MBA INALDE.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
            <tr><td style="padding: 6px 0; color:#888;">Equipo</td><td style="padding: 6px 0;"><strong>${equipoNombre}</strong></td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Cohorte</td><td style="padding: 6px 0;">${cohorte}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Modalidad</td><td style="padding: 6px 0;">${modalidadLabel}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Fecha y hora de envío</td><td style="padding: 6px 0;"><strong>${fechaStr}</strong></td></tr>
          </table>
          <p style="font-size: 13px; color:#555;">A partir de ahora el anteproyecto queda bloqueado para edición. Si necesitas algún ajuste, contacta a la asistente del programa.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;"/>
          <p style="font-size: 11px; color: #888;">
            NAVES — INALDE Business School · MBA<br/>
            Este es un mensaje automático, no responder.
          </p>
        </div>`;
      try {
        await sendEmail(email, 'Anteproyecto enviado — NAVES INALDE', html);
      } catch { /* best effort */ }
    }
  } catch (e) {
    console.warn('[anteproyectos.enviar] notificacion email fallo:', (e as Error).message);
  }
}

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

    const fechaEnvio = new Date().toISOString();
    await supabaseAdmin.from('anteproyectos').update({
      estado: 'enviado',
      fecha_envio: fechaEnvio,
      ultimo_editor_id: pid,
    }).eq('id', req.params.id);

    void notificarEnvioAnteproyecto(ant.equipo_id, fechaEnvio, modalidad);
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

  void notificarEnvioAnteproyecto(ant.equipo_id, fechaEnvio, 'business_plan');
  res.json({
    ok: true,
    modalidad: 'business_plan',
    proyectos_count: proyectos.length,
    auto_definitivo: proyectos.length === 1,
    fecha_envio: fechaEnvio,
  });
});

export default router;
