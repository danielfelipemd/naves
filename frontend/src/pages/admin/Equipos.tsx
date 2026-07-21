import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; }

interface MiembroLite {
  id: string;
  posicion: number;
  participantes_lista: { id: string; nombre_completo: string; estado: string; perfil_completo_at: string | null };
}
interface Equipo {
  id: string;
  nombre_equipo: string | null;
  cohorte_id: string;
  tipo_trabajo_grado: 'business_plan' | 'caso' | 'proyecto_investigacion';
  creador_id: string;
  miembros_equipo: MiembroLite[];
  anteproyectos: Array<{ id: string; estado: string }>;
}

interface ParticipanteDisponible {
  id: string;
  nombre_completo: string;
  estado: string;
  perfil_completo_at: string | null;
}

const MODALIDAD_LABEL: Record<string, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

export default function AdminEquipos() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [seleccionado, setSeleccionado] = useState<Equipo | null>(null);
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { (async () => {
    const cs = (await api.get('/admin/cohortes')).data as Cohorte[];
    // Solo cohortes activas en el selector (nunca inactivas).
    const activas = cs.filter((c: any) => c.activa);
    setCohortes(activas);
    if (activas.length) setCohorte(activas[0].id);
  })(); }, []);

  async function cargarEquipos() {
    if (!cohorte) { setEquipos([]); return; }
    setLoading(true);
    try {
      const { data } = await api.get('/admin/equipos', { params: { cohorte_id: cohorte } });
      setEquipos(data.equipos ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { cargarEquipos(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cohorte]);

  const filtrados = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return equipos;
    return equipos.filter((e) => {
      const nombre = (e.nombre_equipo || '').toLowerCase();
      if (nombre.includes(f)) return true;
      return e.miembros_equipo.some((m) => (m.participantes_lista?.nombre_completo || '').toLowerCase().includes(f));
    });
  }, [equipos, filtro]);

  async function refetchEquipo(id: string) {
    const { data } = await api.get(`/admin/equipos/${id}`);
    const eq = data.equipo as Equipo;
    setSeleccionado(eq);
    setEquipos((prev) => prev.map((e) => e.id === id ? eq : e));
  }

  async function quitar(eq: Equipo, participanteId: string, nombre: string) {
    if (!confirm(`¿Quitar a ${nombre} del equipo? El participante quedará libre para unirse a otro equipo.`)) return;
    setMsg(null);
    try {
      await api.post(`/admin/equipos/${eq.id}/remover-miembro`, { participante_id: participanteId });
      await refetchEquipo(eq.id);
      setMsg({ kind: 'ok', text: `${nombre} fue retirado del equipo.` });
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Equipos</h1>
        <p className="text-sm text-inalde-gray mt-1">Edita los miembros de cada equipo de la cohorte.</p>
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-4 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex gap-3 mb-6 flex-wrap items-center">
        <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
          <option value="">Selecciona cohorte…</option>
          {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
        </select>
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por equipo o participante…"
          className="input-inalde !py-2 flex-1 min-w-[240px]" />
        <button
          onClick={() => cohorte && setCrearAbierto(true)}
          disabled={!cohorte}
          className="btn-inalde-primary !py-2 !px-4 !text-xs whitespace-nowrap disabled:opacity-40">
          + Crear equipo
        </button>
      </div>

      {loading ? <p className="text-inalde-gray">Cargando equipos…</p> :
       !cohorte ? <p className="text-inalde-gray text-sm">Elige una cohorte para ver sus equipos.</p> :
       filtrados.length === 0 ? <p className="text-inalde-gray text-sm">Sin equipos en esta cohorte.</p> : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtrados.map((eq) => {
            const estadoAnte = eq.anteproyectos?.[0]?.estado;
            return (
              <button key={eq.id} onClick={() => setSeleccionado(eq)}
                className="text-left border border-inalde-gray-light rounded p-4 hover:border-inalde-red transition bg-white">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-primary font-bold text-base">
                    {eq.nombre_equipo
                      || eq.miembros_equipo.slice().sort((a, b) => a.posicion - b.posicion).map((m) => m.participantes_lista?.nombre_completo).filter(Boolean).join(' · ')
                      || <em className="text-inalde-gray">Equipo sin identificar</em>}
                  </h3>
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gold whitespace-nowrap">
                    {MODALIDAD_LABEL[eq.tipo_trabajo_grado] ?? eq.tipo_trabajo_grado}
                  </span>
                </div>
                <p className="text-xs text-inalde-gray mb-2">{eq.miembros_equipo.length} miembro{eq.miembros_equipo.length === 1 ? '' : 's'}{estadoAnte ? ` · anteproyecto ${estadoAnte}` : ''}</p>
                <ul className="text-xs space-y-0.5">
                  {eq.miembros_equipo
                    .slice()
                    .sort((a, b) => a.posicion - b.posicion)
                    .map((m) => (
                      <li key={m.id} className="text-inalde-text">
                        <span className="text-inalde-gray">#{m.posicion}</span>{' '}
                        {m.participantes_lista?.nombre_completo || '(sin nombre)'}
                        {eq.creador_id === m.participantes_lista?.id && (
                          <span className="ml-1 text-[10px] text-inalde-gold uppercase tracking-wider">· creador</span>
                        )}
                      </li>
                    ))}
                  {eq.miembros_equipo.length === 0 && (
                    <li className="text-inalde-gray italic">Equipo sin miembros</li>
                  )}
                </ul>
              </button>
            );
          })}
        </div>
      )}

      {seleccionado && (
        <DetalleEquipo
          equipo={seleccionado}
          cohortes={cohortes}
          onClose={() => setSeleccionado(null)}
          onQuitar={(pid, nombre) => quitar(seleccionado, pid, nombre)}
          onAgregado={() => refetchEquipo(seleccionado.id)}
        />
      )}

      {crearAbierto && (
        <CrearEquipoModal
          cohorteId={cohorte}
          onClose={() => setCrearAbierto(false)}
          onCreado={async () => {
            setCrearAbierto(false);
            setMsg({ kind: 'ok', text: 'Equipo creado correctamente.' });
            await cargarEquipos();
          }}
        />
      )}
    </>
  );
}

