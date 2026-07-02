import { useEffect, useState } from 'react';
import { api, downloadFile } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; activa: boolean; }
interface Config { evento_nombre: string; expo: number; trans: number; foto: number; cierre: number; break_min: number; bloque: number; }
interface Slot { slot: number; equipo_id: string; proyecto: string; autores: string; sector: string; hora_inicio: string; hora_fin: string; }
interface Actividad { tipo: string; desc: string; hora_inicio: string; hora_fin: string; }
interface Jornada { id: string; numero: number; fecha: string; hora_inicio: string | null; foto_inicial: boolean; intro_min: number; slots: Slot[]; actividades: Actividad[]; }
interface Equipo { equipo_id: string; proyecto: string; autores: string; sector: string; asignado: boolean; }

export default function Programacion() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [notificando, setNotificando] = useState(false);

  async function notificar() {
    setNotificando(true); setMsg(null);
    try {
      const { data } = await api.post(`/programacion/admin/${cohorte}/notificar`, {});
      setMsg({ kind: 'ok', text: `Notificados ${data.notificados} participante(s) de ${data.equipos} equipo(s) programado(s).` });
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setNotificando(false); }
  }

  useEffect(() => { (async () => {
    setCohortes(((await api.get('/admin/cohortes')).data as Cohorte[]).filter((c) => c.activa));
  })(); }, []);

  async function load() {
    if (!cohorte) { setConfig(null); setJornadas([]); setEquipos([]); return; }
    setLoading(true); setMsg(null);
    try {
      const { data } = await api.get(`/programacion/admin/${cohorte}`);
      setConfig(data.config); setJornadas(data.jornadas ?? []); setEquipos(data.equipos ?? []);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [cohorte]);

  async function guardarConfig() {
    if (!config) return;
    try {
      await api.put(`/programacion/admin/${cohorte}/config`, {
        evento_nombre: config.evento_nombre, expo_min: config.expo, trans_min: config.trans,
        foto_min: config.foto, cierre_min: config.cierre, break_min: config.break_min, bloque: config.bloque,
      });
      setMsg({ kind: 'ok', text: 'Configuración guardada.' }); load();
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }

  async function guardarJornada(j: Jornada, cambios: { foto_inicial?: boolean; intro_min?: number; equipo_ids?: string[] }) {
    try {
      await api.put(`/programacion/admin/jornada/${j.id}`, cambios);
      load();
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }

  function idsDe(j: Jornada) { return j.slots.map((s) => s.equipo_id); }
  function asignar(j: Jornada, equipoId: string) { guardarJornada(j, { equipo_ids: [...idsDe(j), equipoId] }); }
  function quitar(j: Jornada, equipoId: string) { guardarJornada(j, { equipo_ids: idsDe(j).filter((x) => x !== equipoId) }); }
  function mover(j: Jornada, idx: number, dir: -1 | 1) {
    const ids = idsDe(j); const ni = idx + dir; if (ni < 0 || ni >= ids.length) return;
    [ids[idx], ids[ni]] = [ids[ni], ids[idx]]; guardarJornada(j, { equipo_ids: ids });
  }

  const disponibles = equipos.filter((e) => !e.asignado);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Programación de presentaciones</h1>
        <p className="text-sm text-inalde-gray mt-2">Asigna los proyectos a los slots de cada jornada. Los horarios se calculan automáticamente. Descarga el Excel de calificación para los panelistas.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end mb-5">
        <div>
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
            <option value="">Selecciona…</option>
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
        {cohorte && jornadas.length > 0 && (
          <>
            <button onClick={() => downloadFile(`/programacion/admin/${cohorte}/excel`, `NAVES_Programacion_${cohorte}.xlsx`)} className="btn-inalde-secondary !py-2 !px-4 !text-xs">↓ Excel de calificación</button>
            <button onClick={notificar} disabled={notificando} className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-50" title="Avisa a cada participante la fecha y hora de su presentación">{notificando ? 'Notificando…' : '🔔 Notificar a participantes'}</button>
          </>
        )}
      </div>

      {msg && <div className={`rounded border-l-4 px-4 py-3 text-sm mb-5 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>{msg.text}</div>}

      {!cohorte ? null : loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <>
          {config && (
            <div className="bg-inalde-gray-bg/40 border border-inalde-gray-light rounded p-3 mb-5">
              <h3 className="text-xs font-primary font-semibold uppercase tracking-wider text-inalde-gray mb-2">Tiempos del evento (minutos)</h3>
              <div className="flex flex-wrap gap-3 items-end">
                {([['evento_nombre', 'Evento', 'text'], ['expo', 'Exposición', 'n'], ['trans', 'Transición', 'n'], ['foto', 'Foto inicial', 'n'], ['cierre', 'Cierre', 'n'], ['break_min', 'Break', 'n'], ['bloque', 'Slots por bloque', 'n']] as const).map(([k, l, t]) => (
                  <div key={k}>
                    <label className="block text-[10px] uppercase text-inalde-gray mb-1">{l}</label>
                    <input type={t === 'text' ? 'text' : 'number'} value={(config as any)[k]}
                      onChange={(e) => setConfig({ ...config, [k]: t === 'text' ? e.target.value : Number(e.target.value) })}
                      className={`input-inalde !py-1.5 ${t === 'text' ? 'w-32' : 'w-20'}`} />
                  </div>
                ))}
                <button onClick={guardarConfig} className="btn-inalde-primary !py-2 !px-4 !text-xs">Guardar</button>
              </div>
            </div>
          )}

          {jornadas.length === 0 ? (
            <p className="text-inalde-gray text-sm">Esta cohorte no tiene jornadas. Créalas primero en <strong>Panelistas → Jornadas</strong>.</p>
          ) : jornadas.map((j) => (
            <div key={j.id} className="border border-inalde-gray-light rounded-lg mb-5 overflow-hidden">
              <div className="bg-inalde-text text-white px-4 py-2.5 flex flex-wrap items-center gap-3">
                <span className="font-primary font-bold">Jornada {j.numero}</span>
                <span className="text-white/70 text-sm">{j.fecha} · inicio {(j.hora_inicio ?? '').slice(0, 5)}</span>
                <label className="text-xs flex items-center gap-1 ml-auto"><input type="checkbox" checked={j.foto_inicial} onChange={(e) => guardarJornada(j, { foto_inicial: e.target.checked })} /> Foto inicial</label>
                <label className="text-xs flex items-center gap-1">Intro <input type="number" value={j.intro_min} min={0} onChange={(e) => guardarJornada(j, { intro_min: Number(e.target.value) })} className="w-14 text-inalde-text rounded px-1 py-0.5" /> min</label>
              </div>
              <div className="p-3">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wider text-inalde-gray border-b border-inalde-gray-light">
                    <th className="py-1 w-12">Slot</th><th className="py-1 w-24">Horario</th><th className="py-1">Proyecto</th><th className="py-1">Autores</th><th className="py-1 w-24"></th>
                  </tr></thead>
                  <tbody>
                    {j.slots.map((s, idx) => (
                      <tr key={s.equipo_id} className="border-b border-inalde-gray-light/50">
                        <td className="py-1.5"><span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-inalde-text text-white text-xs font-bold">{s.slot}</span></td>
                        <td className="py-1.5 font-mono text-xs text-inalde-text">{s.hora_inicio}–{s.hora_fin}</td>
                        <td className="py-1.5"><span className="font-medium text-inalde-text">{s.proyecto}</span>{s.sector && <span className="text-[11px] text-inalde-gray ml-1">· {s.sector}</span>}</td>
                        <td className="py-1.5 text-xs text-inalde-gray">{s.autores}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          <button onClick={() => mover(j, idx, -1)} disabled={idx === 0} className="text-inalde-gray disabled:opacity-30 px-1">↑</button>
                          <button onClick={() => mover(j, idx, 1)} disabled={idx === j.slots.length - 1} className="text-inalde-gray disabled:opacity-30 px-1">↓</button>
                          <button onClick={() => quitar(j, s.equipo_id)} className="text-inalde-gray hover:text-inalde-red px-1">✕</button>
                        </td>
                      </tr>
                    ))}
                    {j.slots.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-inalde-gray italic text-xs">Sin proyectos asignados</td></tr>}
                    {j.actividades.filter((a) => a.tipo === 'cierre' || a.tipo === 'break').map((a, i) => (
                      <tr key={'act' + i} className="bg-inalde-gold/10"><td></td><td className="py-1 font-mono text-[11px] text-inalde-gray">{a.hora_inicio}–{a.hora_fin}</td><td colSpan={3} className="py-1 text-[11px] text-inalde-gray italic">{a.desc}</td></tr>
                    ))}
                  </tbody>
                </table>
                {disponibles.length > 0 && (
                  <div className="mt-2">
                    <select onChange={(e) => { if (e.target.value) { asignar(j, e.target.value); e.target.value = ''; } }} className="input-inalde !py-1.5 text-sm">
                      <option value="">+ Agregar proyecto a esta jornada…</option>
                      {disponibles.map((e) => <option key={e.equipo_id} value={e.equipo_id}>{e.proyecto} — {e.autores.slice(0, 40)}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
          ))}

          {disponibles.length > 0 && (
            <p className="text-xs text-inalde-gray">Proyectos sin asignar a ninguna jornada: <strong>{disponibles.length}</strong></p>
          )}
        </>
      )}
    </>
  );
}
