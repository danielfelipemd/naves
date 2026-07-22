import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; activa: boolean; }
interface Jornada { id: string; numero: number; fecha: string; hora_inicio: string | null; hora_fin: string | null; }
interface Logistica {
  necesita_transporte: boolean | null;
  direccion_recogida: string | null;
  hora_recogida: string | null;
  transporte_por_fecha: Record<string, boolean>;
  almuerzo_por_fecha: Record<string, boolean>;
  desayuno_por_fecha: Record<string, boolean>;
}
interface Panelista {
  id: string; nombre: string; email: string;
  asiste_todas: boolean;
  jornadas: Array<{ id: string; numero: number; fecha: string }>;
  confirmado: boolean; email_enviado: boolean; token: string;
  logistica: Logistica | null;
}
interface Stats { total: number; enviados: number; confirmados: number; con_transporte: number; pendientes: number; }

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function diaSemana(fechaISO: string) { return DIAS[new Date(fechaISO + 'T12:00:00Z').getUTCDay()]; }
function fechaCorta(fechaISO: string) { const [, m, d] = fechaISO.split('-'); return `${parseInt(d, 10)}/${parseInt(m, 10)}`; }

export default function Panelistas() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [panelistas, setPanelistas] = useState<Panelista[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editLog, setEditLog] = useState<Panelista | null>(null);
  const [vista, setVista] = useState<'panelistas' | 'jornadas' | 'resumen'>('panelistas');

  useEffect(() => { (async () => {
    const data = (await api.get('/admin/cohortes')).data as Cohorte[];
    setCohortes(data.filter((c) => c.activa));
  })(); }, []);

  async function load() {
    if (!cohorte) { setJornadas([]); setPanelistas([]); setStats(null); return; }
    setLoading(true); setMsg(null);
    try {
      const { data } = await api.get(`/panelistas/admin/${cohorte}`);
      setJornadas(data.jornadas ?? []);
      setPanelistas(data.panelistas ?? []);
      setStats(data.stats ?? null);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [cohorte]);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Panelistas</h1>
        <p className="text-sm text-inalde-gray mt-2">Gestiona los evaluadores externos, su asistencia por jornada y su logística (transporte y comidas).</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end mb-5">
        <div>
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
            <option value="">Selecciona…</option>
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-5 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>{msg.text}</div>
      )}

      {cohorte && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {([['Total', stats.total], ['Correos enviados', stats.enviados], ['Confirmados', stats.confirmados], ['Con transporte', stats.con_transporte], ['Pendientes', stats.pendientes]] as const).map(([l, n]) => (
            <div key={l} className="rounded-lg border border-inalde-gray-light bg-white px-3 py-2.5">
              <div className="text-2xl font-bold text-inalde-text">{n}</div>
              <div className="text-[10px] uppercase tracking-wider text-inalde-gray">{l}</div>
            </div>
          ))}
        </div>
      )}

      {cohorte && (
        <div className="flex gap-2 mb-4 border-b border-inalde-gray-light">
          {([['panelistas', 'Panelistas'], ['jornadas', `Jornadas (${jornadas.length})`], ['resumen', 'Resumen por jornada']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setVista(k)}
              className={`text-xs font-primary font-semibold uppercase tracking-wider px-3 py-2 -mb-px border-b-2 transition ${vista === k ? 'border-inalde-red text-inalde-red' : 'border-transparent text-inalde-gray hover:text-inalde-text'}`}>{l}</button>
          ))}
        </div>
      )}

      {!cohorte ? null : loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <>
          {vista === 'jornadas' && <JornadasTab jornadas={jornadas} />}
          {vista === 'panelistas' && (
            jornadas.length === 0
              ? <p className="text-inalde-gray text-sm">Esta cohorte todavía no tiene <button className="text-inalde-red underline" onClick={() => setVista('jornadas')}>jornadas</button>: ponles fecha en el cronograma de la cohorte (hitos 12 y 13) y podrás asignar panelistas.</p>
              : <PanelistasTab cohorte={cohorte} jornadas={jornadas} panelistas={panelistas} onChange={load}
                  setMsg={setMsg} busy={busy} setBusy={setBusy} onEditLog={setEditLog} />
          )}
          {vista === 'resumen' && <ResumenTab cohorte={cohorte} />}
        </>
      )}

      {editLog && (
        <LogisticaModal panelista={editLog} jornadas={jornadas} onClose={() => setEditLog(null)}
          onSaved={() => { setEditLog(null); load(); setMsg({ kind: 'ok', text: 'Logística actualizada.' }); }}
          admin setMsg={setMsg} />
      )}
    </>
  );
}

