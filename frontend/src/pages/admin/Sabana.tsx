import { useEffect, useState } from 'react';
import { api, downloadFile } from '../../lib/api';
import { useAuth } from '../../auth/store';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; }
interface Profesor { id: string; nombre_completo: string; areas_afinidad: string[]; }
interface Item {
  equipo_id: string; equipo_nombre: string | null;
  proyecto_id: string; proyecto_nombre: string;
  sector: string | null; ciiu: string | null; tipo: string | null;
  estado_seleccion: string;
  resumen: string;
  miembros: Array<{ nombre: string; posicion: number }>;
}
interface Asignacion { equipo_id: string; profesor_id: string; }

interface FilaResumen {
  numero: number;
  equipo_id: string;
  proyecto_id: string | null;
  nombre_proyecto: string;
  autores: string;
  sector: string | null;
  modalidad: 'business_plan' | 'caso' | 'proyecto_investigacion';
  buscando_socios: boolean | null;
  buscando_asociacion: boolean | null;
  profesor_asignado: string | null;
  director_asignado: string | null;
}

export default function Sabana() {
  const role = useAuth((s) => s.role);
  const isSuperAdmin = useAuth((s) => (s.user?.app_metadata as any)?.es_super_admin === true) || role === 'super_admin';
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [snapshot, setSnapshot] = useState<Item[]>([]);
  const [profesores, setProfesores] = useState<Profesor[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<string, string>>({}); // equipo_id → profesor_id
  const [estadoSabana, setEstadoSabana] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [vista, setVista] = useState<'detalle' | 'resumen'>('resumen');
  const [resumen, setResumen] = useState<FilaResumen[]>([]);
  const [loadingResumen, setLoadingResumen] = useState(false);

  useEffect(() => { (async () => {
    setCohortes((await api.get('/admin/cohortes')).data);
    setProfesores((await api.get('/admin/profesores')).data.filter((p: any) => p.activo));
  })(); }, []);

  async function load() {
    if (!cohorte) return;
    setLoading(true); setMsg(null);
    try {
      const { data } = await api.get(`/sabana/${cohorte}`);
      setSnapshot(data?.snapshot ?? []);
      setEstadoSabana(data?.estado ?? null);
    } catch (e: any) {
      if (e?.response?.status === 404) {
        setSnapshot([]); setEstadoSabana(null);
      } else { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); loadResumen(); }, [cohorte]);

  async function loadResumen() {
    if (!cohorte) { setResumen([]); return; }
    setLoadingResumen(true);
    try {
      const { data } = await api.get(`/sabana/${cohorte}/resumen`);
      setResumen((data?.filas ?? []) as FilaResumen[]);
    } catch {
      setResumen([]);
    } finally { setLoadingResumen(false); }
  }

  // Edit-in-place de los flags (solo super_admin)
  async function actualizarFlag(equipo_id: string, campo: 'buscando_socios' | 'buscando_asociacion', valor: boolean | null) {
    const payload: Record<string, unknown> = {};
    if (campo === 'buscando_socios') payload.buscando_socios = valor;
    else payload.buscando_asociacion_otro_proyecto = valor;
    // Optimistic update
    setResumen((prev) => prev.map((f) => f.equipo_id === equipo_id ? { ...f, [campo]: valor } : f));
    try {
      await api.patch(`/sabana/equipos/${equipo_id}`, payload);
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
      await loadResumen();
    }
  }

  async function generar() {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/sabana/${cohorte}/generar`);
      await load();
      setMsg({ kind: 'ok', text: 'Sábana generada con datos actuales.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function sugerir() {
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post(`/sabana/${cohorte}/sugerir-asignacion`);
      const sugerencias: Array<{ equipo_id: string; top: Array<{ profesor_id: string; score: number }> }> = data.sugerencias ?? [];
      const newAsign = { ...asignaciones };
      for (const s of sugerencias) {
        if (s.top[0] && s.top[0].score > 0 && !newAsign[s.equipo_id]) {
          newAsign[s.equipo_id] = s.top[0].profesor_id;
        }
      }
      setAsignaciones(newAsign);
      setMsg({ kind: 'ok', text: 'Sugerencias aplicadas a equipos sin asignación previa.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function guardarAsignaciones() {
    const list: Asignacion[] = Object.entries(asignaciones)
      .filter(([, pid]) => !!pid)
      .map(([equipo_id, profesor_id]) => ({ equipo_id, profesor_id }));
    if (!list.length) { setMsg({ kind: 'err', text: 'No hay asignaciones para guardar.' }); return; }

    setBusy(true); setMsg(null);
    try {
      await api.post(`/admin/sabanas/${cohorte}/asignar`, { asignaciones: list });
      setMsg({ kind: 'ok', text: `${list.length} asignaciones guardadas.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function comunicar() {
    if (!confirm('Marcar la sábana como comunicada y notificar a los equipos? (envío SMTP real pendiente de configuración)')) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/sabanas/${cohorte}/comunicar`);
      setMsg({ kind: 'ok', text: data.nota ?? 'Comunicada.' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  // Agrupar por equipo
  const equipos = snapshot.reduce((acc, item) => {
    if (!acc[item.equipo_id]) {
      acc[item.equipo_id] = { id: item.equipo_id, nombre: item.equipo_nombre, miembros: item.miembros, proyectos: [] };
    }
    acc[item.equipo_id].proyectos.push(item);
    return acc;
  }, {} as Record<string, { id: string; nombre: string | null; miembros: any[]; proyectos: Item[] }>);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Sábana de proyectos</h1>
        <p className="text-sm text-inalde-gray mt-2">Vista consolidada de todos los anteproyectos enviados de una cohorte. Asigna profesores y comunica.</p>
      </div>

      <div className="flex gap-3 mb-6 items-end">
        <div className="flex-1 max-w-sm">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
            <option value="">Selecciona…</option>
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
        {cohorte && (
          <>
            <button onClick={generar} disabled={busy} className="btn-inalde-primary !py-2 !px-4 !text-xs">
              {snapshot.length ? 'Regenerar' : 'Generar sábana'}
            </button>
            {snapshot.length > 0 && (
              <>
                <button onClick={sugerir} disabled={busy} className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover">Sugerir asignaciones</button>
                <button onClick={guardarAsignaciones} disabled={busy} className="text-xs font-semibold text-inalde-blue hover:text-inalde-red">Guardar asignaciones</button>
                <button onClick={() => downloadFile(`/sabana/${cohorte}/pdf`, `sabana-${cohorte}.pdf`)} disabled={busy} className="text-xs font-semibold text-inalde-text hover:text-inalde-red">↓ PDF</button>
                <button onClick={comunicar} disabled={busy} className="text-xs font-semibold text-inalde-gold hover:text-inalde-red">Comunicar →</button>
              </>
            )}
          </>
        )}
      </div>

      {estadoSabana && (
        <p className="text-xs text-inalde-gray mb-4">
          Estado de la sábana: <span className="font-semibold uppercase tracking-wider text-inalde-text">{estadoSabana}</span>
        </p>
      )}

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {cohorte && (
        <div className="flex gap-2 mb-4 border-b border-inalde-gray-light">
          <button
            onClick={() => setVista('resumen')}
            className={`text-xs font-primary font-semibold uppercase tracking-wider px-3 py-2 -mb-px border-b-2 transition ${vista === 'resumen' ? 'border-inalde-red text-inalde-red' : 'border-transparent text-inalde-gray hover:text-inalde-text'}`}>
            Tabla resumen
          </button>
          <button
            onClick={() => setVista('detalle')}
            className={`text-xs font-primary font-semibold uppercase tracking-wider px-3 py-2 -mb-px border-b-2 transition ${vista === 'detalle' ? 'border-inalde-red text-inalde-red' : 'border-transparent text-inalde-gray hover:text-inalde-text'}`}>
            Detalle por equipo (asignaciones)
          </button>
        </div>
      )}

      {/* === Vista resumen: tabla tipo Base de Datos del CSV institucional === */}
      {vista === 'resumen' && cohorte ? (
        loadingResumen ? <p className="text-inalde-gray">Cargando resumen…</p> :
          resumen.length === 0 ? <p className="text-inalde-gray text-sm">Esta cohorte aún no tiene proyectos cargados.</p> : (
            <div className="rounded border border-inalde-gray-light overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px] table-fixed">
                <colgroup>
                  <col className="w-12" />
                  <col className="w-[22%]" />
                  <col className="w-[24%]" />
                  <col className="w-[14%]" />
                  <col className="w-20" />
                  <col className="w-20" />
                  <col className="w-32" />
                  <col className="w-32" />
                </colgroup>
                <thead className="bg-inalde-gray-bg text-left">
                  <tr>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">#</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Autores</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Proyecto</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Sector</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray" title="¿Está buscando socios?">Socios</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray" title="¿Busca asociación con otro proyecto?">Asoc.</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Modalidad</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Profesor / Director</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.map((f) => (
                    <tr key={`${f.equipo_id}-${f.proyecto_id ?? 'eq'}`} className="border-t border-inalde-gray-light">
                      <td className="px-3 py-2 text-inalde-gray font-mono text-xs">{f.numero}</td>
                      <td className="px-3 py-2 truncate" title={f.autores}>{f.autores || <span className="italic text-inalde-gray">—</span>}</td>
                      <td className="px-3 py-2 font-medium truncate" title={f.nombre_proyecto}>{f.nombre_proyecto}</td>
                      <td className="px-3 py-2 text-inalde-gray truncate" title={f.sector ?? ''}>{f.sector ?? <span className="italic">—</span>}</td>
                      <td className="px-3 py-2 text-xs">
                        {isSuperAdmin ? (
                          <select
                            value={f.buscando_socios === null ? '' : f.buscando_socios ? 'si' : 'no'}
                            onChange={(e) => {
                              const v = e.target.value;
                              actualizarFlag(f.equipo_id, 'buscando_socios', v === '' ? null : v === 'si');
                            }}
                            className="border border-inalde-gray-light rounded px-1 py-0.5 text-xs">
                            <option value="">—</option>
                            <option value="si">SÍ</option>
                            <option value="no">NO</option>
                          </select>
                        ) : (
                          f.buscando_socios === true ? <span className="text-inalde-red font-semibold">SÍ</span> :
                            f.buscando_socios === false ? <span className="text-inalde-gray">NO</span> :
                              <span className="text-inalde-gray italic">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {isSuperAdmin ? (
                          <select
                            value={f.buscando_asociacion === null ? '' : f.buscando_asociacion ? 'si' : 'no'}
                            onChange={(e) => {
                              const v = e.target.value;
                              actualizarFlag(f.equipo_id, 'buscando_asociacion', v === '' ? null : v === 'si');
                            }}
                            className="border border-inalde-gray-light rounded px-1 py-0.5 text-xs">
                            <option value="">—</option>
                            <option value="si">SÍ</option>
                            <option value="no">NO</option>
                          </select>
                        ) : (
                          f.buscando_asociacion === true ? <span className="text-inalde-red font-semibold">SÍ</span> :
                            f.buscando_asociacion === false ? <span className="text-inalde-gray">NO</span> :
                              <span className="text-inalde-gray italic">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        <span className={`uppercase tracking-wider font-semibold ${f.modalidad === 'business_plan' ? 'text-inalde-red' : f.modalidad === 'caso' ? 'text-inalde-gold' : 'text-inalde-blue'}`}>
                          {f.modalidad === 'business_plan' ? 'Business Plan' : f.modalidad === 'caso' ? 'Caso' : 'Proy. Investigación'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-inalde-gray text-xs truncate" title={f.profesor_asignado ?? f.director_asignado ?? ''}>
                        {f.profesor_asignado ?? f.director_asignado ?? <span className="italic">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      ) : null}

      {/* === Vista detalle: original (asignaciones por equipo) === */}
      {vista === 'detalle' && (
      loading ? <p className="text-inalde-gray">Cargando…</p> :
        Object.keys(equipos).length === 0 ? (
          cohorte && (
            <p className="text-inalde-gray text-sm">
              {snapshot.length === 0 && estadoSabana === null
                ? 'La sábana aún no ha sido generada para esta cohorte. Genera para construirla.'
                : 'No hay anteproyectos enviados en esta cohorte.'}
            </p>
          )
        ) : (
          <div className="space-y-3">
            {Object.values(equipos).map((eq) => (
              <div key={eq.id} className="border border-inalde-gray-light rounded p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <h3 className="font-primary font-bold">{eq.nombre ?? '(equipo sin nombre)'}</h3>
                    <p className="text-xs text-inalde-gray mt-1">
                      {eq.miembros.sort((a, b) => a.posicion - b.posicion).map((m) => m.nombre).join(' · ')}
                    </p>
                    <div className="mt-3 space-y-2">
                      {eq.proyectos.map((p) => (
                        <div key={p.proyecto_id} className="text-sm">
                          <p>
                            <span className={`font-semibold ${p.estado_seleccion === 'definitivo' ? 'text-inalde-red' : p.estado_seleccion === 'archivado' ? 'text-inalde-gray line-through' : ''}`}>
                              {p.proyecto_nombre}
                            </span>
                            {p.sector && <span className="text-xs text-inalde-gray ml-2">[{p.sector}]</span>}
                            {p.ciiu && <span className="font-mono text-xs text-inalde-gold ml-2">CIIU {p.ciiu}</span>}
                          </p>
                          <p className="text-xs text-inalde-gray leading-snug">{p.resumen || <em>(sin resumen)</em>}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="w-56">
                    <label className="block text-xs uppercase tracking-wider text-inalde-gray mb-1">Profesor asignado</label>
                    <select
                      value={asignaciones[eq.id] ?? ''}
                      onChange={(e) => setAsignaciones({ ...asignaciones, [eq.id]: e.target.value })}
                      className="input-inalde !py-1 !text-sm"
                    >
                      <option value="">— Sin asignar —</option>
                      {profesores.map((p) => <option key={p.id} value={p.id}>{p.nombre_completo}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </>
  );
}
