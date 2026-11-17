import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';

// =====================================================================
// Catálogo de sectores (sql/53). Lo edita el súper admin desde la pantalla
// «Sectores»; lo leen el formulario del anteproyecto, la base de proyectos y
// la programación. proyectos.sector es texto: renombrar un sector actualiza
// los proyectos que lo tienen; ocultarlo no toca ningún proyecto.
// =====================================================================

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;

async function auditar(req: AuthenticatedRequest, accion: string, id: number, detalles: Record<string, unknown>) {
  await supabaseAdmin.from('auditoria').insert({
    actor_tipo: 'super_admin', actor_id: req.user?.profesorId ?? null,
    accion, entidad_tipo: 'sectores', entidad_id: String(id), detalles,
    timestamp: new Date().toISOString(),
  }).then(() => { /* el rastro no debe tumbar el cambio */ }, () => { /* idem */ });
}

// GET /api/sectores — sectores activos, en orden (cualquier usuario con sesión).
router.get('/', requireAuth(), async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('sectores').select('id, nombre').eq('activo', true).order('orden').order('nombre');
  if (error) return res.status(500).json({ error: 'SECTORES_ERROR', detail: error.message });
  res.json((data ?? []).map((s: any) => s.nombre));
});

// GET /api/sectores/admin — todos (también ocultos), con cuántos proyectos los usan.
router.get('/admin', ...soloAdmin, async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('sectores').select('id, nombre, orden, activo').order('orden').order('nombre');
  if (error) return res.status(500).json({ error: 'SECTORES_ERROR', detail: error.message });
  const { data: usos } = await supabaseAdmin.from('proyectos').select('sector').not('sector', 'is', null);
  const conteo = new Map<string, number>();
  for (const p of (usos ?? []) as any[]) conteo.set(p.sector, (conteo.get(p.sector) ?? 0) + 1);
  const nombres = new Set((data ?? []).map((s: any) => s.nombre));
  res.json({
    sectores: (data ?? []).map((s: any) => ({ ...s, proyectos: conteo.get(s.nombre) ?? 0 })),
    // Sectores que tienen proyectos pero no están en el catálogo (datos viejos).
    fuera_de_catalogo: [...conteo.entries()].filter(([n]) => n.trim() && !nombres.has(n)).map(([nombre, proyectos]) => ({ nombre, proyectos })),
  });
});

const nombreSchema = z.string().trim().min(2).max(100);

// POST /api/sectores/admin — agrega un sector (queda antes de «Otro»).
router.post('/admin', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ nombre: nombreSchema }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'NOMBRE_INVALIDO', message: 'El nombre debe tener entre 2 y 100 caracteres.' });
  const nombre = parsed.data.nombre;
  const { data: todos } = await supabaseAdmin.from('sectores').select('id, nombre, orden');
  const existente = (todos ?? []).find((s: any) => s.nombre.toLocaleLowerCase('es') === nombre.toLocaleLowerCase('es'));
  if (existente) return res.status(409).json({ error: 'SECTOR_EXISTE', message: `Ya existe el sector «${(existente as any).nombre}». Si está oculto, vuelve a mostrarlo.` });
  const otro = (todos ?? []).find((s: any) => s.nombre === 'Otro') as any;
  const maxSinOtro = Math.max(0, ...(todos ?? []).filter((s: any) => s.nombre !== 'Otro').map((s: any) => s.orden));
  const orden = maxSinOtro + 10;
  // «Otro» siempre al final.
  if (otro && otro.orden <= orden) await supabaseAdmin.from('sectores').update({ orden: orden + 10 }).eq('id', otro.id);
  const { data, error } = await supabaseAdmin.from('sectores').insert({ nombre, orden }).select('id').single();
  if (error) return res.status(500).json({ error: 'GUARDAR_FALLIDO', detail: error.message });
  await auditar(req, 'ADMIN_CREAR_SECTOR', (data as any).id, { nombre });
  res.json({ ok: true, id: (data as any).id });
});

// PATCH /api/sectores/admin/:id — renombra (y actualiza los proyectos) u oculta/muestra.
router.patch('/admin/:id', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ nombre: nombreSchema.optional(), activo: z.boolean().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', message: 'El nombre debe tener entre 2 y 100 caracteres.' });
  const id = Number(req.params.id);
  const { data: s } = await supabaseAdmin.from('sectores').select('id, nombre, activo').eq('id', id).maybeSingle();
  if (!s) return res.status(404).json({ error: 'SECTOR_NO_ENCONTRADO' });
  const antes = (s as any).nombre as string;
  const upd: Record<string, unknown> = {};
  let proyectosActualizados = 0;

  if (parsed.data.nombre !== undefined && parsed.data.nombre !== antes) {
    const nuevo = parsed.data.nombre;
    const { data: choque } = await supabaseAdmin.from('sectores').select('id, nombre').ilike('nombre', nuevo).neq('id', id);
    if ((choque ?? []).length) return res.status(409).json({ error: 'SECTOR_EXISTE', message: `Ya existe el sector «${(choque as any[])[0].nombre}».` });
    upd.nombre = nuevo;
  }
  if (parsed.data.activo !== undefined) upd.activo = parsed.data.activo;
  if (!Object.keys(upd).length) return res.json({ ok: true });

  const { error } = await supabaseAdmin.from('sectores').update(upd).eq('id', id);
  if (error) return res.status(500).json({ error: 'GUARDAR_FALLIDO', detail: error.message });
  if (upd.nombre) {
    // Los proyectos guardan el sector como texto: se renombran con el catálogo.
    const { data: tocados, error: errP } = await supabaseAdmin.from('proyectos').update({ sector: upd.nombre }).eq('sector', antes).select('id');
    if (errP) return res.status(500).json({ error: 'PROYECTOS_NO_ACTUALIZADOS', detail: errP.message });
    proyectosActualizados = (tocados ?? []).length;
  }
  await auditar(req, 'ADMIN_EDITAR_SECTOR', id, { antes, cambios: upd, proyectos_actualizados: proyectosActualizados });
  res.json({ ok: true, proyectos_actualizados: proyectosActualizados });
});

// POST /api/sectores/admin/:id/mover — sube (-1) o baja (1) un puesto en la lista.
router.post('/admin/:id/mover', ...soloAdmin, async (req, res) => {
  const parsed = z.object({ dir: z.union([z.literal(-1), z.literal(1)]) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });
  const { data: todos } = await supabaseAdmin.from('sectores').select('id, orden').order('orden').order('nombre');
  const lista = (todos ?? []) as Array<{ id: number; orden: number }>;
  const i = lista.findIndex((s) => s.id === Number(req.params.id));
  const k = i + parsed.data.dir;
  if (i < 0) return res.status(404).json({ error: 'SECTOR_NO_ENCONTRADO' });
  if (k < 0 || k >= lista.length) return res.json({ ok: true });
  // Renumerar todo de 10 en 10 con el intercambio hecho: evita empates de orden.
  [lista[i], lista[k]] = [lista[k], lista[i]];
  for (let n = 0; n < lista.length; n++) {
    const orden = (n + 1) * 10;
    if (lista[n].orden !== orden) await supabaseAdmin.from('sectores').update({ orden }).eq('id', lista[n].id);
  }
  res.json({ ok: true });
});

export default router;
