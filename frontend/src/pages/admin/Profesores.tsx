import { useEffect, useRef, useState } from 'react';
import { api, downloadFile } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { AreasPicker } from '../../components/inalde/AreasPicker';
import { AREAS_AFINIDAD } from '../../lib/areas';

const AREAS_SET = new Set<string>(AREAS_AFINIDAD);
function sanitizeAreas(input: string[] | undefined | null): string[] {
  return (input ?? []).filter((a) => AREAS_SET.has(a));
}

interface Profesor {
  id: string;
  nombre_completo: string;
  email: string;
  es_super_admin: boolean;
  activo: boolean;
  tipo?: 'profesor' | 'area';
  booking_url: string | null;
  areas_afinidad: string[];
  ultimo_login: string | null;
}

// Usuarios de área: entran al sistema solo para consultar la Programación
// Interna. Viven en esta pantalla porque comparten el login por correo con los
// profesores, pero NO dirigen trabajos de grado (no salen en la sábana).
const ROLES_AREA = [
  { valor: 'marketing', etiqueta: 'Marketing' },
  { valor: 'operaciones', etiqueta: 'Operaciones' },
  { valor: 'asistente_programa', etiqueta: 'Asistente de programa' },
] as const;
type RolArea = (typeof ROLES_AREA)[number]['valor'];
const etiquetaArea = (v: string) => ROLES_AREA.find((r) => r.valor === v)?.etiqueta ?? v;

