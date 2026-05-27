import { useEffect, useRef, useState } from 'react';
import { api, downloadFile } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { AreasPicker } from '../../components/inalde/AreasPicker';
import { AREAS_AFINIDAD } from '../../lib/areas';

const AREAS_SET = new Set<string>(AREAS_AFINIDAD);
function sanitizeAreas(input: string[] | undefined | null): string[] {
  return (input ?? []).filter((a) => AREAS_SET.has(a));
}

interface Director {
  id: string;
  nombre_completo: string;
  email: string;
  estado: 'activo' | 'inactivo';
  areas_afinidad: string[];
  created_at: string;
}

export default function Directores() {
  const [items, setItems] = useState<Director[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<{ nombre_completo: string; email: string; areas_afinidad: string[] }>({
    nombre_completo: '', email: '', areas_afinidad: [],
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Director>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ inserted: number; duplicados: number; errors: Array<{ row: number; error: string }> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function descargarPlantilla() {
    try {
      await downloadFile('/directores/plantilla', 'plantilla-directores.xlsx');
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
      const { data } = await api.post('/directores/cargar-excel', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setBulkResult(data);
      setMsg({ kind: 'ok', text: `Carga finalizada: ${data.inserted} director(es) creado(s)${data.duplicados ? `, ${data.duplicados} duplicado(s) omitido(s)` : ''}.` });
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function load() {
    try { setItems((await api.get('/directores')).data); }
    catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }
  useEffect(() => { load(); }, []);

  async function crear() {
    setBusy(true); setMsg(null);
    try {
      await api.post('/directores', {
        nombre_completo: form.nombre_completo,
        email: form.email,
        areas_afinidad: form.areas_afinidad,
      });
      setMsg({ kind: 'ok', text: `Director ${form.nombre_completo} creado.` });
      setShowNew(false);
      setForm({ nombre_completo: '', email: '', areas_afinidad: [] });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true); setMsg(null);
    try {
      const payload: any = {
        nombre_completo: editDraft.nombre_completo,
        estado: editDraft.estado,
        areas_afinidad: editDraft.areas_afinidad,
      };
      // El email se manda solo si el admin lo cambió (campo controlado abajo)
      if (editDraft.email !== undefined && editDraft.email !== '') payload.email = editDraft.email;
      await api.put(`/directores/${editing}`, payload);
      setMsg({ kind: 'ok', text: 'Director actualizado.' });
      setEditing(null);
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function toggleEstado(d: Director) {
    const accion = d.estado === 'activo' ? 'desactivar' : 'reactivar';
    if (!confirm(`¿${accion[0].toUpperCase() + accion.slice(1)} a ${d.nombre_completo}?`)) return;
    setBusy(true); setMsg(null);
    try {
      await api.put(`/directores/${d.id}`, { estado: d.estado === 'activo' ? 'inactivo' : 'activo' });
      setMsg({ kind: 'ok', text: `${d.nombre_completo} ${d.estado === 'activo' ? 'desactivado' : 'reactivado'}.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function eliminar(d: Director) {
    if (!confirm(`¿Borrar a ${d.nombre_completo}? Esta acción es irreversible.`)) return;
    setBusy(true); setMsg(null);
    try {
      await api.delete(`/directores/${d.id}`);
      setMsg({ kind: 'ok', text: `${d.nombre_completo} eliminado.` });
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
          <h1 className="section-title">Directores</h1>
          <p className="text-sm text-inalde-gray mt-2">
            Lista de directores para Caso y Proyecto de Investigación. No ingresan al sistema:
            reciben notificaciones por correo cuando un participante los selecciona y carga su anteproyecto.
          </p>
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
            Descarga la plantilla, llénala con los datos de tus directores y súbela. Las áreas de afinidad son
            opcionales y deben ir separadas por comas.
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
              {busy ? 'Cargando…' : 'Cargar directores →'}
            </button>
          </div>
          {bulkResult && (
            <div className="mt-3 rounded border border-inalde-gray-light p-3 text-xs">
              <p className="font-semibold mb-2">Resumen de la carga</p>
              <p>{bulkResult.inserted} director(es) creado(s).</p>
              {bulkResult.duplicados > 0 && (
                <p className="text-inalde-gray">{bulkResult.duplicados} duplicado(s) omitido(s) (ya existían en el sistema).</p>
              )}
              {bulkResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-inalde-red font-semibold">Errores ({bulkResult.errors.length}):</p>
                  <ul className="list-disc pl-5 text-inalde-gray">
                    {bulkResult.errors.map((e, i) => <li key={i}>Fila {e.row}: {e.error}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </details>

      {showNew && (
        <fieldset className="border border-inalde-gray-light rounded p-5 mb-6">
          <legend className="px-2 text-sm font-primary font-semibold text-inalde-red">Nuevo director</legend>
          <div className="grid sm:grid-cols-2 gap-4 mt-2">
            <Field label="Nombre completo">
              <input type="text" value={form.nombre_completo}
                onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })}
                className="input-inalde" />
            </Field>
            <Field label="Email institucional">
              <input type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input-inalde" placeholder="director@inalde.edu.co" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Áreas de afinidad (opcional)">
                <AreasPicker value={form.areas_afinidad}
                  onChange={(next) => setForm({ ...form, areas_afinidad: next })} />
              </Field>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setShowNew(false)} className="text-sm text-inalde-gray hover:text-inalde-text">Cancelar</button>
            <button onClick={crear} disabled={busy || !form.nombre_completo || !form.email}
              className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-40">
              {busy ? 'Creando…' : 'Crear'}
            </button>
          </div>
        </fieldset>
      )}

      <div className="border border-inalde-gray-light rounded overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="bg-inalde-gray-bg text-left">
            <tr>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Nombre</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Email</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Áreas</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              editing === d.id ? (
                <tr key={d.id} className="border-t border-inalde-gray-light bg-inalde-red/5">
                  <td className="px-3 py-2">
                    <input type="text" value={editDraft.nombre_completo ?? ''}
                      onChange={(e) => setEditDraft({ ...editDraft, nombre_completo: e.target.value })}
                      className="input-inalde !py-1 !text-sm" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="email" value={editDraft.email ?? ''}
                      onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })}
                      className="input-inalde !py-1 !text-sm" />
                  </td>
                  <td className="px-3 py-2">
                    <AreasPicker size="compact"
                      value={editDraft.areas_afinidad ?? []}
                      onChange={(next) => setEditDraft({ ...editDraft, areas_afinidad: next })} />
                  </td>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={editDraft.estado === 'activo'}
                        onChange={(e) => setEditDraft({ ...editDraft, estado: e.target.checked ? 'activo' : 'inactivo' })} />
                      activo
                    </label>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={saveEdit} disabled={busy} className="text-xs font-semibold text-inalde-red mr-2">Guardar</button>
                    <button onClick={() => setEditing(null)} className="text-xs text-inalde-gray">×</button>
                  </td>
                </tr>
              ) : (
                <tr key={d.id} className="border-t border-inalde-gray-light">
                  <td className="px-3 py-2 font-medium">{d.nombre_completo}</td>
                  <td className="px-3 py-2 text-xs text-inalde-gray">{d.email}</td>
                  <td className="px-3 py-2 text-xs text-inalde-gray">{d.areas_afinidad?.join(', ') || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs uppercase tracking-wider font-semibold ${d.estado === 'activo' ? 'text-inalde-blue' : 'text-inalde-gray'}`}>
                      {d.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => { setEditing(d.id); setEditDraft({ ...d, areas_afinidad: sanitizeAreas(d.areas_afinidad) }); }}
                      className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover mr-3">
                      Editar
                    </button>
                    <button onClick={() => toggleEstado(d)} disabled={busy}
                      className={`text-xs font-semibold mr-3 ${d.estado === 'activo' ? 'text-inalde-gray hover:text-inalde-red' : 'text-inalde-blue hover:text-inalde-blue/80'}`}>
                      {d.estado === 'activo' ? 'Desactivar' : 'Reactivar'}
                    </button>
                    <button onClick={() => eliminar(d)} disabled={busy}
                      className="text-xs font-semibold text-inalde-gray hover:text-inalde-red">
                      Borrar
                    </button>
                  </td>
                </tr>
              )
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-inalde-gray">Sin directores. Crea el primero con el botón "+ Nuevo".</td></tr>
            )}
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