function CrearEquipoModal({
  cohorteId, onClose, onCreado,
}: {
  cohorteId: string;
  onClose: () => void;
  onCreado: () => void;
}) {
  type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';
  const [modalidad, setModalidad] = useState<Modalidad>('business_plan');
  const [nombreEquipo, setNombreEquipo] = useState('');
  const [disponibles, setDisponibles] = useState<ParticipanteDisponible[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { (async () => {
    setLoading(true); setError(null); setSeleccionados(new Set());
    try {
      const { data } = await api.get(
        `/admin/cohortes/${cohorteId}/participantes-disponibles`,
        { params: { modalidad } }
      );
      setDisponibles(data.participantes ?? []);
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setLoading(false); }
  })(); }, [cohorteId, modalidad]);

  function toggle(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  }

  async function crear() {
    if (seleccionados.size === 0) return;
    setBusy(true); setError(null);
    try {
      await api.post('/admin/equipos', {
        cohorte_id: cohorteId,
        modalidad,
        nombre_equipo: nombreEquipo.trim() || null,
        miembros_ids: Array.from(seleccionados),
      });
      onCreado();
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setBusy(false); }
  }

  const sel = seleccionados.size;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="border-b-[3px] border-inalde-red px-6 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="section-subtitle mb-1">Administración</p>
            <h2 className="font-primary font-bold text-xl">Crear equipo</h2>
            <p className="text-xs text-inalde-gray mt-1">Cohorte {cohorteId}</p>
          </div>
          <button onClick={onClose} className="text-inalde-gray hover:text-inalde-red text-lg">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-1">Modalidad</label>
            <select value={modalidad} onChange={(e) => setModalidad(e.target.value as Modalidad)} className="input-inalde !py-2 w-full">
              <option value="business_plan">Business Plan</option>
              <option value="caso">Caso</option>
              <option value="proyecto_investigacion">Proyecto de Investigación</option>
            </select>
            <p className="text-[11px] text-inalde-gray mt-1">Solo verás participantes que hayan elegido esta modalidad y aún no pertenezcan a un equipo.</p>
          </div>

          {/* El Business Plan se identifica por el nombre del proyecto (del
              anteproyecto), no por un nombre de equipo (QA #8). Solo Caso/PI usan
              este campo, donde ES el nombre provisional del trabajo. */}
          {modalidad !== 'business_plan' && (
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-1">
                {modalidad === 'caso' ? 'Nombre provisional del caso' : 'Nombre provisional del proyecto de investigación'}
              </label>
              <input value={nombreEquipo} onChange={(e) => setNombreEquipo(e.target.value)}
                placeholder={modalidad === 'caso' ? 'Ej.: Caso Empresa XYZ' : 'Ej.: Investigación en sector salud'}
                className="input-inalde !py-2 w-full" />
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-1">
              Miembros · {sel} seleccionado{sel === 1 ? '' : 's'} (máximo 4)
            </label>
            {loading ? (
              <p className="text-sm text-inalde-gray italic">Cargando participantes disponibles…</p>
            ) : disponibles.length === 0 ? (
              <p className="text-sm text-inalde-gray italic">No hay participantes disponibles para esta modalidad en esta cohorte.</p>
            ) : (
              <div className="border border-inalde-gray-light rounded max-h-64 overflow-y-auto divide-y divide-inalde-gray-light">
                {disponibles.map((p) => {
                  const checked = seleccionados.has(p.id);
                  const disabled = !checked && sel >= 4;
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-inalde-gray-bg/40'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(p.id)} />
                      <span className="flex-1">{p.nombre_completo}</span>
                      {!p.perfil_completo_at && (
                        <span className="text-[10px] text-inalde-gray italic">perfil pendiente</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-3 py-2 text-sm">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded border border-inalde-gray text-inalde-text text-sm hover:border-inalde-red hover:text-inalde-red transition">
              Cancelar
            </button>
            <button onClick={crear} disabled={busy || sel === 0}
              className="btn-inalde-primary !py-2 !px-4 !text-sm disabled:opacity-40">
              {busy ? 'Creando…' : `Crear equipo con ${sel} miembro${sel === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetalleEquipo({
  equipo, onClose, onQuitar, onAgregado,
}: {
  equipo: Equipo;
  cohortes: Cohorte[];
  onClose: () => void;
  onQuitar: (participanteId: string, nombre: string) => void;
  onAgregado: () => void;
}) {
  const [disponibles, setDisponibles] = useState<ParticipanteDisponible[]>([]);
  const [busy, setBusy] = useState(false);
  const [seleccion, setSeleccion] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { (async () => {
    try {
      const { data } = await api.get(
        `/admin/cohortes/${equipo.cohorte_id}/participantes-disponibles`,
        { params: { modalidad: equipo.tipo_trabajo_grado } }
      );
      setDisponibles(data.participantes ?? []);
    } catch (e: any) {
      setError(formatBackendError(e));
    }
  })(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [equipo.id]);

  async function agregar() {
    if (!seleccion) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/equipos/${equipo.id}/agregar-miembro`, { participante_id: seleccion });
      setSeleccion('');
      onAgregado();
      // Quitar de la lista de disponibles
      setDisponibles((prev) => prev.filter((p) => p.id !== seleccion));
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setBusy(false); }
  }

  const lleno = equipo.miembros_equipo.length >= 4;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="border-b-[3px] border-inalde-red px-6 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="section-subtitle mb-1">{MODALIDAD_LABEL[equipo.tipo_trabajo_grado] ?? equipo.tipo_trabajo_grado}</p>
            <h2 className="font-primary font-bold text-xl">
              {equipo.nombre_equipo
                || equipo.miembros_equipo.slice().sort((a, b) => a.posicion - b.posicion).map((m) => m.participantes_lista?.nombre_completo).filter(Boolean).join(' · ')
                || <em className="text-inalde-gray">Equipo sin identificar</em>}
            </h2>
            <p className="text-xs text-inalde-gray mt-1">Cohorte {equipo.cohorte_id}</p>
          </div>
          <button onClick={onClose} className="text-inalde-gray hover:text-inalde-red text-lg">×</button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-2">Miembros ({equipo.miembros_equipo.length} de 4 máx.)</h3>
            <ul className="space-y-2">
              {equipo.miembros_equipo
                .slice()
                .sort((a, b) => a.posicion - b.posicion)
                .map((m) => {
                  const part = m.participantes_lista;
                  const esCreador = equipo.creador_id === part?.id;
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 border border-inalde-gray-light rounded p-3 text-sm">
                      <div>
                        <p className="font-medium text-inalde-text">
                          <span className="text-inalde-gray mr-1">#{m.posicion}</span>
                          {part?.nombre_completo}
                          {esCreador && <span className="ml-2 text-[10px] uppercase tracking-wider text-inalde-gold">creador</span>}
                        </p>
                        {!part?.perfil_completo_at && (
                          <p className="text-[11px] text-inalde-gray italic">Perfil emprendedor pendiente</p>
                        )}
                      </div>
                      <button onClick={() => onQuitar(part!.id, part!.nombre_completo)}
                        className="text-xs text-inalde-red border border-inalde-red rounded px-3 py-1 hover:bg-inalde-red hover:text-white transition">
                        Quitar
                      </button>
                    </li>
                  );
                })}
              {equipo.miembros_equipo.length === 0 && (
                <li className="text-inalde-gray italic text-sm">Equipo sin miembros.</li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-2">Agregar participante</h3>
            {lleno ? (
              <p className="text-sm text-inalde-gray italic">El equipo ya alcanzó el máximo de 4 miembros.</p>
            ) : disponibles.length === 0 ? (
              <p className="text-sm text-inalde-gray italic">
                No hay participantes disponibles en {MODALIDAD_LABEL[equipo.tipo_trabajo_grado]} (todos están en otro equipo o no han elegido modalidad).
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <select value={seleccion} onChange={(e) => setSeleccion(e.target.value)} className="input-inalde !py-2">
                  <option value="">Selecciona un participante…</option>
                  {disponibles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre_completo}{!p.perfil_completo_at ? ' · perfil pendiente' : ''}
                    </option>
                  ))}
                </select>
                <button onClick={agregar} disabled={!seleccion || busy}
                  className="btn-inalde-primary !py-2 !text-sm disabled:opacity-40 self-start">
                  {busy ? 'Agregando…' : 'Agregar al equipo'}
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-3 py-2 text-sm">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
