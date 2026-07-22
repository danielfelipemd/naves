import { Router } from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import {
  uploadTrabajoGradoFile,
  crearUrlProxyArchivo,
  downloadTrabajoGradoFile,
  extForMime,
  uploadAssetNaves,
  extForAsset,
  mimeFromPath,
  type TipoArchivoTrabajo,
  type TipoAssetNaves,
} from '../services/storage.js';
import { sendEmail, type EmailAttachment } from '../services/email.js';
import { notificarRegistroAnteproyectoAParticipantes } from '../services/notificaciones-anteproyecto.js';
import { programacionPublicadaAt } from '../services/escaleta.js';
import { decryptPII } from '../auth/crypto.js';

// (Antes este archivo enviaba un correo al Comité del MBA por cada carga.
// Eso fue retirado: el Comité recibe un solo correo consolidado cuando el
// super_admin revisa y aprueba la sábana de caso/PI — implementado en
// admin.ts, no aquí.)

const router = Router();
router.use(requireAuth());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Ambos entregables van en PDF, y solo PDF: un Word se ve distinto en cada
// equipo que lo abre, así que no sirve como versión de entrega.
const MIME_ANTEPROYECTO = new Set(['application/pdf']);
const MIME_AVANCE = new Set(['application/pdf']);
const MIME_PROYECTO_FINAL = new Set(['application/pdf']);

const COL_PATH: Record<TipoArchivoTrabajo, string> = {
  'anteproyecto': 'archivo_anteproyecto_path',
  'avance': 'archivo_avance_path',
  'proyecto-final': 'archivo_proyecto_final_path',
};
const COL_MIME: Record<TipoArchivoTrabajo, string> = {
  'anteproyecto': 'archivo_anteproyecto_mime',
  'avance': 'archivo_avance_mime',
  'proyecto-final': 'archivo_proyecto_final_mime',
};
const COL_SIZE: Record<TipoArchivoTrabajo, string> = {
  'anteproyecto': 'archivo_anteproyecto_size_bytes',
  'avance': 'archivo_avance_size_bytes',
  'proyecto-final': 'archivo_proyecto_final_size_bytes',
};
const COL_UPLOADED: Record<TipoArchivoTrabajo, string> = {
  'anteproyecto': 'archivo_anteproyecto_uploaded_at',
  'avance': 'archivo_avance_uploaded_at',
  'proyecto-final': 'archivo_proyecto_final_uploaded_at',
};

function isTipoArchivo(v: string): v is TipoArchivoTrabajo {
  return v === 'anteproyecto' || v === 'avance' || v === 'proyecto-final';
}

