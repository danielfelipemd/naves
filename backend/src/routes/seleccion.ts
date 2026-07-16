import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { decryptPII } from '../auth/crypto.js';
import { sendEmail } from '../services/email.js';

const router = Router();
router.use(requireAuth());

async function fetchEquipoConCohorte(equipoId: string) {
  const { data, error } = await supabaseAdmin
    .from('equipos')
    .select(`
      id, cohorte_id, creador_id, reunion_1_marcada_por, reunion_1_fecha_marcado, proyecto_definitivo_id,
      cohortes ( fecha_reunion_1, fecha_limite_seleccion_definitivo )
    `)
    .eq('id', equipoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// === POST /api/equipos/:id/marcar-reunion-1 ============================
router.post('/equipos/:id/marcar-reunion-1', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Verifica miembro
  const { data: yo } = await supabaseAdmin
    .from('miembros_equipo').select('id').eq('equipo_id', req.params.id).eq('participante_id', pid).maybeSingle();
  if (!yo) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  const equipo = await fetchEquipoConCohorte(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'TEAM_NOT_FOUND' });
  if (equipo.reunion_1_marcada_por) return res.status(409).json({ error: 'ALREADY_MARKED' });

  const fechas = equipo.cohortes as any;
  const ahora = new Date();
  if (fechas?.fecha_reunion_1 && ahora < new Date(fechas.fecha_reunion_1)) {
    return res.status(403).json({ error: 'TOO_EARLY', fecha_reunion_1: fechas.fecha_reunion_1 });
  }
  if (fechas?.fecha_limite_seleccion_definitivo && ahora > new Date(fechas.fecha_limite_seleccion_definitivo)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: fechas.fecha_limite_seleccion_definitivo });
  }

  // Solo aplica si tiene 2-3 proyectos
  const { data: ant } = await supabaseAdmin
    .from('anteproyectos').select('id').eq('equipo_id', req.params.id).maybeSingle();
  if (!ant) return res.status(409).json({ error: 'NO_ANTEPROYECTO' });
  const { count } = await supabaseAdmin
    .from('proyectos').select('*', { count: 'exact', head: true }).eq('anteproyecto_id', ant.id);
  if ((count ?? 0) < 2) return res.status(409).json({ error: 'ONLY_ONE_PROJECT', mensaje: 'No aplica: con 1 proyecto se marca definitivo automáticamente al enviar.' });

  await supabaseAdmin
    .from('equipos')
    .update({ reunion_1_marcada_por: pid, reunion_1_fecha_marcado: ahora.toISOString() })
    .eq('id', req.params.id);

  res.json({
    reunion_1_marcada: true,
    fecha_marcado: ahora.toISOString(),
    siguiente_paso: 'seleccionar_proyecto_definitivo',
    fecha_limite_seleccion: fechas?.fecha_limite_seleccion_definitivo ?? null,
  });
});