export default function Profesores() {
  const [profesores, setProfesores] = useState<Profesor[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<{
    nombre_completo: string; email: string; password: string;
    es_super_admin: boolean; rol_area: '' | RolArea; booking_url: string; areas_afinidad: string[];
  }>({
    nombre_completo: '', email: '', password: '',
    es_super_admin: false, rol_area: '', booking_url: '', areas_afinidad: [],
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Profesor> & { password?: string }>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ inserted: number; errors: Array<{ row: number; error: string }>; claves_generadas?: Array<{ email: string; nombre: string; clave: string }>; nota?: string } | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleSel(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelAll() {
    setSeleccion((prev) => {
      if (prev.size === profesores.length) return new Set();
      return new Set(profesores.map((p) => p.id));
    });
  }

  async function eliminarMasivo() {
    if (seleccion.size === 0) return;
    const ids = Array.from(seleccion);
    if (!confirm(`¿Eliminar ${ids.length} profesor(es)? Esta acción es irreversible y también borra sus cuentas de acceso.`)) return;
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post('/admin/profesores/bulk-delete', { ids });
      setSeleccion(new Set());
      const texto = `${data.borrados} profesor(es) eliminado(s).${data.fallos?.length ? ` ${data.fallos.length} no se pudo(ieron) borrar.` : ''}`;
      setMsg({ kind: data.fallos?.length ? 'err' : 'ok', text: texto });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function descargarPlantilla() {
    try {
      await downloadFile('/admin/profesores/plantilla', 'plantilla-profesores.xlsx');
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    }
  }

  async function cargarExcel() {
    const f = fileRef.current?.files?.[0];
    if (!f) { setMsg({ kind: 'err', text: 'Selecciona un archivo Excel (.xlsx).' }); return; }
    setBusy(true); setMsg(null); setBulkResult(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { data } = await api.post('/admin/profesores/cargar-excel', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setBulkResult(data);
      setMsg({ kind: 'ok', text: `Carga finalizada: ${data.inserted} profesor(es) creado(s).` });
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function load() {
    try { setProfesores((await api.get('/admin/profesores')).data); }
    catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }
  useEffect(() => { load(); }, []);

  async function crear() {
    setBusy(true); setMsg(null);
    try {
      const esArea = !!form.rol_area;
      // Un usuario de área no dirige trabajos de grado: el booking y las áreas
      // de afinidad son campos de docente y no se envían.
      const payload = esArea
        ? {
            nombre_completo: form.nombre_completo, email: form.email, password: form.password,
            rol_area: form.rol_area, es_super_admin: false,
          }
        : { ...form, rol_area: undefined, booking_url: form.booking_url || null };
      await api.post('/admin/profesores', payload);
      setMsg({
        kind: 'ok',
        text: esArea
          ? `${form.nombre_completo} creado como ${etiquetaArea(form.rol_area)}. Ya puede entrar y consultar la Programación Interna.`
          : `Profesor ${form.nombre_completo} creado.`,
      });
      setShowNew(false);
      setForm({ nombre_completo: '', email: '', password: '', es_super_admin: false, rol_area: '', booking_url: '', areas_afinidad: [] });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true); setMsg(null);
    try {
      const payload: Record<string, unknown> = {
        nombre_completo: editDraft.nombre_completo,
        es_super_admin: editDraft.es_super_admin,
        activo: editDraft.activo,
        booking_url: editDraft.booking_url || null,
        areas_afinidad: editDraft.areas_afinidad,
      };
      if (editDraft.email && editDraft.email.trim()) payload.email = editDraft.email.trim();
      if (editDraft.password && editDraft.password.length > 0) payload.password = editDraft.password;
      await api.put(`/admin/profesores/${editing}`, payload);
      setMsg({ kind: 'ok', text: 'Profesor actualizado.' });
      setEditing(null);
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function toggleActivo(p: Profesor) {
    const accion = p.activo ? 'desactivar' : 'reactivar';
    if (!confirm(`¿${accion[0].toUpperCase() + accion.slice(1)} a ${p.nombre_completo}?`)) return;
    setBusy(true); setMsg(null);
    try {
      await api.put(`/admin/profesores/${p.id}`, { activo: !p.activo });
      setMsg({ kind: 'ok', text: `${p.nombre_completo} ${p.activo ? 'desactivado' : 'reactivado'}.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6 flex items-end justify-between">
        <div>
          <p className="section-subtitle mb-1">Administración</p>
          <h1 className="section-title">Profesores</h1>
        </div>
        {!showNew && (
          <button onClick={() => setShowNew(true)} className="btn-inalde-primary">+ Nuevo</button>
        )}
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 whitespace-pre-line ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {/* ====== Carga masiva desde Excel ====== */}
      <details className="mb-8 border border-inalde-gray-light rounded">
        <summary className="cursor-pointer px-4 py-3 bg-inalde-gray-bg font-primary font-semibold text-sm">
          ＋ Cargar lista desde Excel
        </summary>
        <div className="p-5 space-y-4">
          <p className="text-xs text-inalde-text">
            Descarga la plantilla, llénala con los datos de tus profesores y súbela. Si dejas vacía la columna
            <strong> "Clave inicial"</strong>, el sistema generará una clave temporal y te la mostrará al
            terminar la carga (guárdala: solo se muestra una vez).
          </p>
          <button onClick={descargarPlantilla} className="text-sm font-semibold text-inalde-red hover:underline">
            ↓ Descargar plantilla
          </button>
          <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-inalde-gray-light">
            <div>
              <label className="block font-primary font-semibold text-[11px] tracking-wider uppercase text-inalde-gray mb-2">
                Archivo Excel (.xlsx)
              </label>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="text-sm" />
            </div>
            <button onClick={cargarExcel} disabled={busy}
              className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-40">
              {busy ? 'Cargando…' : 'Cargar profesores →'}
            </button>
          </div>
          {bulkResult && (
            <div className="mt-3 rounded border border-inalde-gray-light p-3 text-xs">
              <p className="font-semibold mb-2">Resumen de la carga</p>
              <p>{bulkResult.inserted} profesor(es) creado(s).</p>
              {bulkResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-inalde-red font-semibold">Errores ({bulkResult.errors.length}):</p>
                  <ul className="list-disc pl-5 text-inalde-gray">
                    {bulkResult.errors.map((e, i) => <li key={i}>Fila {e.row}: {e.error}</li>)}
                  </ul>
                </div>
              )}
              {bulkResult.claves_generadas && bulkResult.claves_generadas.length > 0 && (
                <div className="mt-3 rounded bg-amber-50 border border-inalde-gold p-3">
                  <p className="font-semibold text-inalde-text mb-2">
                    ⚠ {bulkResult.claves_generadas.length} clave(s) generadas — guárdalas ahora, no se vuelven a mostrar:
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-inalde-gray uppercase tracking-wider">
                        <th className="py-1">Profesor</th>
                        <th className="py-1">Email</th>
                        <th className="py-1">Clave inicial</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResult.claves_generadas.map((c) => (
                        <tr key={c.email} className="border-t border-inalde-gold/40">
                          <td className="py-1">{c.nombre}</td>
                          <td className="py-1">{c.email}</td>
                          <td className="py-1 font-mono">{c.clave}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </details>

      {showNew && (
        <fieldset className="border border-inalde-gray-light rounded p-5 mb-6">
          <legend className="px-2 text-sm font-primary font-semibold text-inalde-red">{form.rol_area ? 'Nuevo usuario de área' : 'Nuevo profesor'}</legend>
          <div className="grid sm:grid-cols-2 gap-4 mt-2">
            <div className="sm:col-span-2">
              <Field label="Tipo de usuario">
                <select value={form.rol_area} onChange={(e) => setForm({ ...form, rol_area: e.target.value as '' | RolArea, es_super_admin: false })} className="input-inalde">
                  <option value="">Profesor (dirige trabajos de grado)</option>
                  {ROLES_AREA.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta} (solo consulta la Programación Interna)</option>)}
                </select>
              </Field>
              {form.rol_area && (
                <p className="text-xs text-inalde-gray mt-1">
                  Entrará al sistema únicamente para consultar y descargar la Programación Interna del evento. No dirige trabajos de grado ni aparece en la sábana de proyectos.
                </p>
              )}
            </div>
            <Field label="Nombre completo">
              <input type="text" value={form.nombre_completo} onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })} className="input-inalde" />
            </Field>
            <Field label="Email institucional">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-inalde" />
            </Field>
            <Field label="Clave temporal">
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input-inalde" placeholder="Min 8 chars, mayúscula, minúscula, número" />
            </Field>
            {!form.rol_area && (
              <>
                <Field label="Booking URL (opcional)">
                  <input type="url" value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} className="input-inalde" placeholder="https://calendly.com/..." />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Áreas de afinidad">
                    <AreasPicker value={form.areas_afinidad} onChange={(next) => setForm({ ...form, areas_afinidad: next })} />
                  </Field>
                </div>
              </>
            )}
            <label className={`flex items-center gap-2 text-sm ${form.rol_area ? 'hidden' : ''}`}>
              <input type="checkbox" checked={form.es_super_admin} onChange={(e) => setForm({ ...form, es_super_admin: e.target.checked })} />
              Es administrador (puede gestionar todo el sistema)
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setShowNew(false)} className="text-sm text-inalde-gray hover:text-inalde-text">Cancelar</button>
            <button onClick={crear} disabled={busy} className="btn-inalde-primary !py-2 !px-4 !text-xs">
              {busy ? 'Creando…' : 'Crear'}
            </button>
          </div>
        </fieldset>
      )}

      {seleccion.size > 0 && (
        <div className="flex items-center justify-between bg-inalde-red/5 border border-inalde-red/30 rounded px-4 py-2 mb-3">
          <span className="text-sm text-inalde-text">{seleccion.size} profesor(es) seleccionado(s)</span>
          <div className="flex gap-2">
            <button onClick={() => setSeleccion(new Set())} className="text-xs text-inalde-gray hover:text-inalde-text">Limpiar</button>
            <button onClick={eliminarMasivo} disabled={busy}
              className="text-xs font-semibold bg-inalde-red text-white px-3 py-1.5 rounded hover:bg-inalde-red-hover disabled:opacity-40">
              Eliminar seleccionados
            </button>
          </div>
        </div>
      )}

      <div className="border border-inalde-gray-light rounded overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead className="bg-inalde-gray-bg text-left">
          <tr>
            <th className="px-3 py-2 w-10">
              <input type="checkbox"
                checked={profesores.length > 0 && seleccion.size === profesores.length}
                onChange={toggleSelAll}
                className="accent-inalde-red" />
            </th>
            <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Nombre</th>
            <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Rol</th>
            <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Áreas</th>
            <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Estado</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {profesores.map((p) => (
            editing === p.id ? (
              <>
                <tr key={p.id} className="border-t border-inalde-gray-light bg-inalde-red/5">
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2"><input type="text" value={editDraft.nombre_completo ?? ''} onChange={(e) => setEditDraft({ ...editDraft, nombre_completo: e.target.value })} className="input-inalde !py-1 !text-sm" /></td>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!editDraft.es_super_admin} onChange={(e) => setEditDraft({ ...editDraft, es_super_admin: e.target.checked })} /> super admin</label>
                  </td>
                  <td className="px-3 py-2"><AreasPicker size="compact" value={editDraft.areas_afinidad ?? []} onChange={(next) => setEditDraft({ ...editDraft, areas_afinidad: next })} /></td>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!editDraft.activo} onChange={(e) => setEditDraft({ ...editDraft, activo: e.target.checked })} /> activo</label>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={saveEdit} disabled={busy} className="text-xs font-semibold text-inalde-red mr-2">Guardar</button>
                    <button onClick={() => setEditing(null)} className="text-xs text-inalde-gray">×</button>
                  </td>
                </tr>
                <tr key={`${p.id}-extra`} className="bg-inalde-red/5 border-b-2 border-inalde-red/30">
                  <td></td>
                  <td colSpan={5} className="px-3 pb-4 pt-2">
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-primary font-semibold text-[10px] tracking-wider uppercase text-inalde-gray mb-1">Email institucional</label>
                        <input type="email" value={editDraft.email ?? ''}
                          onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })}
                          className="input-inalde !py-1 !text-sm w-full"
                          placeholder="docente@inalde.edu.co" />
                      </div>
                      <div>
                        <label className="block font-primary font-semibold text-[10px] tracking-wider uppercase text-inalde-gray mb-1">Booking URL (opcional)</label>
                        <input type="url" value={editDraft.booking_url ?? ''}
                          onChange={(e) => setEditDraft({ ...editDraft, booking_url: e.target.value })}
                          className="input-inalde !py-1 !text-sm w-full"
                          placeholder="https://calendly.com/..." />
                      </div>
                      <div>
                        <label className="block font-primary font-semibold text-[10px] tracking-wider uppercase text-inalde-gray mb-1">
                          Resetear clave <span className="normal-case text-inalde-gray italic">(dejar vacío para no cambiar)</span>
                        </label>
                        <input type="password" value={editDraft.password ?? ''}
                          onChange={(e) => setEditDraft({ ...editDraft, password: e.target.value })}
                          className="input-inalde !py-1 !text-sm w-full"
                          placeholder="Min 8 chars · mayúscula · minúscula · número"
                          autoComplete="new-password" />
                      </div>
                    </div>
                  </td>
                </tr>
              </>
            ) : (
              <tr key={p.id} className="border-t border-inalde-gray-light">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={seleccion.has(p.id)}
                    onChange={() => toggleSel(p.id)}
                    className="accent-inalde-red" />
                </td>
                <td className="px-3 py-2 font-medium">{p.nombre_completo}</td>
                <td className="px-3 py-2">
                  {p.es_super_admin
                    ? <span className="text-xs uppercase tracking-wider font-semibold text-inalde-red">Administrador</span>
                    : p.tipo === 'area'
                      ? <span className="text-xs uppercase tracking-wider font-semibold text-inalde-blue">Área</span>
                      : <span className="text-xs text-inalde-gray">Profesor</span>}
                </td>
                <td className="px-3 py-2 text-xs text-inalde-gray">
                  {p.tipo === 'area' ? <span className="italic">Programación Interna</span> : (p.areas_afinidad.join(', ') || '—')}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs uppercase tracking-wider font-semibold ${p.activo ? 'text-inalde-blue' : 'text-inalde-gray'}`}>
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button onClick={() => { setEditing(p.id); setEditDraft({ ...p, areas_afinidad: sanitizeAreas(p.areas_afinidad) }); }} className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover mr-3">Editar</button>
                  <button
                    onClick={() => toggleActivo(p)}
                    disabled={busy}
                    className={`text-xs font-semibold ${p.activo ? 'text-inalde-gray hover:text-inalde-red' : 'text-inalde-blue hover:text-inalde-blue/80'}`}
                  >
                    {p.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                </td>
              </tr>
            )
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">{label}</label>
      {children}
    </div>
  );
}
