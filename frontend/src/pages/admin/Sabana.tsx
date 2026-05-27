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
  nombre_equipo: string | null;
  autores: string;
  proyectos: Array<{ id: string; nombre: string; sector: string | null; tipo: string | null }>;
  modalidad: 'business_plan' | 'caso' | 'proyecto_investigacion';
  buscando_socios: boolean | null;
  buscando_asociacion: boolean | null;
  profesor_asignado_id: string | null;
  profesor_asignado_nombre: string | null;
  director_asignado_nombre: string | null;
}

/** Pill SÍ / NO / — para celdas readonly */
function Pill({ value }: { value: boolean | null }) {
  if (value === true) return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-inalde-red/10 text-inalde-red text-[11px] font-bold uppercase tracking-wider">SÍ</span>;
  if (value === false) return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-inalde-gray-light/60 text-inalde-gray text-[11px] font-semibold uppercase tracking-wider">NO</span>;
  return <span className="text-inalde-gray italic">—</span>;
}

/** Pill de modalidad con color y full-name */
function ModalidadPill({ modalidad }: { modalidad: 'business_plan' | 'caso' | 'proyecto_investigacion' }) {
  const cfg = {
    business_plan:           { label: 'Business Plan',      cls: 'bg-inalde-red/10 text-inalde-red' },
    caso:                    { label: 'Caso',               cls: 'bg-inalde-gold/15 text-[#8a7530]' },
    proyecto_investigacion:  { label: 'Proy. Investigación', cls: 'bg-blue-100 text-blue-800' },
  } as const;
  const c = cfg[modalidad];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${c.cls}`}>
      {c.label}
    </span>
  );
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
  const [filtroModalidad, setFiltroModalidad] = useState<'todas' | 'business_plan' | 'caso' | 'proyecto_investigacion'>('todas');
  const [filtroBuscar, setFiltroBuscar] = useState('');

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
    setResumen((prev) => prev.map((f) => f.equipo_id === equipo_id ? { ...f, [campo]: valor } : f));
    try {
      await api.patch(`/sabana/equipos/${equipo_id}`, payload);
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
      await loadResumen();
    }
  }

  // Asignacion inline de profesor (solo super_admin, solo BP)
  async function asignarProfesor(equipo_id: string, profesor_id: string | null) {
    const prof = profesores.find((p) => p.id === profesor_id);
    setResumen((prev) => prev.map((f) => f.equipo_id === equipo_id
      ? { ...f, profesor_asignado_id: profesor_id, profesor_asignado_nombre: prof?.nombre_completo ?? null }
      : f));
    try {
      await api.patch(`/sabana/equipos/${equipo_id}`, { profesor_id });
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
          resumen.length === 0 ? <p className="text-inalde-gray text-sm">Esta cohorte aún no tiene proyectos cargados.</p> : (() => {
            // Aplicar filtros
            const q = filtroBuscar.trim().toLowerCase();
            const filtrados = resumen.filter((f) => {
              if (filtroModalidad !== 'todas' && f.modalidad !== filtroModalidad) return false;
              if (!q) return true;
              const hay = [
                f.autores,
                f.nombre_equipo ?? '',
                f.profesor_asignado_nombre ?? '',
                f.director_asignado_nombre ?? '',
                ...f.proyectos.map((p) => `${p.nombre} ${p.sector ?? ''}`),
              ].join(' ').toLowerCase();
              return hay.includes(q);
            });
            const contar = (m: string) => resumen.filter((f) => f.modalidad === m).length;
            const totalBP = contar('business_plan');
            const totalCaso = contar('caso');
            const totalPI = contar('proyecto_investigacion');
            return (
              <>
                {/* Barra de filtros */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="flex gap-1">
                    {([
                      ['todas', `Todas · ${resumen.length}`],
                      ['business_plan', `BP · ${totalBP}`],
                      ['caso', `Caso · ${totalCaso}`],
                      ['proyecto_investigacion', `PI · ${totalPI}`],
                    ] as const).map(([k, label]) => (
                      <button key={k}
                        onClick={() => setFiltroModalidad(k as any)}
                        className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border transition ${filtroModalidad === k
                          ? 'border-inalde-red bg-inalde-red text-white'
                          : 'border-inalde-gray-light text-inalde-gray hover:border-inalde-gray hover:text-inalde-text'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-w-[200px] ml-auto">
                    <input type="text" placeholder="Buscar autor, proyecto, sector, profesor…"
                      value={filtroBuscar}
                      onChange={(e) => setFiltroBuscar(e.target.value)}
                      className="w-full text-sm border border-inalde-gray-light rounded px-3 py-1.5 focus:outline-none focus:border-inalde-red" />
                  </div>
                </div>

                {/* Tabla */}
                <div className="rounded-lg border border-inalde-gray-light overflow-hidden shadow-inalde-card bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[1200px] table-fixed border-collapse">
                      <colgroup>
                        <col className="w-14" />
                        <col className="w-[18%]" />
                        <col className="w-[30%]" />
                        <col className="w-20" />
                        <col className="w-20" />
                        <col className="w-32" />
                        <col className="w-48" />
                      </colgroup>
                      <thead>
                        <tr className="bg-gradient-to-b from-inalde-text to-[#2a2a2a]">
                          <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">#</th>
                          <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Autores</th>
                          <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Proyecto(s) · Sector</th>
                          <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-center" title="¿Está buscando socios?">Socios</th>
                          <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-center" title="¿Busca asociación con otro proyecto?">Asoc.</th>
                          <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Modalidad</th>
                          <th className="px-3 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Profesor / Director</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtrados.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-12 text-center text-inalde-gray italic">
                              No hay equipos que coincidan con el filtro.
                            </td>
                          </tr>
                        ) : filtrados.map((f, idx) => (
                          <tr key={f.equipo_id}
                            className={`border-t border-inalde-gray-light/60 align-top transition ${idx % 2 === 0 ? 'bg-white' : 'bg-inalde-gray-bg/40'} hover:bg-inalde-red/5`}>
                            <td className="px-3 py-3 align-top">
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-inalde-text text-white text-xs font-bold font-mono">
                                {f.numero}
                              </span>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <p className="font-medium text-inalde-text truncate" title={f.autores}>
                                {f.autores || <span className="italic text-inalde-gray font-normal">—</span>}
                              </p>
                              {f.nombre_equipo && (
                                <p className="text-[11px] text-inalde-gray uppercase tracking-wider mt-0.5 truncate" title={f.nombre_equipo}>
                                  {f.nombre_equipo}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top">
                              {f.proyectos.length > 1 ? (
                                <div className="space-y-2">
                                  {f.proyectos.map((p, i) => (
                                    <div key={p.id || i} className="bg-inalde-gold/5 border-l-[3px] border-inalde-gold rounded-sm pl-2.5 py-1.5">
                                      <p className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold mb-0.5">Proyecto {i + 1}</p>
                                      <p className="font-medium text-inalde-text leading-tight" title={p.nombre}>{p.nombre}</p>
                                      {p.sector && <p className="text-[11px] text-inalde-gray mt-0.5 truncate" title={p.sector}>{p.sector}</p>}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div>
                                  <p className="font-medium text-inalde-text leading-snug" title={f.proyectos[0]?.nombre}>
                                    {f.proyectos[0]?.nombre ?? <span className="italic text-inalde-gray font-normal">—</span>}
                                  </p>
                                  {f.proyectos[0]?.sector && (
                                    <p className="text-[11px] text-inalde-gray mt-1 truncate" title={f.proyectos[0].sector}>{f.proyectos[0].sector}</p>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center align-top">
                              {isSuperAdmin ? (
                                <select
                                  value={f.buscando_socios === null ? '' : f.buscando_socios ? 'si' : 'no'}
                                  onChange={(e) => { const v = e.target.value; actualizarFlag(f.equipo_id, 'buscando_socios', v === '' ? null : v === 'si'); }}
                                  className="border border-inalde-gray-light rounded px-1.5 py-1 text-xs bg-white hover:border-inalde-gray focus:outline-none focus:border-inalde-red focus:ring-1 focus:ring-inalde-red/30">
                                  <option value="">—</option>
                                  <option value="si">SÍ</option>
                                  <option value="no">NO</option>
                                </select>
                              ) : (
                                <Pill value={f.buscando_socios} />
                              )}
                            </td>
                            <td className="px-3 py-3 text-center align-top">
                              {isSuperAdmin ? (
                                <select
                                  value={f.buscando_asociacion === null ? '' : f.buscando_asociacion ? 'si' : 'no'}
                                  onChange={(e) => { const v = e.target.value; actualizarFlag(f.equipo_id, 'buscando_asociacion', v === '' ? null : v === 'si'); }}
                                  className="border border-inalde-gray-light rounded px-1.5 py-1 text-xs bg-white hover:border-inalde-gray focus:outline-none focus:border-inalde-red focus:ring-1 focus:ring-inalde-red/30">
                                  <option value="">—</option>
                                  <option value="si">SÍ</option>
                                  <option value="no">NO</option>
                                </select>
                              ) : (
                                <Pill value={f.buscando_asociacion} />
                              )}
                            </td>
                            <td className="px-3 py-3 align-top">
                              <ModalidadPill modalidad={f.modalidad} />
                            </td>
                            <td className="px-3 py-3 align-top">
                              {f.modalidad === 'business_plan' ? (
                                isSuperAdmin ? (
                                  <select
                                    value={f.profesor_asignado_id ?? ''}
                                    onChange={(e) => asignarProfesor(f.equipo_id, e.target.value || null)}
                                    className={`w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-inalde-red/30 transition ${f.profesor_asignado_id ? 'border-inalde-red/40 text-inalde-text font-medium' : 'border-inalde-gray-light text-inalde-gray'}`}>
                                    <option value="">— Sin asignar —</option>
                                    {profesores.map((p) => (
                                      <option key={p.id} value={p.id}>{p.nombre_completo}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-inalde-text text-xs font-medium">
                                    {f.profesor_asignado_nombre ?? <span className="italic text-inalde-gray font-normal">— Sin asignar —</span>}
                                  </span>
                                )
                              ) : (
                                <div className="text-xs">
                                  <p className="text-[10px] uppercase tracking-wider text-inalde-gold font-semibold">Director</p>
                                  <p className="text-inalde-text font-medium">
                                    {f.director_asignado_nombre ?? <span className="italic text-inalde-gray font-normal">— Sin director —</span>}
                                  </p>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-2 bg-inalde-gray-bg/60 border-t border-inalde-gray-light text-[11px] text-inalde-gray flex justify-between items-center">
                    <span>Mostrando <strong className="text-inalde-text">{filtrados.length}</strong> de {resumen.length} equipos</span>
                    <span className="hidden sm:inline">Click en los selectores para editar (solo super_admin)</span>
                  </div>
                </div>
              </>
            );
          })()
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