// === POST /api/equipos/:id/seleccionar-proyecto-definitivo =============
// Lo ejecuta el CREADOR del equipo (después de la Reunión 1). Tambien permitido
// para super_admin como red de seguridad.
const seleccionarSchema = z.object({ proyecto_id: z.string().uuid() });
router.post('/equipos/:id/seleccionar-proyecto-definitivo', async (req: AuthenticatedRequest, res) => {
  const parsed = seleccionarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });

  const isSuperAdmin = !!req.user!.isSuperAdmin;
  const pid = req.user!.participanteId;
  const role = req.user!.role;

  const equipo = await fetchEquipoConCohorte(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'TEAM_NOT_FOUND' });
  if (equipo.proyecto_definitivo_id) return res.status(409).json({ error: 'ALREADY_SELECTED', proyecto_definitivo_id: equipo.proyecto_definitivo_id });

  // Solo el creador del equipo (o super_admin) puede marcar el definitivo.
  if (!isSuperAdmin) {
    if (role !== 'participante') return res.status(403).json({ error: 'FORBIDDEN' });
    if (!pid || pid !== equipo.creador_id) {
      return res.status(403).json({
        error: 'SOLO_CREADOR_EQUIPO',
        mensaje: 'Solo quien creó el equipo puede marcar el proyecto definitivo.',
      });
    }
  }

  const fechas = equipo.cohortes as any;
  const ahoraD = new Date();
  // Reunión 1 marca el momento desde el que el creador puede elegir el definitivo.
  if (fechas?.fecha_reunion_1 && ahoraD < new Date(fechas.fecha_reunion_1)) {
    return res.status(403).json({
      error: 'TOO_EARLY',
      fecha_reunion_1: fechas.fecha_reunion_1,
      mensaje: 'Aún no puedes elegir el proyecto definitivo. Espera a que pase la Reunión 1.',
    });
  }
  if (fechas?.fecha_limite_seleccion_definitivo && ahoraD > new Date(fechas.fecha_limite_seleccion_definitivo)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA' });
  }

  // El anteproyecto debe haber sido enviado (no se puede elegir definitivo sobre un borrador)
  const { data: ant } = await supabaseAdmin
    .from('anteproyectos')
    .select('id, estado, proyectos(id)')
    .eq('equipo_id', req.params.id)
    .maybeSingle();
  if (!ant) return res.status(409).json({ error: 'NO_ANTEPROYECTO' });
  if (ant.estado === 'borrador') return res.status(409).json({ error: 'ANTEPROYECTO_NO_ENVIADO' });
  const ids = ((ant.proyectos as any[]) ?? []).map((p) => p.id);
  if (!ids.includes(parsed.data.proyecto_id)) return res.status(400).json({ error: 'PROJECT_NOT_IN_TEAM' });

  const ahora = new Date().toISOString();
  // El proyecto elegido pasa a definitivo, los demás a archivado. Son 3 escrituras
  // que deben cuadrar entre sí: si una falla en silencio el equipo queda
  // inconsistente (p.ej. definitivo marcado pero el equipo sin apuntarlo, o los
  // otros sin archivar). Verificamos las tres antes de responder ok.
  const rDef = await supabaseAdmin.from('proyectos').update({ estado_seleccion: 'definitivo' }).eq('id', parsed.data.proyecto_id);
  if (rDef.error) return res.status(500).json({ error: 'SELECCION_FALLIDA', paso: 'definitivo', detail: rDef.error.message });

  const rArch = await supabaseAdmin
    .from('proyectos')
    .update({ estado_seleccion: 'archivado', fecha_archivado: ahora })
    .eq('anteproyecto_id', ant.id)
    .neq('id', parsed.data.proyecto_id);
  if (rArch.error) return res.status(500).json({ error: 'SELECCION_FALLIDA', paso: 'archivar', detail: rArch.error.message });

  const rEq = await supabaseAdmin
    .from('equipos')
    .update({ proyecto_definitivo_id: parsed.data.proyecto_id, fecha_seleccion_definitivo: ahora })
    .eq('id', req.params.id);
  if (rEq.error) return res.status(500).json({ error: 'SELECCION_FALLIDA', paso: 'equipo', detail: rEq.error.message });

  res.json({ ok: true, proyecto_definitivo_id: parsed.data.proyecto_id, archivados_count: ids.length - 1 });
});

// === GET /api/profesor/mis-equipos-pendientes =============
// Lista los equipos asignados al profesor con anteproyecto enviado y proyecto definitivo
// aún sin elegir (es decir, equipos con >1 proyecto).
router.get('/profesor/mis-equipos-pendientes', requireRole('profesor', 'super_admin'), async (req: AuthenticatedRequest, res) => {
  const profesorId = req.user!.profesorId;
  if (!profesorId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });

  const { data: asignaciones, error } = await supabaseAdmin
    .from('asignaciones_profesor')
    .select(`
      equipo_id,
      equipos:equipos!inner (
        id, nombre_equipo, cohorte_id, proyecto_definitivo_id, fecha_seleccion_definitivo,
        miembros_equipo ( participantes_lista ( nombre_completo ) ),
        anteproyectos:anteproyectos!inner (
          id, estado,
          proyectos ( id, nombre, tipo, sector, ciiu, estado_seleccion, canvas_cliente, canvas_problema, canvas_solucion, canvas_ingresos, canvas_recursos, canvas_actividades, fuentes_primarias, fuentes_secundarias, estado )
        )
      )
    `)
    .eq('profesor_id', profesorId);
  if (error) return res.status(500).json({ error: error.message });

  const equipos = (asignaciones ?? []).map((a: any) => {
    const e = a.equipos;
    const ant = e.anteproyectos;
    const proyectos = (ant?.proyectos ?? []).filter((p: any) => p.estado_seleccion !== 'archivado');
    return {
      equipo_id: e.id,
      nombre_equipo: e.nombre_equipo,
      cohorte_id: e.cohorte_id,
      anteproyecto_estado: ant?.estado,
      proyecto_definitivo_id: e.proyecto_definitivo_id,
      fecha_seleccion_definitivo: e.fecha_seleccion_definitivo,
      miembros: (e.miembros_equipo ?? []).map((m: any) => m.participantes_lista?.nombre_completo).filter(Boolean),
      proyectos,
      requiere_seleccion: !e.proyecto_definitivo_id && ant?.estado === 'enviado' && proyectos.length > 1,
    };
  });

  res.json({ equipos });
});

