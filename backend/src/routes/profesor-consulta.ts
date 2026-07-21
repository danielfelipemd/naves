import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import { proyectosFase2 } from '../services/proyectos-fase2.js';
import { crearUrlProxyArchivo, mimeFromPath } from '../services/storage.js';
import {
  getConfig, jornadaConSlots, programacionPublicadaAt, fechaLegibleProg, toHHMM,
} from '../services/escaleta.js';

// Vistas de SOLO CONSULTA del rol profesor (Fase 2).
//
// El profesor no edita nada aquí: mira los trabajos definitivos, los equipos y la
// programación PUBLICADA de las cohortes donde tiene equipos asignados. El alcance
// sale SIEMPRE de asignaciones_profesor — nunca ve cohortes ajenas.
//
// Un super_admin sin profesor_id (p. ej. admin@naves.com) no tiene asignaciones,
// así que para poder auditar estas pantallas pasa ?cohorte_id= y ve esa cohorte
// entera. Es la misma excusa de prueba que ya usan otras rutas.

const router = Router();
router.use(requireAuth());

// URL servida de un asset: proxy con token efímero si está en Storage; si no, el
// enlace externo. Mismo criterio que proyectos-db.ts / programacion.ts.
function urlAsset(path: string | null, urlExterna: string | null): string | null {
  if (path) return crearUrlProxyArchivo(path, mimeFromPath(path));
  return urlExterna ?? null;
}

// Cohorte dentro del alcance del profesor. `equipoIds === null` significa "toda
// la cohorte" (modo super_admin con ?cohorte_id=); si es un Set, solo esos
// equipos asignados.
interface CohorteAlcance { cohorte_id: string; etiqueta: string; equipoIds: Set<string> | null; }
type Alcance =
  | { error: true; status: number; body: any }
  | { error: false; cohortes: CohorteAlcance[] };

async function etiquetasDe(cohorteIds: string[]): Promise<Map<string, string>> {
  if (!cohorteIds.length) return new Map();
  const { data } = await supabaseAdmin.from('cohortes').select('id, etiqueta').in('id', cohorteIds);
  return new Map((data ?? []).map((c: any) => [c.id, c.etiqueta ?? c.id]));
}

