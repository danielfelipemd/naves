import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { Modal } from '../../components/inalde/Modal';

interface Permiso { code: string; descripcion: string; categoria: string; }
interface Rol { id: string; nombre: string; descripcion: string | null; es_sistema: boolean; permisos: string[]; }
interface UserRow {
  tipo: 'profesor' | 'participante';
  auth_user_id: string;
  nombre_completo: string;
  activo?: boolean;
  estado?: string;
  cohorte_id?: string;
  roles: Array<{ id: string; nombre: string }>;
}

type Tab = 'roles' | 'usuarios';

const CATEGORIA_LABELS: Record<string, string> = {
  cohortes: 'Cohortes',
  participantes: 'Participantes',
  profesores: 'Profesores',
  anteproyectos: 'Anteproyectos',
  sabana: 'Sábana de anteproyectos',
  solicitudes: 'Solicitudes de desarchivado',
  auditoria: 'Auditoría',
  meta: 'Administración del sistema',
  participante: 'Acciones del estudiante',
};

export default function RolesPermisos() {
  const [tab, setTab] = useState<Tab>('roles');
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [usuarios, setUsuarios] = useState<{ profesores: UserRow[]; participantes: UserRow[] }>({ profesores: [], participantes: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Modal state
  const [rolModal, setRolModal] = useState<{ mode: 'view' | 'edit' | 'new'; rol?: Rol } | null>(null);
  const [userModal, setUserModal] = useState<UserRow | null>(null);

  // Selección masiva
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRolId, setBulkRolId] = useState<string>('');

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function clearSel() { setSelected(new Set()); }

  async function asignarBulk() {
    if (!bulkRolId || selected.size === 0) return;
    const rol = roles.find((r) => r.id === bulkRolId);
    if (!confirm(`Asignar el rol "${rol?.nombre}" a ${selected.size} usuario(s)? No se quitan los roles que ya tengan.`)) return;
    setBusy(true);
    try {
      await api.post('/admin/roles/usuarios/asignar-bulk', {
        auth_user_ids: Array.from(selected),
        rol_id: bulkRolId,
      });
      setMsg({ kind: 'ok', text: `Rol "${rol?.nombre}" asignado a ${selected.size} usuario(s).` });
      clearSel();
      setBulkRolId('');
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

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
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  async function eliminarRol(r: Rol) {
    if (r.es_sistema) return;
    if (!confirm(`¿Eliminar el rol "${r.nombre}"? Los usuarios que lo tengan lo perderán.`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/roles/${r.id}`);
      setMsg({ kind: 'ok', text: `Rol "${r.nombre}" eliminado.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Roles y permisos</h1>
        <p className="text-sm text-inalde-gray mt-2">
          Define qué puede hacer cada rol y asígnalos a los usuarios. Los 3 roles base no se pueden eliminar.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 p-1 bg-inalde-gray-bg rounded w-max">
        {(['roles', 'usuarios'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded text-xs font-primary font-semibold uppercase tracking-wider transition ${
              tab === t ? 'bg-white text-inalde-red shadow' : 'text-inalde-gray hover:text-inalde-text'
            }`}>{t === 'roles' ? `Roles (${roles.length})` : `Usuarios (${usuarios.profesores.length + usuarios.participantes.length})`}</button>
        ))}
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {/* === TABLA DE ROLES === */}
      {tab === 'roles' && (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={() => setRolModal({ mode: 'new' })} className="btn-inalde-primary !py-2 !px-4 !text-xs">
              + Nuevo rol
            </button>
          </div>

          <table className="w-full text-sm border border-inalde-gray-light rounded overflow-hidden">
            <thead className="bg-inalde-gray-bg text-left">
              <tr>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Rol</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Descripción</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray text-center">Permisos</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} className="border-t border-inalde-gray-light hover:bg-inalde-gray-bg/40">
                  <td className="px-3 py-3">
                    <div className="font-medium">{r.nombre}</div>
                    {r.es_sistema && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-inalde-red">Sistema</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-inalde-gray">{r.descripcion ?? <em>(sin descripción)</em>}</td>
                  <td className="px-3 py-3 text-center font-semibold text-inalde-text">{r.permisos.length}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setRolModal({ mode: 'view', rol: r })}
                      className="text-xs text-inalde-gray hover:text-inalde-text mr-3">Ver</button>
                    <button onClick={() => setRolModal({ mode: 'edit', rol: r })}
                      className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover mr-3">Editar</button>
                    {!r.es_sistema && (
                      <button onClick={() => eliminarRol(r)} disabled={busy}
                        className="text-xs text-inalde-gray hover:text-inalde-red">Eliminar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* === TABLA DE USUARIOS === */}
      {tab === 'usuarios' && (
        <>
          {selected.size > 0 && (
            <div className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-3 rounded border-2 border-inalde-red bg-red-50 px-4 py-3 shadow">
              <span className="text-sm">
                <strong className="text-inalde-red">{selected.size}</strong> usuario(s) seleccionados
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={bulkRolId}
                  onChange={(e) => setBulkRolId(e.target.value)}
                  className="input-inalde !py-1.5 !text-sm"
                >
                  <option value="">Elegir rol…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
                <button
                  onClick={asignarBulk}
                  disabled={!bulkRolId || busy}
                  className="btn-inalde-primary !py-1.5 !px-3 !text-xs"
                >
                  Asignar a {selected.size}
                </button>
                <button onClick={clearSel} className="text-xs text-inalde-gray hover:text-inalde-text">
                  Limpiar
                </button>
              </div>
            </div>
          )}

          <h2 className="section-subtitle mb-3">Profesores ({usuarios.profesores.length})</h2>
          <UsersTable
            users={usuarios.profesores}
            selected={selected}
            onToggleSel={toggleSel}
            onEdit={(u) => setUserModal(u)}
          />

          <h2 className="section-subtitle mt-8 mb-3">Participantes ({usuarios.participantes.length})</h2>
          <UsersTable
            users={usuarios.participantes}
            selected={selected}
            onToggleSel={toggleSel}
            onEdit={(u) => setUserModal(u)}
          />
        </>
      )}

      {/* Modal: editar/ver/crear rol */}
      {rolModal && (
        <RolModal
          mode={rolModal.mode}
          rol={rolModal.rol}
          permisosByCategoria={permisosByCategoria}
          onClose={() => setRolModal(null)}
          onSaved={(text) => { setRolModal(null); setMsg({ kind: 'ok', text }); load(); }}
          onError={(text) => setMsg({ kind: 'err', text })}
        />
      )}

      {/* Modal: editar roles de un usuario */}
      {userModal && (
        <UserModal
          user={userModal}
          roles={roles}
          onClose={() => setUserModal(null)}
          onSaved={(text) => { setUserModal(null); setMsg({ kind: 'ok', text }); load(); }}
          onError={(text) => setMsg({ kind: 'err', text })}
        />
      )}
    </>
  );
}

// ============================ Sub-componentes ============================

function UsersTable({ users, selected, onToggleSel, onEdit }: {
  users: UserRow[];
  selected: Set<string>;
  onToggleSel: (id: string) => void;
  onEdit: (u: UserRow) => void;
}) {
  if (users.length === 0) return <p className="text-inalde-gray text-sm">Sin usuarios.</p>;
  const allSelected = users.length > 0 && users.every((u) => selected.has(u.auth_user_id));
  const someSelected = users.some((u) => selected.has(u.auth_user_id));

  function toggleAll() {
    if (allSelected) users.forEach((u) => selected.has(u.auth_user_id) && onToggleSel(u.auth_user_id));
    else users.forEach((u) => !selected.has(u.auth_user_id) && onToggleSel(u.auth_user_id));
  }

  return (
    <table className="w-full text-sm border border-inalde-gray-light rounded overflow-hidden">
      <thead className="bg-inalde-gray-bg text-left">
        <tr>
          <th className="px-3 py-2 w-8">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => el && (el.indeterminate = someSelected && !allSelected)}
              onChange={toggleAll}
              className="h-4 w-4 accent-inalde-red"
            />
          </th>
          <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Nombre</th>
          <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Roles asignados</th>
          <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Estado</th>
          <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray text-right">Acción</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.auth_user_id} className="border-t border-inalde-gray-light hover:bg-inalde-gray-bg/40">
            <td className="px-3 py-3">
              <input
                type="checkbox"
                checked={selected.has(u.auth_user_id)}
                onChange={() => onToggleSel(u.auth_user_id)}
                className="h-4 w-4 accent-inalde-red"
              />
            </td>
            <td className="px-3 py-3">
              <div className="font-medium">{u.nombre_completo}</div>
              {u.cohorte_id && <span className="text-xs text-inalde-gray">{u.cohorte_id}</span>}
            </td>
            <td className="px-3 py-3">
              {u.roles.length === 0 ? (
                <em className="text-xs text-inalde-gray">Sin roles</em>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {u.roles.map((r) => (
                    <span key={r.id} className="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 bg-inalde-blue/10 text-inalde-blue rounded">
                      {r.nombre}
                    </span>
                  ))}
                </div>
              )}
            </td>
            <td className="px-3 py-3">
              {u.activo === false || u.estado === 'desactivado' ? (
                <span className="text-xs uppercase tracking-wider font-semibold text-inalde-gray">Inactivo</span>
              ) : u.estado && u.estado !== 'activo' ? (
                <span className="text-xs uppercase tracking-wider font-semibold text-inalde-gold">{u.estado}</span>
              ) : (
                <span className="text-xs uppercase tracking-wider font-semibold text-inalde-blue">Activo</span>
              )}
            </td>
            <td className="px-3 py-3 text-right">
              <button onClick={() => onEdit(u)}
                className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover">
                Cambiar roles
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RolModal({ mode, rol, permisosByCategoria, onClose, onSaved, onError }: {
  mode: 'view' | 'edit' | 'new';
  rol?: Rol;
  permisosByCategoria: Record<string, Permiso[]>;
  onClose: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [nombre, setNombre] = useState(rol?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(rol?.descripcion ?? '');
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set(rol?.permisos ?? []));
  const [busy, setBusy] = useState(false);
  const isView = mode === 'view';
  const isNew = mode === 'new';

  function toggleAll(cat: string, value: boolean) {
    const next = new Set(seleccionados);
    for (const p of permisosByCategoria[cat] ?? []) {
      value ? next.add(p.code) : next.delete(p.code);
    }
    setSeleccionados(next);
  }

  function toggle(code: string) {
    const next = new Set(seleccionados);
    next.has(code) ? next.delete(code) : next.add(code);
    setSeleccionados(next);
  }

  async function save() {
    setBusy(true);
    try {
      if (isNew) {
        await api.post('/admin/roles', {
          nombre, descripcion: descripcion || undefined, permisos: Array.from(seleccionados),
        });
        onSaved(`Rol "${nombre}" creado.`);
      } else if (rol) {
        await api.put(`/admin/roles/${rol.id}`, {
          descripcion: descripcion || null,
          permisos: Array.from(seleccionados),
        });
        onSaved(`Rol "${rol.nombre}" actualizado.`);
      }
    } catch (e: any) {
      onError(formatBackendError(e));
    } finally { setBusy(false); }
  }

  const totalSeleccionados = seleccionados.size;
  const totalPermisos = Object.values(permisosByCategoria).reduce((s, l) => s + l.length, 0);

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={isNew ? 'Nuevo rol' : (rol?.nombre ?? 'Rol')}
      subtitle={isView ? 'Detalle del rol' : isNew ? 'Crear rol personalizado' : 'Editar rol'}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="text-sm text-inalde-gray hover:text-inalde-text px-4 py-2">
            {isView ? 'Cerrar' : 'Cancelar'}
          </button>
          {!isView && (
            <button onClick={save} disabled={busy || (isNew && !nombre)} className="btn-inalde-primary !py-2 !px-4 !text-xs">
              {busy ? 'Guardando…' : (isNew ? 'Crear rol' : 'Guardar cambios')}
            </button>
          )}
        </>
      }
    >
      {/* Datos básicos */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <Field label="Nombre técnico">
          <input type="text" value={nombre}
            onChange={(e) => setNombre(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            disabled={!isNew}
            placeholder="ej. coordinador"
            className="input-inalde !text-sm disabled:bg-inalde-gray-bg disabled:text-inalde-gray" />
          {isNew && <p className="text-xs text-inalde-gray mt-1">Solo minúsculas, números y guion bajo.</p>}
        </Field>
        <Field label="Descripción">
          <input type="text" value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            disabled={isView}
            placeholder="Coordinador académico de cohortes"
            className="input-inalde !text-sm disabled:bg-inalde-gray-bg disabled:text-inalde-gray" />
        </Field>
      </div>

      {/* Permisos */}
      <div className="flex items-center justify-between mb-3">
        <p className="section-subtitle !mb-0">
          Permisos {!isView && '(marca lo que el rol puede hacer)'}
        </p>
        <span className="text-xs text-inalde-gray font-mono">
          {totalSeleccionados} de {totalPermisos} marcados
        </span>
      </div>

      <div className="space-y-5">
        {Object.entries(permisosByCategoria).map(([cat, list]) => {
          const allChecked = list.every((p) => seleccionados.has(p.code));
          const someChecked = list.some((p) => seleccionados.has(p.code));
          return (
            <fieldset key={cat} className="border border-inalde-gray-light rounded p-4">
              <legend className="px-2 flex items-center gap-2">
                {!isView && (
                  <input type="checkbox" checked={allChecked}
                    ref={(el) => el && (el.indeterminate = someChecked && !allChecked)}
                    onChange={(e) => toggleAll(cat, e.target.checked)}
                    className="h-4 w-4 accent-inalde-red" />
                )}
                <span className="font-primary font-semibold text-sm text-inalde-text">
                  {CATEGORIA_LABELS[cat] ?? cat}
                </span>
              </legend>
              <div className="space-y-1.5">
                {list.map((p) => {
                  const checked = seleccionados.has(p.code);
                  return (
                    <label key={p.code}
                      className={`flex items-start gap-3 px-2 py-1.5 rounded cursor-pointer transition ${
                        isView ? 'cursor-default' : 'hover:bg-inalde-gray-bg/60'
                      }`}>
                      <input type="checkbox" checked={checked}
                        disabled={isView}
                        onChange={() => toggle(p.code)}
                        className="mt-0.5 h-4 w-4 accent-inalde-red disabled:opacity-50" />
                      <span className="flex-1 text-sm leading-snug">{p.descripcion}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </Modal>
  );
}

function UserModal({ user, roles, onClose, onSaved, onError }: {
  user: UserRow;
  roles: Rol[];
  onClose: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set(user.roles.map((r) => r.id)));
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    const next = new Set(seleccionados);
    next.has(id) ? next.delete(id) : next.add(id);
    setSeleccionados(next);
  }

  async function save() {
    setBusy(true);
    try {
      await api.post('/admin/roles/usuarios/asignar', {
        auth_user_id: user.auth_user_id,
        roles: Array.from(seleccionados),
      });
      onSaved(`Roles de ${user.nombre_completo} actualizados.`);
    } catch (e: any) {
      onError(formatBackendError(e));
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={user.nombre_completo}
      subtitle="Cambiar roles"
      footer={
        <>
          <button onClick={onClose} className="text-sm text-inalde-gray hover:text-inalde-text px-4 py-2">Cancelar</button>
          <button onClick={save} disabled={busy} className="btn-inalde-primary !py-2 !px-4 !text-xs">
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <p className="text-sm text-inalde-gray mb-4">
        Marca los roles que este usuario debe tener. Sus permisos efectivos serán la unión de los permisos de todos los roles marcados.
      </p>
      <div className="space-y-2">
        {roles.map((r) => {
          const checked = seleccionados.has(r.id);
          return (
            <label key={r.id}
              className="flex items-start gap-3 px-3 py-2 rounded border border-inalde-gray-light hover:bg-inalde-gray-bg/40 cursor-pointer">
              <input type="checkbox" checked={checked} onChange={() => toggle(r.id)}
                className="mt-1 h-4 w-4 accent-inalde-red" />
              <span className="flex-1">
                <span className="font-medium text-sm">{r.nombre}</span>
                {r.es_sistema && <span className="ml-2 text-[10px] uppercase tracking-wider text-inalde-red font-semibold">Sistema</span>}
                <span className="block text-xs text-inalde-gray">{r.descripcion ?? '—'} · {r.permisos.length} permisos</span>
              </span>
            </label>
          );
        })}
      </div>
    </Modal>
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