// === POST /api/proyectos/:id/solicitar-desarchivar ====================
const desarchivarSchema = z.object({ motivo: z.string().min(20).max(2000) });
router.post('/proyectos/:id/solicitar-desarchivar', requireRole('participante'), async (req: AuthenticatedRequest, res) => {
  const parsed = desarchivarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });

  // Verificar que el proyecto está archivado y pertenece al equipo del usuario
  const { data: proy } = await supabaseAdmin
    .from('proyectos')
    .select('id, estado_seleccion, anteproyecto_id, anteproyectos(equipo_id)')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!proy) return res.status(404).json({ error: 'NOT_FOUND' });
  if (proy.estado_seleccion !== 'archivado') return res.status(409).json({ error: 'NOT_ARCHIVED' });

  const equipoId = (proy.anteproyectos as any)?.equipo_id;
  const { data: yo } = await supabaseAdmin
    .from('miembros_equipo').select('id').eq('equipo_id', equipoId).eq('participante_id', pid).maybeSingle();
  if (!yo) return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });

  const { data, error } = await supabaseAdmin
    .from('solicitudes_desarchivado')
    .insert({ proyecto_id: req.params.id, solicitante_id: pid, motivo: parsed.data.motivo, estado: 'pendiente' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ solicitud_id: data.id, estado: 'pendiente' });
});

// === POST /api/admin/solicitudes-desarchivado/:id/aprobar (profesor) ====
const respuestaSchema = z.object({ respuesta: z.string().min(1).max(2000).optional() });

router.post('/admin/solicitudes-desarchivado/:id/aprobar', requireRole('profesor'), async (req: AuthenticatedRequest, res) => {
  const parsed = respuestaSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });

  const profId = req.user!.profesorId;
  if (!profId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });

  const { data: sol } = await supabaseAdmin
    .from('solicitudes_desarchivado').select('id, proyecto_id, estado').eq('id', req.params.id).maybeSingle();
  if (!sol) return res.status(404).json({ error: 'NOT_FOUND' });
  if (sol.estado !== 'pendiente') return res.status(409).json({ error: 'ALREADY_RESOLVED' });

  const ahora = new Date().toISOString();
  await supabaseAdmin.from('solicitudes_desarchivado').update({
    estado: 'aprobada', profesor_id: profId, respuesta_profesor: parsed.data.respuesta ?? null, fecha_respuesta: ahora,
  }).eq('id', req.params.id);

  await supabaseAdmin.from('proyectos').update({
    estado_seleccion: 'pendiente_seleccion',
    desarchivado: true, fecha_desarchivado: ahora, desarchivado_aprobado_por: profId,
  }).eq('id', sol.proyecto_id);

  res.json({ ok: true });
});

router.post('/admin/solicitudes-desarchivado/:id/rechazar', requireRole('profesor'), async (req: AuthenticatedRequest, res) => {
  const parsed = respuestaSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });

  const profId = req.user!.profesorId;
  if (!profId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });

  const { data: sol } = await supabaseAdmin
    .from('solicitudes_desarchivado').select('id, estado').eq('id', req.params.id).maybeSingle();
  if (!sol) return res.status(404).json({ error: 'NOT_FOUND' });
  if (sol.estado !== 'pendiente') return res.status(409).json({ error: 'ALREADY_RESOLVED' });

  await supabaseAdmin.from('solicitudes_desarchivado').update({
    estado: 'rechazada', profesor_id: profId, respuesta_profesor: parsed.data.respuesta ?? null, fecha_respuesta: new Date().toISOString(),
  }).eq('id', req.params.id);

  res.json({ ok: true });
});

