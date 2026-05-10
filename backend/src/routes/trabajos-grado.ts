import { Router } from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import {
  uploadTrabajoGradoFile,
  getSignedUrlTrabajoGrado,
  deleteTrabajoGradoFile,
  type TipoArchivoTrabajo,
} from '../services/storage.js';

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
      equipos:equipos!inner ( id, cohorte_id, tipo_trabajo_grado,
        cohortes:cohortes ( fecha_limite_entrega_anteproyecto )
      )
    `)
    .eq('id', id)
    .maybeSingle();
  return ant as any;
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

  const mime = req.file.mimetype;
  const setPermitido = tipo === 'anteproyecto' ? MIME_ANTEPROYECTO : MIME_PROYECTO_FINAL;
  if (!setPermitido.has(mime)) return res.status(400).json({ error: 'INVALID_MIME', mime });

  const limite = ant.equipos?.cohortes?.fecha_limite_entrega_anteproyecto;
  if (limite && new Date() >= new Date(limite)) {
    return res.status(403).json({ error: 'FECHA_LIMITE_EXPIRADA', fecha_limite: limite });
  }

  // Borrar archivo previo si existía con extensión distinta (para no dejar huérfanos)
  const previo = ant[COL_PATH[tipo]] as string | null;

  let path: string;
  let size: number;
  try {
    const result = await uploadTrabajoGradoFile(ant.equipo_id, tipo, req.file.buffer, mime);
    path = result.path;
    size = result.size;
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'UPLOAD_FAILED' });
  }

  if (previo && previo !== path) {
    try { await deleteTrabajoGradoFile(previo); } catch { /* best-effort */ }
  }

  const update: Record<string, unknown> = {
    [COL_PATH[tipo]]: path,
    [COL_MIME[tipo]]: mime,
    [COL_SIZE[tipo]]: size,
    [COL_UPLOADED[tipo]]: new Date().toISOString(),
    ultimo_editor_id: pid,
    fecha_actualizacion: new Date().toISOString(),
  };
  const { error: upErr } = await supabaseAdmin
    .from('anteproyectos')
    .update(update)
    .eq('id', req.params.id);
  if (upErr) return res.status(500).json({ error: upErr.message });

  res.status(201).json({ ok: true, path, size, mime });
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

  try {
    const url = await getSignedUrlTrabajoGrado(path, 300);
    res.json({ url, expires_in: 300, mime: ant[COL_MIME[tipo]] ?? null });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'SIGN_URL_FAILED' });
  }
});

export default router;
