import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

interface Permiso { code: string; descripcion: string; categoria: string; }
interface Rol { id: string; nombre: string; descripcion: string | null; es_sistema: boolean; permisos: string[]; }
interface UserRow { tipo: 'profesor' | 'participante'; auth_user_id: string; nombre_completo: string; activo?: boolean; estado?: string; cohorte_id?: string; roles: Array<{ id: string; nombre: string }>; }

type Tab = 'roles' | 'usuarios';

export default function RolesPermisos() {
  const [tab, setTab] = useState<Tab>('roles');
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [usuarios, setUsuarios] = useState<{ profesores: UserRow[]; participantes: UserRow[] }>({ profesores: [], participantes: [] });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingRol, setEditingRol] = useState<string | null>(null);
  const [draftPermisos, setDraftPermisos] = useState<Set<string>>(new Set());
  const [draftDesc, setDraftDesc] = useState('');
  const [showNewRol, setShowNewRol] = useState(false);
  const [newRol, setNewRol] = useState({ nombre: '', descripcion: '', permisos: new Set<string>() });
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [draftUserRoles, setDraftUserRoles] = useState<Set<string>>(new Set());

  const permisosByCategoria = useMemo(() => {
    const groups: Record<string, Permiso[]> = {};
    for (const p of permisos) (groups[p.categoria] ||= []).push(p);
    return groups;
  }, [permisos]);

  async function load() {
    setBusy(true);
    try {
      const [p, r, u] = await Promise.all([
        api.get('/admin/roles/permisos'),
        api.get('/admin/roles'),
        api.get('/admin/roles/usuarios'),
      ]);
      setPermisos(p.data);
      setRoles(r.data);
      setUsuarios(u.data);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  function startEditRol(r: Rol) {
    setEditingRol(r.id);
    setDraftPermisos(new Set(r.permisos));
    setDraftDesc(r.descripcion ?? '');
    setMsg(null);
  }

  async function saveRol(id: string) {
    setBusy(true); setMsg(null);
    try {
      await api.put(`/admin/roles/${id}`, { descripcion: draftDesc || null, permisos: Array.from(draftPermisos) });
      setMsg({ kind: 'ok', text: 'Rol actualizado.' });
      setEditingRol(null);
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  async function crearRol() {
    if (!newRol.nombre) return;
    setBusy(true); setMsg(null);
    try {
      await api.post('/admin/roles', {
        nombre: newRol.nombre,
        descripcion: newRol.descripcion || undefined,
        permisos: Array.from(newRol.permisos),
      });
      setMsg({ kind: 'ok', text: `Rol ${newRol.nombre} creado.` });
      setShowNewRol(false);
      setNewRol({ nombre: '', descripcion: '', permisos: new Set() });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  async function eliminarRol(r: Rol) {
    if (r.es_sistema) return;
    if (!confirm(`¿Eliminar el rol "${r.nombre}"? Los usuarios que lo tengan lo perderán.`)) return;
    setBusy(true); setMsg(null);
    try {
      await api.delete(`/admin/roles/${r.id}`);
      setMsg({ kind: 'ok', text: `Rol ${r.nombre} eliminado.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  function startEditUser(u: UserRow) {
    setEditingUser(u.auth_user_id);
    setDraftUserRoles(new Set(u.roles.map((r) => r.id)));
    setMsg(null);
  }

  async function saveUserRoles(authUserId: string) {
    setBusy(true); setMsg(null);
    try {
      await api.post('/admin/roles/usuarios/asignar', { auth_user_id: authUserId, roles: Array.from(draftUserRoles) });
      setMsg({ kind: 'ok', text: 'Roles del usuario actualizados.' });
      setEditingUser(null);
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Roles y permisos</h1>
        <p className="text-sm text-inalde-gray mt-2">
          Define quién puede hacer qué. Los 3 roles base (super_admin, profesor, participante) no se pueden eliminar.
        </p>
      </div>

      <div className="flex gap-2 mb-6 p-1 bg-inalde-gray-bg rounded w-max">
        {(['roles', 'usuarios'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded text-xs font-primary font-semibold uppercase tracking-wider transition ${
              tab === t ? 'bg-white text-inalde-red shadow' : 'text-inalde-gray hover:text-inalde-text'
            }`}>{t === 'roles' ? 'Roles' : 'Asignar a usuarios'}</button>
        ))}
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {/* === TAB ROLES === */}
      {tab === 'roles' && (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowNewRol(true)} className="btn-inalde-primary !py-2 !px-4 !text-xs">+ Nuevo rol</button>
          </div>

          {showNewRol && (
            <fieldset className="border-2 border-inalde-red rounded p-5 mb-6">
              <legend className="px-2 text-sm font-primary font-semibold text-inalde-red">Nuevo rol custom</legend>
              <div className="grid sm:grid-cols-2 gap-4 mt-2 mb-4">
                <div>
                  <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">
                    Nombre técnico (sin espacios)
                  </label>
                  <input type="text" value={newRol.nombre}
                    onChange={(e) => setNewRol({ ...newRol, nombre: e.target.value })}
                    placeholder="coordinador"
                    pattern="[a-z_][a-z0-9_]*"
                    className="input-inalde !text-sm" />
                </div>
                <div>
                  <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">
                    Descripción
                  </label>
                  <input type="text" value={newRol.descripcion}
                    onChange={(e) => setNewRol({ ...newRol, descripcion: e.target.value })}
                    placeholder="Coordinador académico de cohortes"
                    className="input-inalde !text-sm" />
                </div>
              </div>
              <p className="section-subtitle mb-3">Permisos</p>
              <PermisosGrid groups={permisosByCategoria} selected={newRol.permisos}
                onToggle={(code) => {
                  const next = new Set(newRol.permisos);
                  next.has(code) ? next.delete(code) : next.add(code);
                  setNewRol({ ...newRol, permisos: next });
                }} />
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowNewRol(false)} className="text-sm text-inalde-gray hover:text-inalde-text">Cancelar</button>
                <button onClick={crearRol} disabled={busy || !newRol.nombre} className="btn-inalde-primary !py-2 !px-4 !text-xs">Crear rol</button>
              </div>
            </fieldset>
          )}

          <div className="space-y-4">
            {roles.map((r) => (
              <div key={r.id} className="border border-inalde-gray-light rounded">
                <div className="flex items-center justify-between p-4 bg-inalde-gray-bg">
                  <div>
                    <h3 className="font-primary font-bold flex items-center gap-2">
                      {r.nombre}
                      {r.es_sistema && <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 bg-inalde-red text-white rounded">Sistema</span>}
                    </h3>
                    <p className="text-xs text-inalde-gray mt-1">{r.descripcion ?? <em>(sin descripción)</em>} · {r.permisos.length} permisos</p>
                  </div>
                  <div className="flex gap-2">
                    {editingRol === r.id ? (
                      <>
                        <button onClick={() => setEditingRol(null)} className="text-sm text-inalde-gray hover:text-inalde-text">Cancelar</button>
                        <button onClick={() => saveRol(r.id)} disabled={busy} className="btn-inalde-primary !py-2 !px-4 !text-xs">Guardar</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEditRol(r)} className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover">Editar</button>
                        {!r.es_sistema && (
                          <button onClick={() => eliminarRol(r)} className="text-xs text-inalde-gray hover:text-inalde-red">Eliminar</button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {editingRol === r.id ? (
                  <div className="p-4">
                    <Field label="Descripción">
                      <input type="text" value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} className="input-inalde !text-sm" />
                    </Field>
                    <p className="section-subtitle mt-4 mb-3">Permisos</p>
                    <PermisosGrid groups={permisosByCategoria} selected={draftPermisos}
                      onToggle={(code) => {
                        const next = new Set(draftPermisos);
                        next.has(code) ? next.delete(code) : next.add(code);
                        setDraftPermisos(next);
                      }} />
                  </div>
                ) : (
                  <div className="p-4 flex flex-wrap gap-1.5">
                    {r.permisos.length === 0 && <span className="text-xs text-inalde-gray italic">Sin permisos</span>}
                    {r.permisos.map((p) => (
                      <span key={p} className="text-[11px] font-mono bg-inalde-gray-bg px-2 py-0.5 rounded text-inalde-text">{p}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* === TAB USUARIOS === */}
      {tab === 'usuarios' && (
        <>
          <h2 className="section-subtitle mb-3">Profesores ({usuarios.profesores.length})</h2>
          <UserList users={usuarios.profesores} roles={roles} editing={editingUser} draft={draftUserRoles}
            setDraft={setDraftUserRoles} onEdit={startEditUser}
            onSave={saveUserRoles} onCancel={() => setEditingUser(null)} busy={busy} />

          <h2 className="section-subtitle mt-8 mb-3">Participantes ({usuarios.participantes.length})</h2>
          <UserList users={usuarios.participantes} roles={roles} editing={editingUser} draft={draftUserRoles}
            setDraft={setDraftUserRoles} onEdit={startEditUser}
            onSave={saveUserRoles} onCancel={() => setEditingUser(null)} busy={busy} />
        </>
      )}
    </>
  );
}

function PermisosGrid({ groups, selected, onToggle }: {
  groups: Record<string, Permiso[]>; selected: Set<string>; onToggle: (code: string) => void;
}) {
  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([cat, list]) => (
        <div key={cat}>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gold mb-2">{cat}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {list.map((p) => {
              const checked = selected.has(p.code);
              return (
                <label key={p.code}
                  className={`flex items-start gap-2 p-2 rounded border cursor-pointer text-sm transition ${
                    checked ? 'border-inalde-red bg-inalde-red/5' : 'border-inalde-gray-light hover:border-inalde-gray'
                  }`}>
                  <input type="checkbox" checked={checked} onChange={() => onToggle(p.code)} className="mt-0.5" />
                  <span>
                    <span className="font-mono text-xs text-inalde-red">{p.code}</span>
                    <span className="block text-xs text-inalde-gray leading-snug">{p.descripcion}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function UserList({ users, roles, editing, draft, setDraft, onEdit, onSave, onCancel, busy }: {
  users: UserRow[]; roles: Rol[];
  editing: string | null; draft: Set<string>; setDraft: (s: Set<string>) => void;
  onEdit: (u: UserRow) => void; onSave: (id: string) => void; onCancel: () => void; busy: boolean;
}) {
  if (users.length === 0) return <p className="text-inalde-gray text-sm">Sin usuarios.</p>;
  return (
    <div className="space-y-2">
      {users.map((u) => (
        <div key={u.auth_user_id} className="border border-inalde-gray-light rounded p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{u.nombre_completo}
                {u.cohorte_id && <span className="text-xs text-inalde-gray ml-2">· {u.cohorte_id}</span>}
                {u.activo === false && <span className="text-xs text-inalde-red ml-2">· inactivo</span>}
                {u.estado && u.estado !== 'activo' && <span className="text-xs text-inalde-gold ml-2">· {u.estado}</span>}
              </p>
              {editing !== u.auth_user_id && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {u.roles.length === 0 && <span className="text-xs text-inalde-gray italic">Sin roles</span>}
                  {u.roles.map((r) => (
                    <span key={r.id} className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 bg-inalde-blue/10 text-inalde-blue rounded">{r.nombre}</span>
                  ))}
                </div>
              )}
            </div>
            {editing === u.auth_user_id ? (
              <div className="flex gap-2">
                <button onClick={onCancel} className="text-xs text-inalde-gray">Cancelar</button>
                <button onClick={() => onSave(u.auth_user_id)} disabled={busy} className="btn-inalde-primary !py-1 !px-3 !text-[10px]">Guardar</button>
              </div>
            ) : (
              <button onClick={() => onEdit(u)} className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover">Editar roles</button>
            )}
          </div>
          {editing === u.auth_user_id && (
            <div className="mt-3 grid sm:grid-cols-2 gap-1.5">
              {roles.map((r) => {
                const checked = draft.has(r.id);
                return (
                  <label key={r.id} className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm transition ${
                    checked ? 'border-inalde-red bg-inalde-red/5' : 'border-inalde-gray-light hover:border-inalde-gray'
                  }`}>
                    <input type="checkbox" checked={checked} onChange={() => {
                      const next = new Set(draft);
                      next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                      setDraft(next);
                    }} />
                    <span>
                      <span className="font-medium text-sm">{r.nombre}</span>
                      <span className="text-xs text-inalde-gray block">{r.descripcion ?? '—'}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
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