// === POST /api/admin/notificar-seleccion-pendiente =============
// Recorre todos los profesores con equipos asignados que ya pasaron la fecha
// de Reunión 1 y tienen >1 proyecto sin proyecto_definitivo_id. Envía un email
// al profesor con la lista de equipos que necesita resolver.
router.post('/admin/notificar-seleccion-pendiente', requireRole('super_admin'), async (req: AuthenticatedRequest, res) => {
  const cohorteId = (req.body as any)?.cohorte_id as string | undefined;

  // Traer asignaciones (opcionalmente filtradas por cohorte)
  let q = supabaseAdmin
    .from('asignaciones_profesor')
    .select(`
      profesor_id, equipo_id,
      profesores:profesores!inner ( id, nombre_completo, email_encriptado ),
      equipos:equipos!inner (
        id, nombre_equipo, cohorte_id, proyecto_definitivo_id,
        cohortes:cohortes ( fecha_reunion_1, fecha_limite_seleccion_definitivo ),
        anteproyectos:anteproyectos!inner ( id, estado, proyectos ( id, estado_seleccion ) )
      )
    `);
  if (cohorteId) q = q.eq('cohorte_id', cohorteId);

  const { data: rows, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Agrupar por profesor: equipos pendientes
  const ahora = new Date();
  const porProfesor = new Map<string, { profesor: any; equipos: any[] }>();

  for (const a of rows ?? []) {
    const p: any = a.profesores;
    const e: any = a.equipos;
    const cohortes: any = e?.cohortes;
    const ant: any = e?.anteproyectos;
    const proyectos = (ant?.proyectos ?? []) as any[];

    const yaTieneDefinitivo = !!e?.proyecto_definitivo_id;
    const tieneVariosProyectos = proyectos.length > 1;
    const fechaR1 = cohortes?.fecha_reunion_1 ? new Date(cohortes.fecha_reunion_1) : null;
    const yaPasoR1 = !fechaR1 || ahora >= fechaR1;
    const enviado = ant?.estado === 'enviado';

    if (!yaTieneDefinitivo && tieneVariosProyectos && enviado && yaPasoR1) {
      const key = p.id;
      if (!porProfesor.has(key)) porProfesor.set(key, { profesor: p, equipos: [] });
      porProfesor.get(key)!.equipos.push({
        equipo_id: e.id,
        nombre_equipo: e.nombre_equipo,
        cohorte_id: e.cohorte_id,
        cantidad_proyectos: proyectos.length,
      });
    }
  }

  let emailsEnviados = 0;
  let emailsFallados = 0;
  const fallos: Array<{ profesor: string; razon: string }> = [];

  for (const { profesor, equipos } of porProfesor.values()) {
    if (!profesor.email_encriptado) { emailsFallados++; fallos.push({ profesor: profesor.nombre_completo, razon: 'NO_EMAIL' }); continue; }
    let realEmail: string;
    try { realEmail = decryptPII(profesor.email_encriptado); }
    catch { emailsFallados++; fallos.push({ profesor: profesor.nombre_completo, razon: 'PII_DECRYPT_FAILED' }); continue; }

    const filas = equipos
      .map((eq) => `<li><strong>${eq.nombre_equipo || '(sin nombre)'}</strong> · cohorte ${eq.cohorte_id} · ${eq.cantidad_proyectos} proyectos</li>`)
      .join('');
    const html = `
      <div style="font-family:Roboto,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
        <h2 style="color:#e30613;border-bottom:3px solid #e30613;padding-bottom:8pt;margin-bottom:14pt">
          Tienes equipos pendientes de selección de proyecto definitivo
        </h2>
        <p>Hola <strong>${profesor.nombre_completo}</strong>,</p>
        <p>Después de la Reunión 1, te corresponde marcar el proyecto definitivo
           para los siguientes equipos asignados que presentaron <strong>más de un proyecto</strong>:</p>
        <ul>${filas}</ul>
        <p style="margin-top:18pt">Entra a la plataforma para resolverlo:</p>
        <p><a href="${process.env.FRONTEND_URL ?? 'https://naves-frontend.huem98.easypanel.host'}/profesor/seleccionar-proyectos"
              style="display:inline-block;background:#e30613;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">
           Elegir proyecto definitivo →
        </a></p>
        <p style="font-size:9pt;color:#6b6b6b;margin-top:24pt">
          NAVES — INALDE Business School · MBA<br>
          Mensaje automático; no respondas a este correo.
        </p>
      </div>`;

    const r = await sendEmail(realEmail, 'Pendiente: elegir proyecto definitivo de tus equipos', html);
    if (r.ok) emailsEnviados++;
    else { emailsFallados++; fallos.push({ profesor: profesor.nombre_completo, razon: r.reason ?? 'UNKNOWN' }); }
  }

  res.json({
    profesores_notificados: emailsEnviados,
    profesores_fallados: emailsFallados,
    fallos: fallos.slice(0, 20),
    sin_pendientes: porProfesor.size === 0,
  });
});

export default router;