// ---- Jornadas ----
// Solo lectura: las jornadas se derivan del cronograma de la cohorte (hitos 12 y
// 13). Antes se tecleaban aquí, duplicando una fecha que el sistema ya conocía —
// y que acabó sin coincidir con el cronograma.
function JornadasTab({ jornadas }: { jornadas: Jornada[] }) {
  return (
    <div>
      <p className="text-sm text-inalde-gray mb-3">
        Las jornadas salen del cronograma de la cohorte: la jornada 1 del hito <strong>12 (Primera jornada presentaciones)</strong> y la 2 del hito <strong>13 (Segunda jornada presentaciones)</strong>.
        Para cambiar una fecha, edítala en <strong>Cohortes</strong>. El horario se define en <strong>Programación</strong>.
      </p>
      <div className="border border-inalde-gray-light rounded overflow-auto max-h-[72vh]">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-inalde-gray-bg text-left"><tr>
            <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">#</th>
            <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Fecha</th>
            <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Horario</th>
          </tr></thead>
          <tbody>
            {jornadas.map((j) => (
              <tr key={j.id} className="border-t border-inalde-gray-light">
                <td className="px-3 py-2">Jornada {j.numero}</td>
                <td className="px-3 py-2 capitalize">{diaSemana(j.fecha)} {fechaCorta(j.fecha)}</td>
                <td className="px-3 py-2 text-inalde-gray">{(j.hora_inicio ?? '').slice(0, 5) || '—'} – {(j.hora_fin ?? '').slice(0, 5) || '—'}</td>
              </tr>
            ))}
            {jornadas.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-inalde-gray">
                Esta cohorte todavía no tiene fechas de presentaciones en su cronograma (hitos 12 y 13).
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Panelistas ----
function PanelistasTab({ cohorte, jornadas, panelistas, onChange, setMsg, busy, setBusy, onEditLog }: any) {
  const [form, setForm] = useState<{ nombre: string; email: string; asiste_todas: boolean; jornada_ids: string[] }>({ nombre: '', email: '', asiste_todas: true, jornada_ids: [] });
  const [showAdd, setShowAdd] = useState(false);

  async function crear() {
    if (!form.nombre.trim() || !form.email.trim()) { setMsg({ kind: 'err', text: 'Nombre y correo son obligatorios.' }); return; }
    try {
      await api.post(`/panelistas/admin/${cohorte}`, {
        nombre_completo: form.nombre.trim(), email: form.email.trim(),
        asiste_todas: form.asiste_todas, jornada_ids: form.asiste_todas ? [] : form.jornada_ids,
      });
      setForm({ nombre: '', email: '', asiste_todas: true, jornada_ids: [] }); setShowAdd(false); onChange();
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }
  async function enviar(id: string) {
    setBusy(true);
    try { await api.post(`/panelistas/admin/panelista/${id}/enviar`); setMsg({ kind: 'ok', text: 'Correo de invitación enviado.' }); onChange(); }
    catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function enviarPendientes() {
    if (!confirm('Se enviará el correo de invitación a todos los panelistas pendientes. ¿Continuar?')) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/panelistas/admin/${cohorte}/enviar-pendientes`);
      setMsg({ kind: 'ok', text: `Envío iniciado para ${data.total} panelista(s). Refresca en un momento para ver el estado.` });
      setTimeout(onChange, 4000);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function recordatorios() {
    if (!confirm('Se enviará un recordatorio a los panelistas ya invitados que aún no han confirmado. ¿Continuar?')) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/panelistas/admin/${cohorte}/recordatorios`);
      setMsg({ kind: 'ok', text: `Recordatorio iniciado para ${data.total} panelista(s) sin confirmar.` });
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function borrar(id: string) {
    if (!confirm('¿Borrar este panelista?')) return;
    try { await api.delete(`/panelistas/admin/panelista/${id}`); onChange(); }
    catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <button onClick={() => setShowAdd((s) => !s)} className="btn-inalde-secondary !py-2 !px-4 !text-xs">{showAdd ? 'Cancelar' : '+ Agregar panelista'}</button>
        <button onClick={enviarPendientes} disabled={busy} className="btn-inalde-primary !py-2 !px-4 !text-xs">Enviar a pendientes</button>
        <button onClick={recordatorios} disabled={busy} className="btn-inalde-secondary !py-2 !px-4 !text-xs" title="A los invitados que aún no confirman">🔔 Recordar sin confirmar</button>
      </div>

      {showAdd && (
        <div className="bg-inalde-gray-bg/40 border border-inalde-gray-light rounded p-3 mb-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input placeholder="Nombre completo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="input-inalde !py-1.5 flex-1 min-w-[180px]" />
            <input placeholder="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-inalde !py-1.5 flex-1 min-w-[180px]" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.asiste_todas} onChange={(e) => setForm({ ...form, asiste_todas: e.target.checked })} /> Asiste a todas las jornadas</label>
          {!form.asiste_todas && (
            <div className="flex flex-wrap gap-2">
              {jornadas.map((j: Jornada) => (
                <label key={j.id} className="flex items-center gap-1 text-xs border border-inalde-gray-light rounded px-2 py-1">
                  <input type="checkbox" checked={form.jornada_ids.includes(j.id)}
                    onChange={(e) => setForm((f) => ({ ...f, jornada_ids: e.target.checked ? [...f.jornada_ids, j.id] : f.jornada_ids.filter((x) => x !== j.id) }))} />
                  J{j.numero} · {fechaCorta(j.fecha)}
                </label>
              ))}
            </div>
          )}
          <button onClick={crear} className="btn-inalde-primary !py-1.5 !px-4 !text-xs">Guardar panelista</button>
        </div>
      )}

      <div className="border border-inalde-gray-light rounded overflow-auto max-h-[72vh]">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-inalde-gray-bg text-left"><tr>
            {['Panelista', 'Jornadas', 'Transporte', 'Comidas', 'Estado', 'Acciones'].map((h) => (
              <th key={h} className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {panelistas.map((p: Panelista) => {
              const log = p.logistica;
              const comidas = log ? [
                ...Object.entries(log.almuerzo_por_fecha || {}).filter(([, v]) => v).map(([f]) => `Alm ${fechaCorta(f)}`),
                ...Object.entries(log.desayuno_por_fecha || {}).filter(([, v]) => v).map(([f]) => `Des ${fechaCorta(f)}`),
              ] : [];
              return (
                <tr key={p.id} className="border-t border-inalde-gray-light align-top hover:bg-inalde-gray-bg/30">
                  <td className="px-3 py-2"><div className="font-medium text-inalde-text">{p.nombre}</div><div className="text-[11px] text-inalde-gray">{p.email}</div></td>
                  <td className="px-3 py-2">
                    {p.asiste_todas ? <span className="inline-block text-[10px] font-bold uppercase bg-green-100 text-green-800 rounded px-2 py-0.5">Todas</span>
                      : <div className="flex flex-wrap gap-1">{p.jornadas.map((j) => <span key={j.id} className="text-[10px] bg-inalde-red/10 text-inalde-red rounded px-1.5 py-0.5">J{j.numero}</span>)}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {log?.necesita_transporte === true ? <span className="text-green-700 font-semibold">✓ Sí</span>
                      : log?.necesita_transporte === false ? <span className="text-inalde-gray">No</span>
                      : <span className="text-inalde-gray italic">Sin definir</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-inalde-gray">{comidas.length ? comidas.join(' · ') : <span className="italic">—</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    {p.confirmado ? <span className="text-green-700 font-semibold">✓ Confirmó</span>
                      : p.email_enviado ? <span className="text-inalde-blue">✉️ Enviado</span>
                      : <span className="text-inalde-gold font-semibold">Pendiente</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => enviar(p.id)} disabled={busy} title="Enviar/reenviar invitación" className="text-[11px] bg-inalde-blue text-white rounded px-2 py-1">✉️</button>
                      <button onClick={() => onEditLog(p)} title="Editar logística" className="text-[11px] border border-inalde-gray-light rounded px-2 py-1">Logística</button>
                      <button onClick={() => borrar(p.id)} title="Borrar" className="text-[11px] text-inalde-gray hover:text-inalde-red px-1">🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {panelistas.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-inalde-gray">Sin panelistas aún</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Resumen ----
function ResumenTab({ cohorte }: { cohorte: string }) {
  const [data, setData] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => { (async () => { try { setData((await api.get(`/panelistas/admin/${cohorte}/resumen`)).data); } catch { setData(null); } })(); }, [cohorte]);

  async function enviarResumen() {
    if (!email.trim()) { setAviso({ kind: 'err', text: 'Indica un correo destino.' }); return; }
    setEnviando(true); setAviso(null);
    try {
      await api.post(`/panelistas/admin/${cohorte}/resumen-logistico`, { email: email.trim() });
      setAviso({ kind: 'ok', text: `Resumen logístico enviado a ${email.trim()}.` });
    } catch (e: any) { setAviso({ kind: 'err', text: formatBackendError(e) }); }
    finally { setEnviando(false); }
  }

  if (!data) return <p className="text-inalde-gray">Cargando resumen…</p>;
  return (
    <div className="space-y-5">
      <div className="bg-inalde-gray-bg/40 border border-inalde-gray-light rounded p-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-inalde-gray">Enviar este resumen logístico por correo:</span>
        <input type="email" placeholder="coordinador@inalde.edu.co" value={email} onChange={(e) => setEmail(e.target.value)} className="input-inalde !py-1.5 flex-1 min-w-[200px]" />
        <button onClick={enviarResumen} disabled={enviando} className="btn-inalde-primary !py-1.5 !px-4 !text-xs disabled:opacity-50">{enviando ? 'Enviando…' : 'Enviar por correo'}</button>
        {aviso && <span className={`text-xs w-full ${aviso.kind === 'ok' ? 'text-green-700' : 'text-inalde-red'}`}>{aviso.text}</span>}
      </div>
      {data.por_jornada.map((jr: any) => (
        <div key={jr.jornada.numero} className="border border-inalde-gray-light rounded p-4">
          <h3 className="font-primary font-bold text-inalde-text">Jornada {jr.jornada.numero} · <span className="capitalize">{jr.jornada.fecha_legible}</span> {(jr.jornada.hora_inicio ?? '').slice(0, 5) && `· ${(jr.jornada.hora_inicio ?? '').slice(0, 5)}–${(jr.jornada.hora_fin ?? '').slice(0, 5)}`}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {jr.panelistas.map((p: any, i: number) => (
              <li key={i} className="text-inalde-text">
                <strong>{p.nombre}</strong>
                {p.transporte ? <span className="text-inalde-gray"> · 🚗 Transporte{p.direccion ? ` (${p.direccion}${p.hora_recogida ? `, ${p.hora_recogida.slice(0, 5)}` : ''})` : ''}</span> : <span className="text-inalde-gray"> · sin transporte</span>}
                {p.almuerza != null && <span className="text-inalde-gray"> · {p.almuerza ? '🍽️ Almuerza' : 'no almuerza'}</span>}
                {p.desayuna != null && <span className="text-inalde-gray"> · {p.desayuna ? '☕ Desayuna' : 'no desayuna'}</span>}
              </li>
            ))}
            {jr.panelistas.length === 0 && <li className="text-inalde-gray italic">Sin panelistas asignados</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---- Modal de logística (reusado en admin y portal) ----
export function LogisticaModal({ panelista, jornadas, onClose, onSaved, admin, setMsg }:
  { panelista: any; jornadas: Jornada[]; onClose: () => void; onSaved: () => void; admin?: boolean; setMsg?: (m: any) => void }) {
  const misJornadas: Jornada[] = admin
    ? (panelista.asiste_todas ? jornadas : jornadas.filter((j) => panelista.jornadas?.some((x: any) => x.id === j.id)))
    : jornadas;
  const viernes = useMemo(() => misJornadas.filter((j) => diaSemana(j.fecha) === 'viernes'), [misJornadas]);
  const sabados = useMemo(() => misJornadas.filter((j) => diaSemana(j.fecha) === 'sábado'), [misJornadas]);
  const log: Logistica | null = panelista.logistica;

  const [transp, setTransp] = useState<'si' | 'no' | ''>(log?.necesita_transporte === true ? 'si' : log?.necesita_transporte === false ? 'no' : '');
  const [dir, setDir] = useState(log?.direccion_recogida ?? '');
  const [hora, setHora] = useState((log?.hora_recogida ?? '').slice(0, 5));
  const [transpFechas, setTranspFechas] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}; misJornadas.forEach((j) => { o[j.fecha] = log?.transporte_por_fecha?.[j.fecha] ?? true; }); return o;
  });
  const [alm, setAlm] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}; viernes.forEach((j) => { o[j.fecha] = log?.almuerzo_por_fecha?.[j.fecha] ?? true; }); return o;
  });
  const [des, setDes] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}; sabados.forEach((j) => { o[j.fecha] = log?.desayuno_por_fecha?.[j.fecha] ?? true; }); return o;
  });
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setSaving(true);
    const payload = {
      necesita_transporte: transp === '' ? null : transp === 'si',
      direccion_recogida: transp === 'si' ? (dir || null) : null,
      hora_recogida: transp === 'si' && hora ? hora : null,
      transporte_por_fecha: transp === 'si' ? transpFechas : {},
      almuerzo_por_fecha: alm,
      desayuno_por_fecha: des,
    };
    try {
      if (admin) await api.put(`/panelistas/admin/panelista/${panelista.id}/logistica`, payload);
      else await api.post(`/panelistas/portal/${panelista.token}/confirmar`, payload);
      onSaved();
    } catch (e: any) { setMsg?.({ kind: 'err', text: formatBackendError(e) }); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-primary font-bold text-lg text-inalde-text mb-1">Logística {admin ? `— ${panelista.nombre}` : ''}</h3>
        <p className="text-xs text-inalde-gray mb-4">Transporte y comidas para las jornadas.</p>

        <div className="mb-4">
          <label className="block text-xs uppercase tracking-wider text-inalde-gray mb-1 font-semibold">¿Necesitas transporte?</label>
          <select value={transp} onChange={(e) => setTransp(e.target.value as any)} className="input-inalde !py-1.5">
            <option value="">Sin definir</option><option value="si">Sí, necesito transporte</option><option value="no">No, iré por mi cuenta</option>
          </select>
          {transp === 'si' && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                {misJornadas.map((j) => (
                  <label key={j.id} className="flex items-center gap-1 text-xs border border-inalde-gray-light rounded px-2 py-1">
                    <input type="checkbox" checked={transpFechas[j.fecha] ?? true} onChange={(e) => setTranspFechas({ ...transpFechas, [j.fecha]: e.target.checked })} />
                    <span className="capitalize">{diaSemana(j.fecha)} {fechaCorta(j.fecha)}</span>
                  </label>
                ))}
              </div>
              <input placeholder="Dirección de recogida" value={dir} onChange={(e) => setDir(e.target.value)} className="input-inalde !py-1.5 w-full" />
              <div><label className="block text-[10px] uppercase text-inalde-gray mb-1">Hora preferida</label><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="input-inalde !py-1.5" /></div>
            </div>
          )}
        </div>

        {viernes.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs uppercase tracking-wider text-inalde-gray mb-1 font-semibold">Almuerzo (viernes)</label>
            {viernes.map((j) => (
              <label key={j.id} className="flex items-center gap-2 text-sm mb-1"><input type="checkbox" checked={alm[j.fecha] ?? true} onChange={(e) => setAlm({ ...alm, [j.fecha]: e.target.checked })} /> <span className="capitalize">{diaSemana(j.fecha)} {fechaCorta(j.fecha)}</span></label>
            ))}
          </div>
        )}
        {sabados.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs uppercase tracking-wider text-inalde-gray mb-1 font-semibold">Desayuno (sábado)</label>
            {sabados.map((j) => (
              <label key={j.id} className="flex items-center gap-2 text-sm mb-1"><input type="checkbox" checked={des[j.fecha] ?? true} onChange={(e) => setDes({ ...des, [j.fecha]: e.target.checked })} /> <span className="capitalize">{diaSemana(j.fecha)} {fechaCorta(j.fecha)}</span></label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded text-xs uppercase tracking-wider border-2 border-inalde-gray-light text-inalde-gray">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="px-4 py-2 rounded text-xs uppercase tracking-wider bg-inalde-red text-white">{saving ? 'Guardando…' : (admin ? 'Guardar' : 'Confirmar asistencia')}</button>
        </div>
      </div>
    </div>
  );
}
