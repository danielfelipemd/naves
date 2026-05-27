import { Router } from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import {
  uploadTrabajoGradoFile,
  crearUrlProxyArchivo,
  downloadTrabajoGradoFile,
  extForMime,
  type TipoArchivoTrabajo,
} from '../services/storage.js';
import { sendEmail, type EmailAttachment } from '../services/email.js';
import { decryptPII } from '../auth/crypto.js';

const EMAIL_COMITE_MBA = 'susana.jaime@inalde.edu.co';

const router = Router();
router.use(requireAuth());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const MIME_ANTEPROYECTO = new Set(['application/pdf']);
const MIME_PROYECTO_FINAL = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const COL_PATH: Record<TipoArchivoTrabajo, string> = {
  'anteproyecto': 'archivo_anteproyecto_path',
  'proyecto-final': 'archivo_proyecto_final_path',
};
const COL_MIME: Record<TipoArchivoTrabajo, string> = {
  'anteproyecto': 'archivo_anteproyecto_mime',
  'proyecto-final': 'archivo_proyecto_final_mime',
};
const COL_SIZE: Record<TipoArchivoTrabajo, string> = {
  'anteproyecto': 'archivo_anteproyecto_size_bytes',
  'proyecto-final': 'archivo_proyecto_final_size_bytes',
};
const COL_UPLOADED: Record<TipoArchivoTrabajo, string> = {
  'anteproyecto': 'archivo_anteproyecto_uploaded_at',
  'proyecto-final': 'archivo_proyecto_final_uploaded_at',
};

function isTipoArchivo(v: string): v is TipoArchivoTrabajo {
  return v === 'anteproyecto' || v === 'proyecto-final';
}

async function loadAnteproyectoConEquipo(id: string) {
  const { data: ant } = await supabaseAdmin
    .from('anteproyectos')
    .select(`
      id, equipo_id, estado,
      archivo_anteproyecto_path, archivo_proyecto_final_path,
      anteproyecto_aprobado_at,
      equipos:equipos!inner ( id, cohorte_id, tipo_trabajo_grado, nombre_equipo, director_id,
        cohortes:cohortes ( fecha_limite_entrega_anteproyecto )
      )
    `)
    .eq('id', id)
    .maybeSingle();
  return ant as any;
}

interface NotificacionAnteproyectoCtx {
  equipoId: string;
  modalidad: 'caso' | 'proyecto_investigacion';
  directorId: string;
  archivoPath: string;
  archivoMime: string;
  fechaSubida: string;
  participanteId: string;
}

/**
 * Envia los emails tras subir el anteproyecto en modalidad Caso/PI:
 *  1. Al DIRECTOR seleccionado (con PDF adjunto)
 *  2. Al COMITE del MBA (susana.jaime@inalde.edu.co, con PDF adjunto)
 *  3. A TODOS los miembros del equipo (confirmacion, sin adjunto)
 * Falla silenciosamente: nunca bloquea la respuesta al upload.
 */
