import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; participantes_count: number; activa: boolean; }
type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';

interface Participante {
  id: string;
  cohorte_id: string;
  nombre_completo: string;
  cedula: string;
  email: string;
  estado: string;
  tipo_trabajo_grado: Modalidad | null;
  en_equipo: boolean;
}

export default function Participantes() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorteUpload, setCohorteUpload] = useState('');
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [filtroNombre, setFiltroNombre] = useState('');
  const [filtroCohorte, setFiltroCohorte] = useState<string>('todas');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ nombre_completo: string; cedula: string; email: string; cohorte_id: string; modalidad: Modalidad | '' }>({ nombre_completo: '', cedula: '', email: '', cohorte_id: '', modalidad: '' });

  async function loadCohortes() {
    const { data } = await api.get('/admin/cohortes');
    setCohortes(data);
    return data as Cohorte[];
  }
  async function loadParticipantes() {
    try {
      const { data } = await api.get('/admin/participantes');
      setParticipantes(data);
    } catch (e: any) { setErr(formatBackendError(e)); }
  }

  useEffect(() => { (async () => {
    const cs = await loadCohortes();
    const activas = cs.filter((c) => c.activa);
    setCohorteUpload(activas.find((c) => c.participantes_count === 0)?.id ?? activas[0]?.id ?? '');
    await loadParticipantes();
  })(); }, []);

  const cohortesActivas = useMemo(() => cohortes.filter((c) => c.activa), [cohortes]);
  const activasIds = useMemo(() => new Set(cohortesActivas.map((c) => c.id)), [cohortesActivas]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());

  const cohorteEtiquetas = useMemo(() => {
    const m = new Map<string, string>();
    cohortes.forEach((c) => m.set(c.id, c.etiqueta));
    return m;
  }, [cohortes]);

  const filtrados = useMemo(() => {
    const q = filtroNombre.trim().toLowerCase();
    return participantes.filter((p) => {
      // Solo cohortes activas (las inactivas se ocultan completamente)
      if (!activasIds.has(p.cohorte_id)) return false;
      if (filtroCohorte !== 'todas' && p.cohorte_id !== filtroCohorte) return false;
      if (!q) return true;
      return p.nombre_completo.toLowerCase().includes(q)
        || p.cedula.toLowerCase().includes(q)
        || p.email.toLowerCase().includes(q);
    });
  }, [participantes, filtroNombre, filtroCohorte, activasIds]);

  const seleccionadosVisibles = useMemo(
    () => filtrados.filter((p) => seleccionados.has(p.id) && !p.en_equipo),
    [filtrados, seleccionados],
  );

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function seleccionarTodosVisibles(on: boolean) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      filtrados.forEach((p) => {
        if (p.en_equipo) return; // no se pueden borrar
        if (on) next.add(p.id); else next.delete(p.id);
      });
      return next;
    });
  }

  const [confirmandoBulk, setConfirmandoBulk] = useState(false);
  const [textoConfirmacion, setTextoConfirmacion] = useState('');
  const [borrandoBulk, setBorrandoBulk] = useState(false);

  function abrirConfirmacionBulk() {
    if (seleccionadosVisibles.length === 0) return;
    setTextoConfirmacion('');
    setConfirmandoBulk(true);
  }

  async function ejecutarBorradoBulk() {
    const ids = seleccionadosVisibles.map((p) => p.id);
    if (ids.length === 0) return;
    setErr(null); setMsg(null);
    setBorrandoBulk(true);
    try {
      const { data } = await api.post('/admin/participantes/bulk-delete', { ids });
      setMsg(`${data.borrados} participante(s) eliminados${data.fallos?.length ? `, ${data.fallos.length} fallaron` : ''}.`);
      setSeleccionados(new Set());
      setConfirmandoBulk(false);
      await loadParticipantes();
      await loadCohortes();
    } catch (e: any) {
      setErr(formatBackendError(e));
    } finally { setBorrandoBulk(false); }
  }

  async function upload() {
    setErr(null); setResult(null); setMsg(null);
    if (!cohorteUpload) { setErr('Selecciona una cohorte'); return; }
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr('Selecciona un archivo Excel (.xlsx)'); return; }
    const fd = new FormData();
    fd.append('cohorte_id', cohorteUpload);
    fd.append('file', file);
    setBusy(true);
    try {
      const { data } = await api.post('/admin/participantes/cargar-excel', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
      await loadCohortes();
      await loadParticipantes();
    } catch (e: any) {
      setErr(formatBackendError(e));
    } finally { setBusy(false); }
  }

  function startEdit(p: Participante) {
    setEditId(p.id);
    setEditDraft({
      nombre_completo: p.nombre_completo,
      cedula: p.cedula,
      email: p.email,
      cohorte_id: p.cohorte_id,
      modalidad: (p.tipo_trabajo_grado ?? '') as Modalidad | '',
    });
    setErr(null); setMsg(null);
  }
  async function saveEdit() {
    if (!editId) return;
    const original = participantes.find((p) => p.id === editId);
    const payload: any = {};
    if (original?.nombre_completo !== editDraft.nombre_completo) payload.nombre_completo = editDraft.nombre_completo;
    if (original?.cedula !== editDraft.cedula) payload.cedula = editDraft.cedula;
    if (original?.email !== editDraft.email) payload.email = editDraft.email;
    const modalidadCambio = editDraft.modalidad !== '' && editDraft.modalidad !== (original?.tipo_trabajo_grado ?? '');
    if (Object.keys(payload).length === 0 && !modalidadCambio) { setEditId(null); return; }
    setErr(null);
    try {
      if (Object.keys(payload).length > 0) {
        await api.put(`/admin/participantes/${editId}`, payload);
      }
      if (modalidadCambio) {
        await api.put(`/admin/participantes/${editId}/modalidad`, { modalidad: editDraft.modalidad });
      }
      setMsg(`Participante actualizado.`);
      setEditId(null);
      await loadParticipantes();
    } catch (e: any) {
      setErr(formatBackendError(e));
    }
  }

  async function borrarParticipante(p: Participante) {
    if (p.en_equipo) { setErr(`No se puede borrar a ${p.nombre_completo}: está en un equipo.`); return; }
    if (!confirm(`¿Borrar a "${p.nombre_completo}" (${cohorteEtiquetas.get(p.cohorte_id) ?? p.cohorte_id})? También se eliminará su acceso al sistema.`)) return;
    setErr(null);
    try {
      await api.delete(`/admin/participantes/${p.id}`);
      setMsg(`${p.nombre_completo} eliminado.`);
      await loadParticipantes();
      await loadCohortes();
    } catch (e: any) {
      setErr(formatBackendError(e));
    }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Participantes</h1>
        <p className="text-sm text-inalde-text mt-2">
          Carga listas vía Excel y gestiona los participantes ya cargados. Puedes editar, mover o eliminar registros.
        </p>
      </div>

      {/* ====== Carga masiva ====== */}
      <details className="mb-8 border border-inalde-gray-light rounded">
        <summary className="cursor-pointer px-4 py-3 bg-inalde-gray-bg font-primary font-semibold text-sm">
          ＋ Cargar lista desde Excel
        </summary>
        <div className="p-5 space-y-4">
          <p className="text-xs text-inalde-text">
            Columnas aceptadas (flexible, sin importar mayúsculas/acentos):
          </p>
          <ul className="text-xs text-inalde-text list-disc pl-5 space-y-1">
            <li>
              <strong>Nombre</strong>: <code className="bg-inalde-gray-bg px-1 rounded">Nombre completo</code> en una sola columna,
              <strong> o</strong> <code className="bg-inalde-gray-bg px-1 rounded">Nombre</code> y <code className="bg-inalde-gray-bg px-1 rounded">Apellido</code> en dos (se combinan).
            </li>
            <li><strong>Cédula</strong>: <code className="bg-inalde-gray-bg px-1 rounded">Cedula</code>, <code className="bg-inalde-gray-bg px-1 rounded">CC</code>, <code className="bg-inalde-gray-bg px-1 rounded">Documento</code>, <code className="bg-inalde-gray-bg px-1 rounded">DNI</code>, <code className="bg-inalde-gray-bg px-1 rounded">Identificación</code>.</li>
            <li><strong>Email</strong>: <code className="bg-inalde-gray-bg px-1 rounded">Email</code>, <code className="bg-inalde-gray-bg px-1 rounded">Correo</code>, <code className="bg-inalde-gray-bg px-1 rounded">Correo electrónico</code>.</li>
          </ul>

          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="block font-primary font-semibold text-[11px] tracking-wider uppercase text-inalde-gray mb-2">Cohorte destino</label>
              <select value={cohorteUpload} onChange={(e) => setCohorteUpload(e.target.value)} className="input-inalde">
                {cohortesActivas.length === 0 && <option value="">(no hay cohortes activas)</option>}
                {cohortesActivas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.etiqueta} {c.participantes_count > 0 && `· ${c.participantes_count} ya cargados`}
                  </option>
                ))}
              </select>
              {cohortesActivas.length === 0 && (
                <p className="text-[11px] text-inalde-gray mt-1.5">
                  No hay cohortes activas. Activa una desde la pestaña <em>Cohortes</em>.
                </p>
              )}
            </div>
            <div>
              <label className="block font-primary font-semibold text-[11px] tracking-wider uppercase text-inalde-gray mb-2">Archivo Excel (.xlsx)</label>
              <input ref={fileRef} type="file" accept=".xlsx,.xls"
                className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-inalde-red file:text-white file:font-semibold hover:file:bg-inalde-red-hover" />
            </div>
          </div>

          <button onClick={upload} disabled={busy} className="btn-inalde-primary !py-2 !px-4 !text-xs">
            {busy ? 'Procesando…' : 'Cargar →'}
          </button>

          {result && (
            <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm">
              <p className="font-semibold mb-1">Carga completada</p>
              <p>Insertados / actualizados: <strong>{result.inserted}</strong></p>
              {result.errors?.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer">{result.errors.length} errores</summary>
                  <ul className="mt-2 text-xs">{result.errors.map((e: any, i: number) => <li key={i}>Fila {e.row}: {e.error}</li>)}</ul>
                </details>
              )}
              {result.nota && <p className="text-xs text-inalde-gray mt-2">{result.nota}</p>}
            </div>
          )}
        </div>
      </details>

      {/* ====== Mensajes ====== */}
      {msg && <div className="mb-4 rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm">{msg}</div>}
      {err && <div className="mb-4 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">{err}</div>}

      {/* ====== Listado global ====== */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex-1 min-w-[240px]">
          <label className="block font-primary font-semibold text-[11px] tracking-wider uppercase text-inalde-gray mb-1">Buscar</label>
          <input type="text" placeholder="Nombre, cédula o email…"
            value={filtroNombre} onChange={(e) => setFiltroNombre(e.target.value)}
            className="input-inalde !py-2" />
        </div>
        <div>
          <label className="block font-primary font-semibold text-[11px] tracking-wider uppercase text-inalde-gray mb-1">Cohorte</label>
          <select value={filtroCohorte} onChange={(e) => setFiltroCohorte(e.target.value)} className="input-inalde !py-2">
            <option value="todas">Todas</option>
            {cohortesActivas.map((c) => (
              <option key={c.id} value={c.id}>{c.etiqueta}</option>
            ))}
          </select>
        </div>
      </div>

      {seleccionadosVisibles.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3">
          <p className="text-sm text-inalde-text">
            <strong>{seleccionadosVisibles.length}</strong> participante(s) seleccionado(s).
          </p>
          <div className="flex gap-3">
            <button onClick={() => setSeleccionados(new Set())} className="text-xs text-inalde-gray hover:text-inalde-text">
              Limpiar selección
            </button>
            <button onClick={abrirConfirmacionBulk} className="btn-inalde-primary !py-1.5 !px-3 !text-xs">
              Borrar {seleccionadosVisibles.length} seleccionado(s)
            </button>
          </div>
        </div>
      )}

      {/* Modal de confirmación de borrado masivo */}
      {confirmandoBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !borrandoBulk && setConfirmandoBulk(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="border-b-[3px] border-inalde-red px-6 py-4">
              <p className="section-subtitle mb-1">Confirmar eliminación</p>
              <h2 className="font-primary font-bold text-xl text-inalde-text">
                ¿Borrar {seleccionadosVisibles.length} participante(s)?
              </h2>
            </div>

            <div className="px-6 py-4 overflow-auto flex-1">
              <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm text-inalde-text mb-4">
                <strong>Esta acción es irreversible.</strong> Se eliminarán de la cohorte y se borrará
                su acceso al sistema (auth user). Si los necesitas otra vez, deberás re-cargarlos.
              </div>

              <p className="text-xs font-primary font-semibold uppercase tracking-wider text-inalde-gray mb-2">
                Participantes a eliminar:
              </p>
              <ul className="text-sm text-inalde-text divide-y divide-inalde-gray-light/60 border border-inalde-gray-light rounded max-h-60 overflow-auto">
                {seleccionadosVisibles.map((p) => (
                  <li key={p.id} className="px-3 py-2 flex justify-between gap-3">
                    <span className="font-medium truncate">{p.nombre_completo}</span>
                    <span className="text-xs text-inalde-gray whitespace-nowrap">
                      {cohorteEtiquetas.get(p.cohorte_id) ?? p.cohorte_id} · {p.cedula}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                  Para confirmar, escribe <code className="bg-inalde-gray-bg px-1 rounded">BORRAR</code>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={textoConfirmacion}
                  onChange={(e) => setTextoConfirmacion(e.target.value)}
                  placeholder="BORRAR"
                  className="input-inalde"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-inalde-gray-light flex gap-3 justify-end">
              <button
                onClick={() => setConfirmandoBulk(false)}
                disabled={borrandoBulk}
                className="text-sm text-inalde-gray hover:text-inalde-text px-4 py-2 disabled:opacity-40">
                Cancelar
              </button>
              <button
                onClick={ejecutarBorradoBulk}
                disabled={borrandoBulk || textoConfirmacion !== 'BORRAR'}
                className="btn-inalde-primary !py-2 !px-5 !text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                {borrandoBulk ? 'Borrando…' : `Borrar ${seleccionadosVisibles.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded border border-inalde-gray-light overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-inalde-gray-bg text-left">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  className="accent-inalde-red"
                  title="Seleccionar todos los visibles"
                  checked={filtrados.length > 0 && filtrados.filter((p) => !p.en_equipo).every((p) => seleccionados.has(p.id))}
                  onChange={(e) => seleccionarTodosVisibles(e.target.checked)}
                />
              </th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Cohorte</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Nombre</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Cédula</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Email</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-inalde-gray italic">Sin participantes que coincidan.</td></tr>
            )}
            {filtrados.map((p) => editId === p.id ? (
              <tr key={p.id} className="border-t border-inalde-gray-light bg-inalde-red/5">
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-xs text-inalde-gray">{cohorteEtiquetas.get(p.cohorte_id) ?? p.cohorte_id}</td>
                <td className="px-3 py-2">
                  <input type="text" value={editDraft.nombre_completo}
                    onChange={(e) => setEditDraft({ ...editDraft, nombre_completo: e.target.value })}
                    className="input-inalde !py-1 !text-sm" />
                </td>
                <td className="px-3 py-2">
                  <input type="text" value={editDraft.cedula}
                    onChange={(e) => setEditDraft({ ...editDraft, cedula: e.target.value.replace(/\D/g, '') })}
                    className="input-inalde !py-1 !text-xs font-mono" />
                </td>
                <td className="px-3 py-2">
                  <input type="email" value={editDraft.email}
                    onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })}
                    className="input-inalde !py-1 !text-xs" />
                </td>
                <td className="px-3 py-2">
                  <select value={editDraft.modalidad}
                    onChange={(e) => setEditDraft({ ...editDraft, modalidad: e.target.value as Modalidad | '' })}
                    className="input-inalde !py-1 !text-xs">
                    <option value="">Sin modalidad</option>
                    <option value="business_plan">Business Plan</option>
                    <option value="caso">Caso</option>
                    <option value="proyecto_investigacion">Proy. investigación</option>
                  </select>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={saveEdit} className="text-xs font-semibold text-inalde-red mr-3">Guardar</button>
                  <button onClick={() => setEditId(null)} className="text-xs text-inalde-gray">×</button>
                </td>
              </tr>
            ) : (
              <tr key={p.id} className={`border-t border-inalde-gray-light ${seleccionados.has(p.id) ? 'bg-inalde-red/5' : ''}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="accent-inalde-red"
                    checked={seleccionados.has(p.id)}
                    disabled={p.en_equipo}
                    title={p.en_equipo ? 'Está en un equipo; no se puede borrar' : 'Seleccionar'}
                    onChange={() => toggleSeleccion(p.id)}
                  />
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="bg-inalde-gold/15 text-inalde-text px-2 py-0.5 rounded font-semibold">
                    {cohorteEtiquetas.get(p.cohorte_id) ?? p.cohorte_id}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium">{p.nombre_completo}</td>
                <td className="px-3 py-2 text-inalde-gray font-mono text-xs">{p.cedula}</td>
                <td className="px-3 py-2 text-inalde-gray text-xs">{p.email}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs uppercase tracking-wider font-semibold ${p.estado === 'activo' ? 'text-inalde-blue' : 'text-inalde-gray'}`}>
                    {p.estado}
                  </span>
                  {p.en_equipo && <span className="text-[10px] ml-2 text-inalde-gold uppercase tracking-wider">· en equipo</span>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(p)} className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover mr-3">Editar</button>
                  <button
                    onClick={() => borrarParticipante(p)}
                    disabled={p.en_equipo}
                    title={p.en_equipo ? 'Está en un equipo; primero quítalo del equipo' : 'Borrar participante'}
                    className="text-xs font-semibold text-inalde-gray hover:text-inalde-red disabled:opacity-40 disabled:cursor-not-allowed">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
