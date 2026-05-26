import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { AreasPicker } from '../../components/inalde/AreasPicker';

interface Profesor {
  id: string;
  nombre_completo: string;
  es_super_admin: boolean;
  activo: boolean;
  booking_url: string | null;
  areas_afinidad: string[];
  ultimo_login: string | null;
}

export default function Profesores() {
  const [profesores, setProfesores] = useState<Profesor[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<{
    nombre_completo: string; email: string; password: string;
    es_super_admin: boolean; booking_url: string; areas_afinidad: string[];
  }>({
    nombre_completo: '', email: '', password: '',
    es_super_admin: false, booking_url: '', areas_afinidad: [],
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Profesor>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    try { setProfesores((await api.get('/admin/profesores')).data); }
    catch (e: any) { setMsg({ kind: 'err', text: e.message }); }
  }
  useEffect(() => { load(); }, []);

  async function crear() {
    setBusy(true); setMsg(null);
    try {
      const payload = {
        ...form,
        booking_url: form.booking_url || null,
      };
      await api.post('/admin/profesores', payload);
      setMsg({ kind: 'ok', text: `Profesor ${form.nombre_completo} creado.` });
      setShowNew(false);
      setForm({ nombre_completo: '', email: '', password: '', es_super_admin: false, booking_url: '', areas_afinidad: [] });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true); setMsg(null);
    try {
      await api.put(`/admin/profesores/${editing}`, {
        nombre_completo: editDraft.nombre_completo,
        es_super_admin: editDraft.es_super_admin,
        activo: editDraft.activo,
        booking_url: editDraft.booking_url || null,
        areas_afinidad: editDraft.areas_afinidad,
      });
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

      {showNew && (
        <fieldset className="border border-inalde-gray-light rounded p-5 mb-6">
          <legend className="px-2 text-sm font-primary font-semibold text-inalde-red">Nuevo profesor</legend>
          <div className="grid sm:grid-cols-2 gap-4 mt-2">
            <Field label="Nombre completo">
              <input type="text" value={form.nombre_completo} onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })} className="input-inalde" />
            </Field>
            <Field label="Email institucional">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-inalde" />
            </Field>
            <Field label="Clave temporal">
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input-inalde" placeholder="Min 8 chars, mayúscula, minúscula, número" />
            </Field>
            <Field label="Booking URL (opcional)">
              <input type="url" value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} className="input-inalde" placeholder="https://calendly.com/..." />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Áreas de afinidad">
                <AreasPicker value={form.areas_afinidad} onChange={(next) => setForm({ ...form, areas_afinidad: next })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
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

      <table className="w-full text-sm border border-inalde-gray-light rounded overflow-hidden">
        <thead className="bg-inalde-gray-bg text-left">
          <tr>
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
              <tr key={p.id} className="border-t border-inalde-gray-light bg-inalde-red/5">
                <td className="px-3 py-2"><input type="text" value={editDraft.nombre_completo ?? ''} onChange={(e) => setEditDraft({ ...editDraft, nombre_completo: e.target.value })} className="input-inalde !py-1 !text-sm" /></td>
                <td className="px-3 py-2">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!editDraft.es_super_admin} onChange={(e) => setEditDraft({ ...editDraft, es_super_admin: e.target.checked })} /> super admin</label>
                </td>
                <td className="px-3 py-2"><AreasPicker size="compact" value={editDraft.areas_afinidad ?? []} onChange={(next) => setEditDraft({ ...editDraft, areas_afinidad: next })} /></td>
                <td className="px-3 py-2">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!editDraft.activo} onChange={(e) => setEditDraft({ ...editDraft, activo: e.target.checked })} /> activo</label>
                </td>
                <td className="px-3 py-2">
                  <button onClick={saveEdit} disabled={busy} className="text-xs font-semibold text-inalde-red mr-2">Guardar</button>
                  <button onClick={() => setEditing(null)} className="text-xs text-inalde-gray">×</button>
                </td>
              </tr>
            ) : (
              <tr key={p.id} className="border-t border-inalde-gray-light">
                <td className="px-3 py-2 font-medium">{p.nombre_completo}</td>
                <td className="px-3 py-2">
                  {p.es_super_admin
                    ? <span className="text-xs uppercase tracking-wider font-semibold text-inalde-red">Administrador</span>
                    : <span className="text-xs text-inalde-gray">Profesor</span>}
                </td>
                <td className="px-3 py-2 text-xs text-inalde-gray">{p.areas_afinidad.join(', ') || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs uppercase tracking-wider font-semibold ${p.activo ? 'text-inalde-blue' : 'text-inalde-gray'}`}>
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button onClick={() => { setEditing(p.id); setEditDraft(p); }} className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover mr-3">Editar</button>
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