async function notificarSubidaAnteproyectoCasoPI(ctx: NotificacionAnteproyectoCtx): Promise<void> {
  try {
    const [{ data: dir }, { data: equipo }, { data: cargador }] = await Promise.all([
      supabaseAdmin.from('directores').select('nombre_completo, email_encriptado').eq('id', ctx.directorId).maybeSingle(),
      supabaseAdmin
        .from('equipos')
        .select(`
          nombre_equipo, cohorte_id,
          miembros_equipo (
            posicion,
            participantes_lista ( nombre_completo, email_encriptado )
          )
        `)
        .eq('id', ctx.equipoId)
        .maybeSingle(),
      supabaseAdmin.from('participantes_lista').select('nombre_completo').eq('id', ctx.participanteId).maybeSingle(),
    ]);
    if (!dir || !equipo) return;

    const directorEmail = (() => { try { return decryptPII(dir.email_encriptado); } catch { return ''; } })();
    const modalidadLabel = ctx.modalidad === 'caso' ? 'Caso' : 'Proyecto de Investigación';
    const equipoNombre = (equipo as any).nombre_equipo || '(sin nombre)';
    const cohorte = (equipo as any).cohorte_id ?? '';
    const cargadorNombre = cargador?.nombre_completo ?? '';
    const fechaStr = new Date(ctx.fechaSubida).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });

    // Miembros del equipo (orden por posicion)
    const miembros = (((equipo as any).miembros_equipo ?? []) as any[])
      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
      .map((m) => m.participantes_lista)
      .filter(Boolean);
    const miembrosNombres = miembros.map((m: any) => m.nombre_completo).join(', ');
    const miembrosListaHtml = `<ul style="margin: 6px 0 0 0; padding-left: 20px;">${miembros.map((m: any) => `<li>${m.nombre_completo}</li>`).join('')}</ul>`;

    // Descargar el PDF para adjuntar. Si falla, los correos al director y al
    // comite van SIN adjunto y el cuerpo lo dice explicitamente (no mentimos).
    let attachments: EmailAttachment[] | undefined;
    let tieneAdjunto = false;
    try {
      const buf = await downloadTrabajoGradoFile(ctx.archivoPath);
      const ext = extForMime(ctx.archivoMime) ?? 'pdf';
      attachments = [{
        filename: `anteproyecto-${equipoNombre.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`,
        content: buf,
        contentType: ctx.archivoMime,
      }];
      tieneAdjunto = true;
    } catch (e) {
      console.warn('[anteproyecto.subido] no se pudo adjuntar PDF:', (e as Error).message);
    }

    const lineaAdjuntoDirector = tieneAdjunto
      ? 'El documento se adjunta al presente correo para su revisión.'
      : 'No fue posible adjuntar el documento al presente correo. Por favor solicítelo directamente al participante o al grupo de participantes del equipo.';
    const lineaAdjuntoComite = tieneAdjunto
      ? 'Se adjunta el documento para los archivos del Comité.'
      : '<strong>No fue posible adjuntar el documento</strong> al presente correo (falla técnica al recuperarlo del almacenamiento). El archivo sigue disponible en la plataforma, en el detalle del anteproyecto correspondiente.';
    const lineaAdjuntoParticipante = tieneAdjunto
      ? `El director(a), <strong>${dir.nombre_completo}</strong>, ya fue notificado(a) por correo electrónico y recibió el documento como archivo adjunto.`
      : `Se notificó al director(a), <strong>${dir.nombre_completo}</strong>, sobre la carga; sin embargo, por una falla técnica no fue posible adjuntar el documento al correo. Te pedimos hacerle llegar el documento directamente por correo para que pueda revisarlo.`;

    const baseFooter = `
      <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0 16px;"/>
      <p style="font-size: 11px; color: #888; line-height: 1.5; margin: 0;">
        <strong>INALDE Business School</strong> — Programa MBA<br/>
        Sistema de trabajos de grado. Este es un mensaje automático, por favor no responda a este correo.
      </p>`;

    // === 1) Email al DIRECTOR (con PDF) =====================================
    if (directorEmail) {
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #1a1a1a;">
          <div style="border-bottom: 3px solid #e30613; padding-bottom: 14px; margin-bottom: 22px;">
            <p style="color:#888; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; margin: 0;">Notificación a dirección — Programa MBA</p>
            <h2 style="color:#1a1a1a; margin: 6px 0 0 0; font-size: 22px;">Anteproyecto recibido para revisión</h2>
          </div>
          <p><strong>${dir.nombre_completo}</strong>:</p>
          <p>Reciba un cordial saludo. Le informamos que el equipo relacionado a continuación
          registró su nombre como responsable de la dirección de su trabajo de grado y cargó el
          anteproyecto en el sistema. ${lineaAdjuntoDirector}</p>
          <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
            <tr><td style="padding: 6px 0; color:#888; width: 40%; vertical-align: top;">Equipo</td><td style="padding: 6px 0;"><strong>${equipoNombre}</strong></td></tr>
            <tr><td style="padding: 6px 0; color:#888; vertical-align: top;">Miembros</td><td style="padding: 6px 0;">${miembrosListaHtml}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Modalidad</td><td style="padding: 6px 0;">${modalidadLabel}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Cohorte</td><td style="padding: 6px 0;">${cohorte}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Fecha de carga</td><td style="padding: 6px 0;"><strong>${fechaStr}</strong></td></tr>
          </table>
          <p style="margin-top: 18px;">Cordialmente,</p>
          <p style="margin: 4px 0;"><strong>Programa MBA</strong><br/>INALDE Business School</p>
          ${baseFooter}
        </div>`;
      try { await sendEmail(directorEmail, `Anteproyecto recibido — ${equipoNombre}`, html, attachments); }
      catch { /* best effort */ }
    }

    // === 2) Email al COMITE MBA (con PDF) ===================================
    // Va dirigido al Comité — la mención aquí es necesaria porque ES el
    // destinatario; en el resto de comunicaciones no se referencia.
    {
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #1a1a1a;">
          <div style="border-bottom: 3px solid #e30613; padding-bottom: 14px; margin-bottom: 22px;">
            <p style="color:#888; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; margin: 0;">Notificación interna — Programa MBA</p>
            <h2 style="color:#1a1a1a; margin: 6px 0 0 0; font-size: 22px;">Nuevo anteproyecto cargado al sistema</h2>
          </div>
          <p>Reciba un cordial saludo. Le informamos que se cargó un nuevo anteproyecto en el
          sistema de trabajos de grado del MBA. A continuación se relacionan los detalles.
          ${lineaAdjuntoComite}</p>
          <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
            <tr><td style="padding: 6px 0; color:#888; width: 40%; vertical-align: top;">Equipo</td><td style="padding: 6px 0;"><strong>${equipoNombre}</strong></td></tr>
            <tr><td style="padding: 6px 0; color:#888; vertical-align: top;">Miembros</td><td style="padding: 6px 0;">${miembrosListaHtml}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Modalidad</td><td style="padding: 6px 0;">${modalidadLabel}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Cohorte</td><td style="padding: 6px 0;">${cohorte}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Dirección asignada</td><td style="padding: 6px 0;">${dir.nombre_completo}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Cargado por</td><td style="padding: 6px 0;">${cargadorNombre}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Fecha de carga</td><td style="padding: 6px 0;"><strong>${fechaStr}</strong></td></tr>
          </table>
          <p style="margin-top: 18px;">Atentamente,</p>
          <p style="margin: 4px 0;"><strong>Programa MBA</strong><br/>INALDE Business School</p>
          ${baseFooter}
        </div>`;
      try { await sendEmail(EMAIL_COMITE_MBA, `Nuevo anteproyecto cargado — ${equipoNombre} (${modalidadLabel})`, html, attachments); }
      catch { /* best effort */ }
    }

    // === 3) Email a TODOS los miembros del equipo (confirmación, sin adjunto)
    for (const m of miembros) {
      let email = '';
      try { email = decryptPII(m.email_encriptado); } catch { continue; }
      if (!email) continue;

      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #1a1a1a;">
          <div style="border-bottom: 3px solid #e30613; padding-bottom: 14px; margin-bottom: 22px;">
            <p style="color:#888; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; margin: 0;">Confirmación de carga — Programa MBA</p>
            <h2 style="color:#1a1a1a; margin: 6px 0 0 0; font-size: 22px;">El anteproyecto de su equipo fue cargado</h2>
          </div>
          <p><strong>${m.nombre_completo}</strong>:</p>
          <p>Reciba un cordial saludo. Le confirmamos que el anteproyecto del equipo
          <strong>${equipoNombre}</strong> fue cargado en el sistema de trabajos de grado del
          MBA${cargadorNombre && cargadorNombre !== m.nombre_completo ? ` por ${cargadorNombre}` : ''}.
          ${lineaAdjuntoParticipante}</p>
          <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
            <tr><td style="padding: 6px 0; color:#888; width: 40%;">Equipo</td><td style="padding: 6px 0;"><strong>${equipoNombre}</strong></td></tr>
            <tr><td style="padding: 6px 0; color:#888; vertical-align: top;">Miembros</td><td style="padding: 6px 0;">${miembrosNombres}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Modalidad</td><td style="padding: 6px 0;">${modalidadLabel}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Cohorte</td><td style="padding: 6px 0;">${cohorte}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Dirección asignada</td><td style="padding: 6px 0;">${dir.nombre_completo}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Fecha de carga</td><td style="padding: 6px 0;"><strong>${fechaStr}</strong></td></tr>
          </table>
          <p style="font-size: 13px; color:#555;">
            El anteproyecto queda registrado de manera definitiva y no podrá ser reemplazado. Una
            vez la dirección revise el documento y se cumpla la fecha establecida en el cronograma,
            podrán cargar el proyecto final desde la plataforma.
          </p>
          <p style="margin-top: 18px;">Cordialmente,</p>
          <p style="margin: 4px 0;"><strong>Programa MBA</strong><br/>INALDE Business School</p>
          ${baseFooter}
        </div>`;
      try { await sendEmail(email, 'Confirmación de carga del anteproyecto — MBA INALDE', html); }
      catch { /* best effort */ }
    }
  } catch (e) {
    console.warn('[anteproyecto.subido] notificaciones fallaron:', (e as Error).message);
  }
}

async function isMiembroDelEquipo(pid: string, equipoId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('miembros_equipo')
    .select('equipo_id')
    .eq('equipo_id', equipoId)
    .eq('participante_id', pid)
    .maybeSingle();
  return !!data;
}

// === POST /api/anteproyectos/:id/archivo/:tipo ==============================
router.post('/:id/archivo/:tipo', upload.single('file'), async (req: AuthenticatedRequest, res) => {
  const pid = req.user!.participanteId;
  if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });
  if (!req.file) return res.status(400).json({ error: 'NO_FILE' });

  const tipo = req.params.tipo;
  if (!isTipoArchivo(tipo)) return res.status(400).json({ error: 'TIPO_INVALIDO' });

  const ant = await loadAnteproyectoConEquipo(req.params.id);
  if (!ant) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!(await isMiembroDelEquipo(pid, ant.equipo_id))) {
    return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });
  }
  if (ant.estado !== 'borrador') {
    return res.status(409).json({ error: 'ALREADY_SUBMITTED', estado: ant.estado });
  }

  const modalidad = ant.equipos?.tipo_trabajo_grado;
  if (!(modalidad === 'caso' || modalidad === 'proyecto_investigacion')) {
    return res.status(400).json({ error: 'MODALIDAD_NO_USA_ARCHIVOS', modalidad });
  }

  const directorId = ant.equipos?.director_id as string | null;
  const aprobadoAt = ant.anteproyecto_aprobado_at as string | null;
  const yaSubido = ant[COL_PATH[tipo]] as string | null;

  // Reglas por tipo
  if (tipo === 'anteproyecto') {
    if (!directorId) {
      return res.status(400).json({
        error: 'DIRECTOR_NO_SELECCIONADO',
        mensaje: 'Selecciona tu director antes de cargar el anteproyecto.',
      });
    }
    if (yaSubido) {
      return res.status(409).json({
        error: 'ANTEPROYECTO_YA_SUBIDO',
        mensaje: 'El anteproyecto ya fue cargado y no se puede reemplazar.',
      });
    }
  } else {
    // proyecto-final: solo permitido si el anteproyecto fue aprobado
    if (!aprobadoAt) {
      return res.status(403).json({
        error: 'ESPERA_APROBACION_ANTEPROYECTO',
        mensaje: 'Solo puedes cargar el proyecto final cuando tu anteproyecto haya sido aprobado.',
      });
    }
    if (yaSubido) {
      return res.status(409).json({
        error: 'PROYECTO_FINAL_YA_SUBIDO',
        mensaje: 'El proyecto final ya fue cargado y no se puede reemplazar.',
      });
    }
  }

  const mime = req.file.mimetype;
  const setPermitido = tipo === 'anteproyecto' ? MIME_ANTEPROYECTO : MIME_PROYECTO_FINAL;
  if (!setPermitido.has(mime)) return res.status(400).json({ error: 'INVALID_MIME', mime });

  const limite = ant.equipos?.cohortes?.fecha_limite_entrega_anteproyecto;
  if (limite && new Date() >= new Date(limite)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: limite });
  }

  let path: string;
  let size: number;
  try {
    const result = await uploadTrabajoGradoFile(ant.equipo_id, tipo, req.file.buffer, mime);
    path = result.path;
    size = result.size;
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'UPLOAD_FAILED' });
  }

  const fechaSubida = new Date().toISOString();
  const update: Record<string, unknown> = {
    [COL_PATH[tipo]]: path,
    [COL_MIME[tipo]]: mime,
    [COL_SIZE[tipo]]: size,
    [COL_UPLOADED[tipo]]: fechaSubida,
    ultimo_editor_id: pid,
    fecha_actualizacion: fechaSubida,
  };
  const { error: upErr } = await supabaseAdmin
    .from('anteproyectos')
    .update(update)
    .eq('id', req.params.id);
  if (upErr) return res.status(500).json({ error: upErr.message });

  // Notificaciones para el anteproyecto (caso/PI): director + comité + participante
  if (tipo === 'anteproyecto' && directorId) {
    void notificarSubidaAnteproyectoCasoPI({
      equipoId: ant.equipo_id,
      modalidad,
      directorId,
      archivoPath: path,
      archivoMime: mime,
      fechaSubida,
      participanteId: pid,
    });
  }

  res.status(201).json({ ok: true, path, size, mime });
});

// === POST /api/anteproyectos/:id/aprobar (admin/profesor) ===================
// Aprueba el anteproyecto (modalidades caso/PI). Desbloquea el upload del
// proyecto final. Por ahora solo super_admin puede aprobar (los directores
// no tienen acceso al sistema).
router.post('/:id/aprobar', async (req: AuthenticatedRequest, res) => {
  const role = req.user!.role;
  const esAdmin = role === 'super_admin' || req.user!.isSuperAdmin;
  if (!esAdmin) return res.status(403).json({ error: 'SOLO_ADMIN' });

  const ant = await loadAnteproyectoConEquipo(req.params.id);
  if (!ant) return res.status(404).json({ error: 'NOT_FOUND' });

  const modalidad = ant.equipos?.tipo_trabajo_grado;
  if (!(modalidad === 'caso' || modalidad === 'proyecto_investigacion')) {
    return res.status(400).json({ error: 'MODALIDAD_NO_REQUIERE_APROBACION' });
  }
  if (!ant.archivo_anteproyecto_path) {
    return res.status(400).json({ error: 'ANTEPROYECTO_NO_SUBIDO' });
  }
  if (ant.anteproyecto_aprobado_at) {
    return res.status(409).json({ error: 'ANTEPROYECTO_YA_APROBADO' });
  }

  const { error } = await supabaseAdmin
    .from('anteproyectos')
    .update({
      anteproyecto_aprobado_at: new Date().toISOString(),
      anteproyecto_aprobado_por: req.user!.sub ?? null,
    })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

// === GET /api/anteproyectos/:id/archivo/:tipo ===============================
router.get('/:id/archivo/:tipo', async (req: AuthenticatedRequest, res) => {
  const tipo = req.params.tipo;
  if (!isTipoArchivo(tipo)) return res.status(400).json({ error: 'TIPO_INVALIDO' });

  const ant = await loadAnteproyectoConEquipo(req.params.id);
  if (!ant) return res.status(404).json({ error: 'NOT_FOUND' });

  const role = req.user!.role;
  const isStaff = role === 'profesor' || role === 'super_admin' || req.user!.isSuperAdmin;
  if (!isStaff) {
    const pid = req.user!.participanteId;
    if (!pid) return res.status(403).json({ error: 'NO_PARTICIPANT_ID' });
    if (!(await isMiembroDelEquipo(pid, ant.equipo_id))) {
      return res.status(403).json({ error: 'NOT_TEAM_MEMBER' });
    }
  } else if (role === 'profesor') {
    // Profesor solo puede ver si tiene asignación con este equipo
    const profesorId = req.user!.profesorId;
    if (!profesorId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });
    const { data: asign } = await supabaseAdmin
      .from('asignaciones_profesor')
      .select('id')
      .eq('equipo_id', ant.equipo_id)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!asign) return res.status(403).json({ error: 'NOT_ASSIGNED_TO_TEAM' });
  }

  const path = ant[COL_PATH[tipo]] as string | null;
  if (!path) return res.status(404).json({ error: 'ARCHIVO_NO_SUBIDO' });

  const mime = (ant[COL_MIME[tipo]] as string | null) ?? 'application/octet-stream';
  // Devolvemos URL en nuestro dominio (proxy con token efimero), nunca la
  // URL firmada de Supabase Storage.
  const url = crearUrlProxyArchivo(path, mime);
  res.json({ url, expires_in: 300, mime });
});

export default router;