async function loadAnteproyectoConEquipo(id: string) {
  const { data: ant } = await supabaseAdmin
    .from('anteproyectos')
    .select(`
      id, equipo_id, estado,
      archivo_anteproyecto_path, archivo_avance_path, archivo_proyecto_final_path,
      anteproyecto_aprobado_at,
      equipos:equipos!inner ( id, cohorte_id, tipo_trabajo_grado, nombre_equipo, director_id,
        proyecto_definitivo_id,
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
      // El path ahora conserva el nombre original sanitizado (ej.
      // 'equipoId/anteproyecto/cindy_anteproyecto_v2.pdf'). Lo usamos
      // tal cual para el adjunto.
      const filenameFromPath = ctx.archivoPath.split('/').pop();
      attachments = [{
        filename: filenameFromPath || `anteproyecto-${equipoNombre.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`,
        content: buf,
        contentType: ctx.archivoMime,
      }];
      tieneAdjunto = true;
    } catch (e) {
      console.warn('[anteproyecto.subido] no se pudo adjuntar PDF:', (e as Error).message);
    }

    const lineaAdjuntoDirector = tieneAdjunto
      ? 'El documento se adjunta al presente correo para su revisión.'
      : 'No fue posible adjuntar el documento al presente correo. Pronto el equipo se lo enviará.';
    const lineaAdjuntoParticipante = tieneAdjunto
      ? `Los directores asignados (<strong>${dir.nombre_completo}</strong>) ya fueron notificados por correo electrónico y recibieron el documento como archivo adjunto.`
      : `Se notificó a los directores asignados (<strong>${dir.nombre_completo}</strong>) sobre la carga; sin embargo, por una falla técnica no fue posible adjuntar el documento al correo. Te pedimos hacerles llegar el documento directamente por correo para que puedan revisarlo.`;

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
            <p style="color:#888; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; margin: 0;">Notificación a directores — Programa MBA</p>
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

    // El Comité NO recibe correo por cada carga (es spam). En su lugar, cuando
    // el super_admin revise y apruebe la sábana de caso/PI, se envia UN solo
    // correo consolidado con el listado de todos los equipos. Eso se maneja
    // desde admin (endpoint separado, no este flujo de upload).

    // === 2) Email a TODOS los miembros del equipo (confirmación, sin adjunto)
    // Usa el helper compartido para que el correo sea idéntico al del flujo
    // BP (envío definitivo del formulario): un solo template para todas las
    // modalidades.
    await notificarRegistroAnteproyectoAParticipantes({
      equipoId: ctx.equipoId,
      modalidad: ctx.modalidad,
      fechaIso: ctx.fechaSubida,
      casoPI: {
        directorNombre: dir.nombre_completo,
        lineaAdjuntoParticipante,
        cargadorNombre: cargadorNombre || undefined,
      },
    });
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

// Fecha y hora límite para cargar el PROYECTO DE GRADO (documento final +
// material), como ISO datetime:
//  - la configurada en la cohorte (fecha_limite_proyecto_final, CON hora), o
//  - si no está, el hito 10 del cronograma ("Entrega Final") a fin del día
//    (Bogotá, UTC-5) como respaldo.
// No es la fecha del anteproyecto, que vence mucho antes. Sin ninguna de las dos
// configurada, no se bloquea.
async function fechaLimiteProyecto(cohorteId: string): Promise<string | null> {
  const { data: coh } = await supabaseAdmin
    .from('cohortes').select('fecha_limite_proyecto_final').eq('id', cohorteId).maybeSingle();
  const dt = (coh as any)?.fecha_limite_proyecto_final;
  if (dt) return new Date(dt).toISOString();
  const { data: hito } = await supabaseAdmin
    .from('cohorte_hitos').select('fecha').eq('cohorte_id', cohorteId).eq('posicion', 10).maybeSingle();
  const f = (hito as any)?.fecha;
  return f ? new Date(`${f}T23:59:59-05:00`).toISOString() : null;
}

// Vencido = ya pasó el instante límite (comparación directa de datetime).
function limiteVencido(iso: string | null): boolean {
  if (!iso) return false;
  return new Date() > new Date(iso);
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
  const modalidad = ant.equipos?.tipo_trabajo_grado;
  const esCasoPI = modalidad === 'caso' || modalidad === 'proyecto_investigacion';
  const directorId = ant.equipos?.director_id as string | null;
  const yaSubido = ant[COL_PATH[tipo]] as string | null;

  // Reglas por tipo
  if (tipo === 'anteproyecto') {
    // El ARCHIVO de anteproyecto solo existe en caso/PI: el Business Plan usa el
    // formulario. Solo se carga mientras el anteproyecto sigue en borrador.
    if (!esCasoPI) return res.status(400).json({ error: 'MODALIDAD_NO_USA_ARCHIVOS', modalidad });
    if (ant.estado !== 'borrador') {
      return res.status(409).json({ error: 'ALREADY_SUBMITTED', estado: ant.estado });
    }
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
  } else if (tipo === 'avance') {
    // AVANCE (entrega intermedia): solo caso/PI. Exige tener el anteproyecto
    // cargado y es de una sola carga (no reemplazable). La fecha del avance es
    // un objetivo/advertencia: NO bloquea la carga tardía (decisión del área).
    if (!esCasoPI) return res.status(400).json({ error: 'MODALIDAD_NO_USA_ARCHIVOS', modalidad });
    if (!ant.archivo_anteproyecto_path) {
      return res.status(403).json({
        error: 'FALTA_ANTEPROYECTO',
        mensaje: 'Carga primero tu anteproyecto: con eso se habilita el avance.',
      });
    }
    if (yaSubido) {
      return res.status(409).json({
        error: 'AVANCE_YA_SUBIDO',
        mensaje: 'El avance ya fue cargado y no se puede reemplazar.',
      });
    }
  } else {
    // MÓDULO DE PROYECTO (proyecto final). Aplica a todas las modalidades, pero
    // se habilita distinto porque los flujos son distintos:
    //  - caso/PI: al cargar su AVANCE (que a su vez exige el anteproyecto). No
    //    pasan por la reunión de profesores; esa selección es del Business Plan.
    //  - business plan: al elegirse el proyecto definitivo en la reunión.
    if (esCasoPI) {
      if (!ant.archivo_avance_path) {
        return res.status(403).json({
          error: 'FALTA_AVANCE',
          mensaje: 'Carga primero tu avance (entrega intermedia): con eso se habilita el proyecto final.',
        });
      }
    } else if (!ant.equipos?.proyecto_definitivo_id) {
      return res.status(403).json({
        error: 'ESPERA_PROYECTO_DEFINITIVO',
        mensaje: 'Podrás cargar tu proyecto final cuando se elija tu proyecto definitivo.',
      });
    }
    if (yaSubido) {
      return res.status(409).json({
        error: 'PROYECTO_FINAL_YA_SUBIDO',
        mensaje: 'El proyecto final ya fue cargado y no se puede reemplazar.',
      });
    }
    // Corte por fecha de la cohorte (hito 10 "Entrega Final"): pasada esa
    // fecha ya no se puede cargar el proyecto de grado.
    const limite = await fechaLimiteProyecto(ant.equipos?.cohorte_id);
    if (limiteVencido(limite)) {
      return res.status(403).json({
        error: 'FECHA_LIMITE_PROYECTO_EXPIRADA', fecha_limite: limite,
        mensaje: 'La fecha límite para entregar el proyecto de grado ya pasó.',
      });
    }
  }

  const mime = req.file.mimetype;
  const setPermitido = tipo === 'anteproyecto' ? MIME_ANTEPROYECTO : tipo === 'avance' ? MIME_AVANCE : MIME_PROYECTO_FINAL;
  if (!setPermitido.has(mime)) return res.status(400).json({ error: 'INVALID_MIME', mime });

  // La fecha límite es la de ENTREGA DEL ANTEPROYECTO: no puede cerrar el
  // proyecto final, que se entrega mucho después (hito 10).
  const limite = ant.equipos?.cohortes?.fecha_limite_entrega_anteproyecto;
  if (tipo === 'anteproyecto' && limite && new Date() >= new Date(limite)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: limite });
  }

  let path: string;
  let size: number;
  try {
    const result = await uploadTrabajoGradoFile(
      ant.equipo_id,
      tipo,
      req.file.buffer,
      mime,
      req.file.originalname,
    );
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

// === Assets del proyecto: one pager, logo y modelo financiero ==============
// A diferencia del proyecto final (definitivo, un único PDF), estos son material
// de apoyo que alimenta la programación de presentaciones. Se guardan en
// proyecto_contenido, colgados del PROYECTO DEFINITIVO del equipo, y SÍ se pueden
// reemplazar (volver a subir sobrescribe) mientras la programación no se publique
// — un logo malo congelado es peor que dejarlo editable.
const ASSET_MIMES: Record<TipoAssetNaves, Set<string>> = {
  logo: new Set(['image/png', 'image/jpeg', 'image/webp']),
  one_pager: new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  // Solo Excel: el modelo editable, no una foto ni un PDF de él.
  modelo_financiero: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ]),
};
const ASSET_COL: Record<TipoAssetNaves, string> = {
  logo: 'logo_path',
  one_pager: 'one_pager_path',
  modelo_financiero: 'modelo_financiero_path',
};
function isTipoAsset(v: string): v is TipoAssetNaves {
  return v === 'logo' || v === 'one_pager' || v === 'modelo_financiero';
}

// Resuelve el proyecto definitivo del equipo del anteproyecto y comprueba que el
// participante puede tocar sus assets: es miembro, ya hay definitivo, y la
// programación no está publicada. Devuelve el proyecto_id o responde el error.
async function resolverProyectoAsset(req: AuthenticatedRequest, res: any): Promise<{ proyectoId: string } | null> {
  const pid = req.user!.participanteId;
  if (!pid) { res.status(403).json({ error: 'NO_PARTICIPANT_ID' }); return null; }

  const ant = await loadAnteproyectoConEquipo(req.params.id);
  if (!ant) { res.status(404).json({ error: 'NOT_FOUND' }); return null; }
  if (!(await isMiembroDelEquipo(pid, ant.equipo_id))) { res.status(403).json({ error: 'NOT_TEAM_MEMBER' }); return null; }

  const proyectoId = ant.equipos?.proyecto_definitivo_id as string | null;
  if (!proyectoId) {
    res.status(403).json({
      error: 'ESPERA_PROYECTO_DEFINITIVO',
      mensaje: 'Podrás cargar el material del proyecto cuando se elija tu proyecto definitivo.',
    });
    return null;
  }
  return { proyectoId };
}

// GET /:id/asset/:tipo — URL de descarga (proxy) del asset, o 404 si no hay.
router.get('/:id/asset/:tipo', async (req: AuthenticatedRequest, res) => {
  const tipo = req.params.tipo;
  if (!isTipoAsset(tipo)) return res.status(400).json({ error: 'TIPO_INVALIDO' });
  const r = await resolverProyectoAsset(req, res);
  if (!r) return;

  const { data } = await supabaseAdmin
    .from('proyecto_contenido').select(ASSET_COL[tipo]).eq('proyecto_id', r.proyectoId).maybeSingle();
  const path = (data as any)?.[ASSET_COL[tipo]] as string | null;
  if (!path) return res.status(404).json({ error: 'ARCHIVO_NO_SUBIDO' });
  res.json({ url: crearUrlProxyArchivo(path, mimeFromPath(path)), expires_in: 300 });
});

// POST /:id/asset/:tipo — sube (o reemplaza) el asset del proyecto definitivo.
router.post('/:id/asset/:tipo', upload.single('file'), async (req: AuthenticatedRequest, res) => {
  const tipo = req.params.tipo;
  if (!isTipoAsset(tipo)) return res.status(400).json({ error: 'TIPO_INVALIDO' });
  if (!req.file) return res.status(400).json({ error: 'NO_FILE' });

  const r = await resolverProyectoAsset(req, res);
  if (!r) return;

  const ant = await loadAnteproyectoConEquipo(req.params.id);
  const cohorteId = ant?.equipos?.cohorte_id as string | undefined;

  // Mismo corte por fecha que el proyecto final: el material se entrega junto
  // con él (hito 10). Pasada la fecha, no se carga.
  if (cohorteId && limiteVencido(await fechaLimiteProyecto(cohorteId))) {
    return res.status(403).json({
      error: 'FECHA_LIMITE_PROYECTO_EXPIRADA',
      mensaje: 'La fecha límite para entregar el proyecto de grado ya pasó.',
    });
  }

  // La programación publicada es definitiva: si ya se publicó, estos assets
  // están congelados (la escaleta que ven las áreas se armó con ellos).
  if (cohorteId && (await programacionPublicadaAt(cohorteId))) {
    return res.status(423).json({
      error: 'PROGRAMACION_PUBLICADA',
      mensaje: 'La programación de presentaciones ya se publicó: el material del proyecto no se puede cambiar.',
    });
  }

  const mime = req.file.mimetype;
  if (!ASSET_MIMES[tipo].has(mime) || !extForAsset(mime)) {
    return res.status(400).json({ error: 'INVALID_MIME', mime });
  }

  // Cargar una sola vez: una vez subido, el PARTICIPANTE no lo cambia. Solo el
  // super_admin puede reemplazarlo (ruta aparte del Módulo C). Por eso aquí se
  // rechaza la resubida — es la misma regla que el proyecto final.
  const { data: prevRow } = await supabaseAdmin
    .from('proyecto_contenido').select(ASSET_COL[tipo]).eq('proyecto_id', r.proyectoId).maybeSingle();
  if ((prevRow as any)?.[ASSET_COL[tipo]]) {
    return res.status(409).json({ error: 'ASSET_YA_SUBIDO' });
  }

  let path: string;
  try {
    ({ path } = await uploadAssetNaves(r.proyectoId, tipo, req.file.buffer, mime));
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'UPLOAD_FAILED' });
  }

  // El upsert de supabase-js no lanza: si no verificamos su error, el archivo
  // queda en Storage pero sin enlace en la fila, y al recargar "no está".
  const { error: errDb } = await supabaseAdmin.from('proyecto_contenido')
    .upsert({ proyecto_id: r.proyectoId, [ASSET_COL[tipo]]: path, updated_at: new Date().toISOString() }, { onConflict: 'proyecto_id' });
  if (errDb) return res.status(500).json({ error: 'ASSET_DB_FAILED', detail: errDb.message });

  res.status(201).json({ ok: true, url: crearUrlProxyArchivo(path, mimeFromPath(path)) });
});

export default router;