// Resuelve qué cohortes/equipos puede consultar quien llama.
async function alcanceProfesor(req: AuthenticatedRequest): Promise<Alcance> {
  const profesorId = req.user?.profesorId;
  const esSuperAdmin = !!req.user?.isSuperAdmin || req.user?.role === 'super_admin';

  if (profesorId) {
    const { data, error } = await supabaseAdmin
      .from('asignaciones_profesor')
      .select('equipo_id, cohorte_id')
      .eq('profesor_id', profesorId);
    if (error) return { error: true, status: 500, body: { error: error.message } };

    // Agrupar equipos por cohorte.
    const porCohorte = new Map<string, Set<string>>();
    for (const a of (data ?? []) as any[]) {
      if (!a.cohorte_id) continue;
      const set = porCohorte.get(a.cohorte_id) ?? new Set<string>();
      if (a.equipo_id) set.add(a.equipo_id);
      porCohorte.set(a.cohorte_id, set);
    }
    const etiquetas = await etiquetasDe([...porCohorte.keys()]);
    const cohortes: CohorteAlcance[] = [...porCohorte.entries()]
      .map(([cohorte_id, equipoIds]) => ({ cohorte_id, etiqueta: etiquetas.get(cohorte_id) ?? cohorte_id, equipoIds }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
    return { error: false, cohortes };
  }

  // Sin profesor_id, solo un super_admin puede seguir (modo prueba con ?cohorte_id=).
  if (!esSuperAdmin) return { error: true, status: 403, body: { error: 'NO_PROFESOR_ID' } };

  const cohorteId = String(req.query.cohorte_id ?? '').trim();
  if (!cohorteId) return { error: false, cohortes: [] };
  const etiquetas = await etiquetasDe([cohorteId]);
  return { error: false, cohortes: [{ cohorte_id: cohorteId, etiqueta: etiquetas.get(cohorteId) ?? cohorteId, equipoIds: null }] };
}

// GET /trabajos-definitivos — proyectos finales de los equipos asignados, por cohorte.
router.get('/trabajos-definitivos', async (req: AuthenticatedRequest, res) => {
  const alc = await alcanceProfesor(req);
  if (alc.error) return res.status(alc.status).json(alc.body);

  const out = [];
  for (const c of alc.cohortes) {
    const pf = await proyectosFase2(c.cohorte_id);
    const entradas = [...pf.values()].filter((e) => c.equipoIds === null || c.equipoIds.has(e.equipo_id));
    const proyIds = entradas.map((e) => e.proyecto_id);
    let contenido = new Map<string, any>();
    if (proyIds.length) {
      const { data } = await supabaseAdmin.from('proyecto_contenido').select('*').in('proyecto_id', proyIds);
      contenido = new Map((data ?? []).map((x: any) => [x.proyecto_id, x]));
    }
    const proyectos = entradas
      .map((e) => {
        const ct = contenido.get(e.proyecto_id) ?? null;
        return {
          proyecto: e.proyecto,
          autores: e.autores,
          sector: e.sector,
          resumen: ct?.resumen ?? null,
          linkedin: ct?.linkedin ?? null,
          one_pager_url: urlAsset(ct?.one_pager_path ?? null, ct?.one_pager_url ?? null),
          logo_url: urlAsset(ct?.logo_path ?? null, ct?.logo_url ?? null),
        };
      })
      .sort((a, b) => a.proyecto.localeCompare(b.proyecto));
    out.push({ cohorte_id: c.cohorte_id, etiqueta: c.etiqueta, proyectos });
  }
  res.json({ cohortes: out });
});

// GET /equipos — equipos asignados con sus miembros, por cohorte.
router.get('/equipos', async (req: AuthenticatedRequest, res) => {
  const alc = await alcanceProfesor(req);
  if (alc.error) return res.status(alc.status).json(alc.body);

  const out = [];
  for (const c of alc.cohortes) {
    let query = supabaseAdmin
      .from('equipos')
      .select('id, nombre_equipo, tipo_trabajo_grado, miembros_equipo(posicion, participantes_lista(nombre_completo))')
      .eq('cohorte_id', c.cohorte_id)
      .order('nombre_equipo', { ascending: true });
    if (c.equipoIds !== null) {
      const ids = [...c.equipoIds];
      // Sin equipos asignados en la cohorte no hay nada que traer.
      if (!ids.length) { out.push({ cohorte_id: c.cohorte_id, etiqueta: c.etiqueta, equipos: [] }); continue; }
      query = query.in('id', ids);
    }
    const { data } = await query;
    const equipos = ((data ?? []) as any[]).map((e) => ({
      nombre_equipo: e.nombre_equipo ?? '(sin nombre)',
      tipo_trabajo_grado: e.tipo_trabajo_grado ?? null,
      miembros: ((e.miembros_equipo ?? []) as any[])
        .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
        .map((m) => m.participantes_lista?.nombre_completo)
        .filter(Boolean),
    }));
    out.push({ cohorte_id: c.cohorte_id, etiqueta: c.etiqueta, equipos });
  }
  res.json({ cohortes: out });
});

// Contenido publicable (logo, one pager, resumen, post) por proyecto.
async function contenidoPorProyecto(proyIds: string[]): Promise<Map<string, any>> {
  if (!proyIds.length) return new Map();
  const { data } = await supabaseAdmin.from('proyecto_contenido').select('*').in('proyecto_id', proyIds);
  return new Map((data ?? []).map((c: any) => [c.proyecto_id, c]));
}

// GET /programacion — programación PUBLICADA de cada cohorte asignada. Si no está
// publicada, la cohorte se devuelve con publicada:false y jornadas:[].
router.get('/programacion', async (req: AuthenticatedRequest, res) => {
  const alc = await alcanceProfesor(req);
  if (alc.error) return res.status(alc.status).json(alc.body);

  const out = [];
  for (const c of alc.cohortes) {
    const publicadaAt = await programacionPublicadaAt(c.cohorte_id);
    if (!publicadaAt) {
      out.push({ cohorte_id: c.cohorte_id, etiqueta: c.etiqueta, publicada: false, publicada_at: null, jornadas: [] });
      continue;
    }

    const C = await getConfig(c.cohorte_id);
    const pf = await proyectosFase2(c.cohorte_id);
    const contenido = await contenidoPorProyecto([...pf.keys()]);
    const { data: jornadas } = await supabaseAdmin
      .from('jornadas').select('id, numero, fecha, hora_inicio, hora_fin, foto_inicial, intro_min')
      .eq('cohorte_id', c.cohorte_id).order('numero');

    const jornadasOut = [];
    for (let i = 0; i < (jornadas ?? []).length; i++) {
      const jc = await jornadaConSlots((jornadas as any[])[i], C, i === (jornadas ?? []).length - 1, pf);
      jornadasOut.push({
        id: jc.jornada.id, numero: jc.jornada.numero, fecha: jc.jornada.fecha,
        fecha_legible: fechaLegibleProg(jc.jornada.fecha),
        hora_inicio: jc.jornada.hora_inicio, hora_fin: jc.jornada.hora_fin,
        slots: jc.filas.filter((f) => f.tipo === 'proyecto').map((f) => {
          const ct = f.proyecto_id ? contenido.get(f.proyecto_id) : null;
          return {
            slot: f.slot, proyecto: f.proyecto, autores: f.autores, sector: f.sector,
            hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin),
            resumen: ct?.resumen ?? null, linkedin: ct?.linkedin ?? null,
            one_pager_url: urlAsset(ct?.one_pager_path ?? null, ct?.one_pager_url ?? null),
            logo_url: urlAsset(ct?.logo_path ?? null, ct?.logo_url ?? null),
          };
        }),
        actividades: jc.filas.filter((f) => f.tipo !== 'proyecto')
          .map((f) => ({ tipo: f.tipo, desc: f.desc, hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin) })),
      });
    }
    out.push({ cohorte_id: c.cohorte_id, etiqueta: c.etiqueta, publicada: true, publicada_at: publicadaAt, jornadas: jornadasOut });
  }
  res.json({ cohortes: out });
});

export default router;
