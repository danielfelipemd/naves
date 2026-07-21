import { Router } from 'express';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { proyectosFase2 } from '../services/proyectos-fase2.js';
import { crearUrlProxyArchivo, mimeFromPath } from '../services/storage.js';

// =====================================================================
// Vista de TRABAJOS DE GRADO DEFINITIVOS agrupados por SECTOR (Comentario 13 QA).
//
// Estructura tomada de navesfs.netlify.app (tabla por sector, logo/proyecto/
// autores/sector/resumen+one pager/post LinkedIn/descargas), con la piel de
// naves-inalde.com. Dos protecciones:
//   1. La vista PÚBLICA por cohorte se abre solo con una CLAVE (hash sha-256 en
//      cohortes.clave_vista_trabajos_hash). Sin hash configurado → cerrada.
//   2. Los proyectos marcados `proyectos.confidencial` se muestran con 🔒 y SIN
//      descargas ni one-pager.
//
// El endpoint público NO usa requireAuth (es para compartir fuera del sistema);
// los de administración sí (super_admin).
// =====================================================================

const router = Router();

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

function urlAsset(path: string | null, urlExterna: string | null): string | null {
  if (path) return crearUrlProxyArchivo(path, mimeFromPath(path));
  return urlExterna ?? null;
}

// Arma la lista de proyectos definitivos de una cohorte, agrupada por sector.
// Si `revelarConfidenciales` es false (vista pública), los confidenciales van sin
// material descargable.
async function trabajosPorSector(cohorteId: string) {
  const pf = await proyectosFase2(cohorteId);
  const entradas = [...pf.values()];
  const proyIds = entradas.map((e) => e.proyecto_id);

  const contenido = new Map<string, any>();
  const confidencial = new Map<string, boolean>();
  if (proyIds.length) {
    const [{ data: cont }, { data: proys }] = await Promise.all([
      supabaseAdmin.from('proyecto_contenido').select('*').in('proyecto_id', proyIds),
      supabaseAdmin.from('proyectos').select('id, confidencial').in('id', proyIds),
    ]);
    for (const x of (cont ?? []) as any[]) contenido.set(x.proyecto_id, x);
    for (const p of (proys ?? []) as any[]) confidencial.set(p.id, !!p.confidencial);
  }

  const items = entradas.map((e) => {
    const ct = contenido.get(e.proyecto_id) ?? null;
    const esConf = confidencial.get(e.proyecto_id) ?? false;
    return {
      proyecto_id: e.proyecto_id,
      proyecto: e.proyecto,
      autores: e.autores,
      sector: e.sector || 'Sin sector',
      confidencial: esConf,
      // Los confidenciales no exponen material.
      resumen: esConf ? null : (ct?.resumen ?? null),
      linkedin: esConf ? null : (ct?.linkedin ?? null),
      one_pager_url: esConf ? null : urlAsset(ct?.one_pager_path ?? null, ct?.one_pager_url ?? null),
      logo_url: esConf ? null : urlAsset(ct?.logo_path ?? null, ct?.logo_url ?? null),
    };
  });

  // Agrupar por sector (orden alfabético de sector; proyectos por nombre).
  const porSector = new Map<string, typeof items>();
  for (const it of items) {
    const arr = porSector.get(it.sector) ?? [];
    arr.push(it);
    porSector.set(it.sector, arr);
  }
  return [...porSector.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sector, proyectos]) => ({
      sector,
      proyectos: proyectos.sort((a, b) => a.proyecto.localeCompare(b.proyecto)),
    }));
}

// === PÚBLICO: GET /publico/:cohorteId?clave=XXXX ===========================
// Abre la vista si la clave coincide con el hash de la cohorte. Sin auth.
router.get('/publico/:cohorteId', async (req, res) => {
  const cohorteId = req.params.cohorteId;
  const { data: coh } = await supabaseAdmin
    .from('cohortes').select('id, etiqueta, clave_vista_trabajos_hash').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });

  const hash = (coh as any).clave_vista_trabajos_hash as string | null;
  if (!hash) return res.status(403).json({ error: 'VISTA_CERRADA', mensaje: 'Esta vista no está habilitada para consulta.' });

  const clave = String(req.query.clave ?? '');
  if (!clave || sha256hex(clave) !== hash) {
    return res.status(401).json({ error: 'CLAVE_INCORRECTA' });
  }

  const sectores = await trabajosPorSector(cohorteId);
  res.json({ cohorte_id: cohorteId, etiqueta: (coh as any).etiqueta ?? cohorteId, sectores });
});

// === ADMIN (super_admin) ===================================================
const soloAdmin = [requireAuth(), requireRole('super_admin')];

// Estado de la clave (sin revelar el hash) y vista previa completa para el admin.
router.get('/admin/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const cohorteId = req.params.cohorteId;
  const { data: coh } = await supabaseAdmin
    .from('cohortes').select('id, etiqueta, clave_vista_trabajos_hash').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });
  const sectores = await trabajosPorSector(cohorteId);
  res.json({
    cohorte_id: cohorteId,
    etiqueta: (coh as any).etiqueta ?? cohorteId,
    clave_configurada: !!(coh as any).clave_vista_trabajos_hash,
    sectores,
  });
});

// Fija o borra la clave de la vista pública. clave vacía/null → cierra la vista.
router.post('/admin/:cohorteId/clave', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const cohorteId = req.params.cohorteId;
  const clave = typeof req.body?.clave === 'string' ? req.body.clave.trim() : '';
  const hash = clave ? sha256hex(clave) : null;
  const { error } = await supabaseAdmin
    .from('cohortes').update({ clave_vista_trabajos_hash: hash }).eq('id', cohorteId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, clave_configurada: !!hash });
});

// Marca/desmarca un proyecto como confidencial.
router.post('/admin/proyecto/:proyectoId/confidencial', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const confidencial = !!req.body?.confidencial;
  const { error } = await supabaseAdmin
    .from('proyectos').update({ confidencial }).eq('id', req.params.proyectoId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, confidencial });
});

export default router;
