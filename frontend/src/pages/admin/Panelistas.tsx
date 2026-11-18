import { useEffect, useMemo, useState } from 'react';
import { confirmar } from '../../components/inalde/Dialogos';
import { api, downloadFile } from '../../lib/api';
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
  // Enlace compartido (sql/55): bloques que eligió, si llegó solo por el enlace
  // y cuándo se le mandó la confirmación.
  bloques: Array<{ jornada_numero: number; bloque: number }>;
  registro_por_enlace: boolean;
  confirmacion_enviada_at: string | null;
}
interface Stats { total: number; enviados: number; confirmados: number; con_transporte: number; pendientes: number; }
interface BloqueInfo { numero: number; hora_inicio: string; hora_fin: string; primer_slot: number; ultimo_slot: number; }
interface EnlaceInfo {
  enlace: { url: string | null; activo: boolean; vence_at: string; estado: 'vigente' | 'inactivo' | 'vencido'; avisar_a: string[] } | null;
  publicada_at: string | null;
  bloques: Array<{ numero: number; fecha: string; fecha_legible: string; bloques: BloqueInfo[] }>;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function diaSemana(fechaISO: string) { return DIAS[new Date(fechaISO + 'T12:00:00Z').getUTCDay()]; }
function fechaCorta(fechaISO: string) { const [, m, d] = fechaISO.split('-'); return `${parseInt(d, 10)}/${parseInt(m, 10)}`; }
// <input type="datetime-local"> trabaja en la hora del navegador, sin zona.
function aLocal(iso: string) {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function legibleCorto(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function Panelistas() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [panelistas, setPanelistas] = useState<Panelista[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [enlace, setEnlace] = useState<EnlaceInfo | null>(null);
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
    if (!cohorte) { setJornadas([]); setPanelistas([]); setStats(null); setEnlace(null); return; }
    setLoading(true); setMsg(null);
    try {
      const [{ data }, { data: en }] = await Promise.all([
        api.get(`/panelistas/admin/${cohorte}`),
        api.get(`/panelistas-enlace/admin/${cohorte}`),
      ]);
      setJornadas(data.jornadas ?? []);
      setPanelistas(data.panelistas ?? []);
      setStats(data.stats ?? null);
      setEnlace(en);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [cohorte]);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Panelistas</h1>
        <p className="text-sm text-inalde-gray mt-2">Comparte el enlace con la programación para que cada evaluador elija a qué bloques asistir y deje su logística (transporte y comidas).</p>
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
        <div role="status" className={`rounded border-l-4 px-4 py-3 text-sm mb-5 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>{msg.text}</div>
      )}

      {cohorte && enlace && !loading && (
        <EnlaceCard cohorte={cohorte} info={enlace} jornadas={jornadas} onChange={load} setMsg={setMsg} />
      )}

      {cohorte && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {([['Total', stats.total], ['Enlace enviado', stats.enviados], ['Confirmados', stats.confirmados], ['Con transporte', stats.con_transporte], ['Sin enlace enviado', stats.pendientes]] as const).map(([l, n]) => (
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
              : <PanelistasTab cohorte={cohorte} jornadas={jornadas} panelistas={panelistas} enlace={enlace} onChange={load}
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

// ---- Enlace compartido ----
// Lo que en el sitio alterno era la página /panelistas: un enlace para todos,
// que aquí se activa, se desactiva y vence en la fecha que se elija.
function EnlaceCard({ cohorte, info, jornadas, onChange, setMsg }: {
  cohorte: string; info: EnlaceInfo; jornadas: Jornada[]; onChange: () => void; setMsg: (m: any) => void;
}) {
  const e = info.enlace;
  // Por defecto, hasta el final del último día de presentaciones. Si ese día ya
  // pasó (una cohorte de pruebas, o un evento anterior), 10 días desde hoy: un
  // valor por defecto vencido hacía fallar «Crear y activar» sin explicación.
  const ultimo = jornadas.length ? jornadas[jornadas.length - 1].fecha : null;
  const finUltimo = ultimo ? `${ultimo}T23:59` : null;
  const porDefecto = finUltimo && new Date(finUltimo).getTime() > Date.now()
    ? finUltimo
    : aLocal(new Date(Date.now() + 10 * 86400000).toISOString());
  const [vence, setVence] = useState(e ? aLocal(e.vence_at) : porDefecto);
  const [guardando, setGuardando] = useState(false);
  const [avisos, setAvisos] = useState((e?.avisar_a ?? []).join(', '));
  const totalBloques = info.bloques.reduce((n, j) => n + j.bloques.length, 0);

  async function guardar(activo: boolean) {
    if (!vence) { setMsg({ kind: 'err', text: 'Elige hasta cuándo funciona el enlace.' }); return; }
    setGuardando(true);
    try {
      await api.put(`/panelistas-enlace/admin/${cohorte}`, { activo, vence_at: new Date(vence).toISOString() });
      // Primero recargar y después avisar: la recarga limpia el mensaje.
      onChange();
      setMsg({ kind: 'ok', text: activo ? 'Enlace activo. Cópialo y compártelo con los panelistas.' : 'Enlace desactivado: ya no abre.' });
    } catch (err: any) { setMsg({ kind: 'err', text: formatBackendError(err) }); }
    finally { setGuardando(false); }
  }
  // Quién recibe un aviso por cada confirmación (hoy, el super admin y la
  // asistente de programa). Se escribe separado por comas.
  async function guardarAvisos() {
    const lista = avisos.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const malo = lista.find((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (malo) { setMsg({ kind: 'err', text: `«${malo}» no es un correo válido.` }); return; }
    setGuardando(true);
    try {
      await api.put(`/panelistas-enlace/admin/${cohorte}/avisos`, { avisar_a: lista });
      onChange();
      setMsg({ kind: 'ok', text: lista.length ? `Se avisará de cada confirmación a: ${lista.join(', ')}.` : 'Nadie recibirá aviso de las confirmaciones.' });
    } catch (err: any) { setMsg({ kind: 'err', text: formatBackendError(err) }); }
    finally { setGuardando(false); }
  }
  async function regenerar() {
    if (!(await confirmar({
      titulo: 'Regenerar el enlace',
      mensaje: 'Se crea un enlace nuevo y el actual deja de abrir al instante. Quien tenga el anterior tendrá que recibir el nuevo. ¿Continuar?',
      aceptar: 'Regenerar', tono: 'peligro',
    }))) return;
    setGuardando(true);
    try { await api.post(`/panelistas-enlace/admin/${cohorte}/regenerar`); onChange(); setMsg({ kind: 'ok', text: 'Enlace regenerado. El anterior ya no abre.' }); }
    catch (err: any) { setMsg({ kind: 'err', text: formatBackendError(err) }); }
    finally { setGuardando(false); }
  }
  async function copiar() {
    if (!e?.url) return;
    try { await navigator.clipboard.writeText(e.url); setMsg({ kind: 'ok', text: 'Enlace copiado.' }); }
    catch { setMsg({ kind: 'err', text: 'El navegador no permitió copiar. Selecciona el enlace y cópialo a mano.' }); }
  }

  const estado = e?.estado ?? 'inactivo';
  const ESTILO = { vigente: 'bg-green-100 text-green-800', inactivo: 'bg-inalde-gray-bg text-inalde-gray', vencido: 'bg-red-100 text-inalde-red' } as const;
  const TEXTO = { vigente: 'Activo', inactivo: e ? 'Desactivado' : 'Sin crear', vencido: 'Vencido' } as const;
  return (
    <section className="rounded-lg border-2 border-inalde-text bg-white p-4 sm:p-5 mb-5">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h2 className="font-primary font-bold text-inalde-text">Enlace para panelistas</h2>
        <span className={`text-[10px] font-bold uppercase tracking-wider rounded px-2 py-0.5 ${ESTILO[estado]}`}>{TEXTO[estado]}</span>
      </div>
      <p className="text-xs text-inalde-gray mb-3">
        Un solo enlace para compartir. Muestra la programación por bloques ({totalBloques} bloques) con logo, resumen y One Pager;
        cada panelista elige a qué bloques asistir y deja su nombre, correo y logística. Quien no esté en la lista entra como «Nuevo registro».
      </p>
      {!info.publicada_at && (
        <p className="text-xs border-l-4 border-inalde-gold bg-amber-50 px-3 py-2 mb-3">
          La programación aún no está publicada: si después cambian los horarios o los bloques, los panelistas verán el cambio y lo que ya eligieron puede quedar en otro bloque.
        </p>
      )}
      {e?.url && (
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <input readOnly value={e.url} onFocus={(ev) => ev.currentTarget.select()} aria-label="Enlace para panelistas"
            className="input-inalde !py-1.5 !text-xs font-mono flex-1 min-w-[240px]" />
          <button onClick={copiar} aria-label="Copiar el enlace" className="btn-inalde-secondary !py-1.5 !px-3 !text-xs">Copiar</button>
          <a href={e.url} target="_blank" rel="noreferrer" className="btn-inalde-secondary !py-1.5 !px-3 !text-xs">Abrir</a>
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs text-inalde-gray">
          <span className="block uppercase tracking-wider font-semibold mb-1">Funciona hasta</span>
          <input type="datetime-local" value={vence} onChange={(ev) => setVence(ev.target.value)} className="input-inalde !w-auto !py-1.5 !text-sm" />
        </label>
        {estado === 'vigente' ? (
          <>
            <button onClick={() => guardar(true)} disabled={guardando || !e || aLocal(e.vence_at) === vence} className="btn-inalde-secondary !py-2 !px-4 !text-xs disabled:opacity-50">Guardar fecha</button>
            <button onClick={() => guardar(false)} disabled={guardando} className="btn-inalde-secondary !py-2 !px-4 !text-xs">Desactivar</button>
          </>
        ) : (
          <button onClick={() => guardar(true)} disabled={guardando} className="btn-inalde-primary !py-2 !px-4 !text-xs">{e ? 'Activar' : 'Crear y activar'}</button>
        )}
        {e && <button onClick={regenerar} disabled={guardando} className="text-xs text-inalde-gray hover:text-inalde-red underline ml-auto" title="Crea un enlace nuevo; el actual deja de abrir">Regenerar enlace</button>}
      </div>
      {e && estado !== 'inactivo' && <p className="text-[11px] text-inalde-gray mt-2">{estado === 'vencido' ? 'Venció' : 'Vence'} el {legibleCorto(e.vence_at)}</p>}
      <div className="mt-4 pt-3 border-t border-inalde-gray-light">
        <label htmlFor="avisar-a" className="block text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-1">Avisar de cada confirmación a</label>
        <div className="flex flex-wrap gap-2 items-center">
          <input id="avisar-a" value={avisos} onChange={(ev) => setAvisos(ev.target.value)} placeholder="correo@inalde.edu.co, otro@inalde.edu.co"
            className="input-inalde !py-1.5 !text-sm flex-1 min-w-[260px]" />
          <button onClick={guardarAvisos} disabled={guardando || avisos.trim() === (e?.avisar_a ?? []).join(', ')} className="btn-inalde-secondary !py-1.5 !px-4 !text-xs disabled:opacity-50">Guardar</button>
        </div>
        <p className="text-[11px] text-inalde-gray mt-1">Les llega un correo con el nombre, el correo, los bloques y la logística de cada panelista que confirme. El panelista recibe además su propia confirmación.</p>
      </div>
    </section>
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
function PanelistasTab({ cohorte, jornadas, panelistas, enlace, onChange, setMsg, busy, setBusy, onEditLog }: any) {
  const [form, setForm] = useState<{ nombre: string; email: string; asiste_todas: boolean; jornada_ids: string[] }>({ nombre: '', email: '', asiste_todas: true, jornada_ids: [] });
  const [showAdd, setShowAdd] = useState(false);
  const info = enlace as EnlaceInfo | null;
  const vigente = info?.enlace?.estado === 'vigente';
  // Hora de cada bloque, para el título de las etiquetas «J1 · B2».
  const horaBloque = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of info?.bloques ?? []) for (const b of j.bloques) m.set(`${j.numero}-${b.numero}`, `${b.hora_inicio}–${b.hora_fin} · presentaciones ${b.primer_slot} a ${b.ultimo_slot}`);
    return m;
  }, [info]);
  const sinConfirmacion = (panelistas as Panelista[]).filter((p) => p.confirmado && !p.confirmacion_enviada_at).length;

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
    try { await api.post(`/panelistas/admin/panelista/${id}/enviar`); onChange(); setMsg({ kind: 'ok', text: 'Enlace enviado por correo.' }); }
    catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function enviarConfirmacion(id: string) {
    setBusy(true);
    try { await api.post(`/panelistas-enlace/admin/panelista/${id}/confirmacion`); onChange(); setMsg({ kind: 'ok', text: 'Confirmación enviada.' }); }
    catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function enviarPendientes() {
    if (!(await confirmar({
      titulo: 'Enviar el enlace',
      mensaje: 'Se enviará por correo el enlace de la programación a los panelistas de la lista que todavía no lo han recibido. ¿Continuar?',
      aceptar: 'Enviar',
    }))) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/panelistas/admin/${cohorte}/enviar-pendientes`);
      setMsg({ kind: 'ok', text: `Envío iniciado para ${data.total} panelista(s). Refresca en un momento para ver el estado.` });
      setTimeout(onChange, 4000);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function recordatorios() {
    if (!(await confirmar({
      titulo: 'Enviar recordatorios',
      mensaje: 'Se enviará un recordatorio con el enlace a los panelistas que ya lo recibieron y aún no han confirmado. ¿Continuar?',
      aceptar: 'Enviar',
    }))) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/panelistas/admin/${cohorte}/recordatorios`);
      setMsg({ kind: 'ok', text: `Recordatorio iniciado para ${data.total} panelista(s) sin confirmar.` });
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function confirmacionesPendientes() {
    if (!(await confirmar({
      titulo: 'Enviar confirmaciones',
      mensaje: `Se enviará el correo de confirmación (bloques y logística) a ${sinConfirmacion} panelista(s) que confirmaron y todavía no lo tienen. ¿Continuar?`,
      aceptar: 'Enviar',
    }))) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/panelistas-enlace/admin/${cohorte}/confirmaciones-pendientes`);
      setMsg({ kind: 'ok', text: `Envío iniciado para ${data.total} confirmación(es). Refresca en un momento para ver el estado.` });
      setTimeout(onChange, 4000);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function borrar(id: string) {
    if (!(await confirmar({ titulo: 'Borrar panelista', mensaje: '¿Borrar este panelista?', aceptar: 'Borrar', tono: 'peligro' }))) return;
    try { await api.delete(`/panelistas/admin/panelista/${id}`); onChange(); }
    catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }

  function renderAsistencia(p: Panelista) {
    if (p.asiste_todas) return <span className="inline-block text-[10px] font-bold uppercase bg-green-100 text-green-800 rounded px-2 py-0.5">Todas</span>;
    if (p.bloques.length) {
      return (
        <div className="flex flex-wrap gap-1">
          {p.bloques.map((b) => (
            <span key={`${b.jornada_numero}-${b.bloque}`} title={horaBloque.get(`${b.jornada_numero}-${b.bloque}`)}
              className="text-[10px] bg-inalde-red/10 text-inalde-red rounded px-1.5 py-0.5 whitespace-nowrap">J{b.jornada_numero} · B{b.bloque}</span>
          ))}
        </div>
      );
    }
    if (p.jornadas.length) return <div className="flex flex-wrap gap-1">{p.jornadas.map((j) => <span key={j.id} className="text-[10px] bg-inalde-red/10 text-inalde-red rounded px-1.5 py-0.5">J{j.numero}</span>)}</div>;
    return <span className="text-[11px] text-inalde-gray italic">Sin elegir</span>;
  }
  function renderEstado(p: Panelista) {
    if (p.confirmado) {
      return (
        <>
          <span className="text-green-700 font-semibold">✓ Confirmó</span>
          <span className="block text-[10px] text-inalde-gray">{p.confirmacion_enviada_at ? 'confirmación enviada' : 'confirmación sin enviar'}</span>
        </>
      );
    }
    if (p.email_enviado) return <span className="text-inalde-blue">✉️ Enlace enviado</span>;
    return <span className="text-inalde-gold font-semibold">Pendiente</span>;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <button onClick={() => setShowAdd((s) => !s)} className="btn-inalde-secondary !py-2 !px-4 !text-xs">{showAdd ? 'Cancelar' : '+ Agregar panelista'}</button>
        <button onClick={enviarPendientes} disabled={busy || !vigente} title={vigente ? 'A los de la lista que aún no lo han recibido' : 'Activa el enlace primero'} className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-50">Enviar enlace a pendientes</button>
        <button onClick={recordatorios} disabled={busy || !vigente} title={vigente ? 'A los que lo recibieron y aún no confirman' : 'Activa el enlace primero'} className="btn-inalde-secondary !py-2 !px-4 !text-xs disabled:opacity-50">🔔 Recordar sin confirmar</button>
        {sinConfirmacion > 0 && (
          <button onClick={confirmacionesPendientes} disabled={busy} className="btn-inalde-secondary !py-2 !px-4 !text-xs">✉️ Enviar confirmación a pendientes ({sinConfirmacion})</button>
        )}
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
          <p className="text-[11px] text-inalde-gray">Si lo dejas sin jornadas, el panelista las elige él mismo desde el enlace.</p>
          <button onClick={crear} className="btn-inalde-primary !py-1.5 !px-4 !text-xs">Guardar panelista</button>
        </div>
      )}

      <div className="border border-inalde-gray-light rounded overflow-auto max-h-[72vh]">
        <table className="w-full text-sm min-w-[880px]">
          <thead className="bg-inalde-gray-bg text-left"><tr>
            {['Panelista', 'Asistencia', 'Transporte', 'Comidas', 'Estado', 'Acciones'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {(panelistas as Panelista[]).map((p) => {
              const log = p.logistica;
              const comidas = log ? [
                ...Object.entries(log.desayuno_por_fecha || {}).filter(([, v]) => v).map(([f]) => `☕ Des ${fechaCorta(f)}`),
                ...Object.entries(log.almuerzo_por_fecha || {}).filter(([, v]) => v).map(([f]) => `🍽 Alm ${fechaCorta(f)}`),
              ] : [];
              return (
                <tr key={p.id} className="border-t border-inalde-gray-light align-top hover:bg-inalde-gray-bg/30">
                  <td className="px-3 py-2">
                    <div className="font-medium text-inalde-text">{p.nombre}</div>
                    <div className="text-[11px] text-inalde-gray">{p.email}</div>
                    {p.registro_por_enlace && <span className="inline-block mt-0.5 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-orange-50 text-orange-800 border border-orange-200">🆕 Nuevo registro</span>}
                  </td>
                  <td className="px-3 py-2">{renderAsistencia(p)}</td>
                  <td className="px-3 py-2 text-xs">
                    {log?.necesita_transporte === true && (
                      <>
                        <span className="text-green-700 font-semibold">✓ Sí</span>
                        {log.direccion_recogida && <div className="text-[11px] text-inalde-gray">📍 {log.direccion_recogida}{log.hora_recogida ? ` · ${log.hora_recogida.slice(0, 5)}` : ''}</div>}
                      </>
                    )}
                    {log?.necesita_transporte === false && <span className="text-inalde-gray">No</span>}
                    {(log?.necesita_transporte ?? null) === null && <span className="text-inalde-gray italic">Sin definir</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-inalde-gray">{comidas.length ? comidas.join(' · ') : <span className="italic">—</span>}</td>
                  <td className="px-3 py-2 text-xs">{renderEstado(p)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => enviar(p.id)} disabled={busy || !vigente} title={vigente ? 'Enviar el enlace por correo' : 'Activa el enlace primero'} aria-label={`Enviar el enlace a ${p.nombre}`} className="text-[11px] bg-inalde-blue text-white rounded px-2 py-1 disabled:opacity-40">✉️</button>
                      {p.confirmado && <button onClick={() => enviarConfirmacion(p.id)} disabled={busy} title="Enviar (o reenviar) su confirmación" className="text-[11px] border border-inalde-blue text-inalde-blue rounded px-2 py-1">Confirmación</button>}
                      <button onClick={() => onEditLog(p)} title="Editar logística" className="text-[11px] border border-inalde-gray-light rounded px-2 py-1">Logística</button>
                      <button onClick={() => borrar(p.id)} title="Borrar" aria-label={`Borrar a ${p.nombre}`} className="text-[11px] text-inalde-gray hover:text-inalde-red px-1">🗑</button>
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
  // Como el «Copiar» del sitio alterno: el resumen en texto, para pegarlo en un
  // chat o un correo.
  async function copiar() {
    const lineas: string[] = [`RESUMEN DE PANELISTAS — NAVES`, ''];
    for (const jr of data.por_jornada) {
      lineas.push(`Jornada ${jr.jornada.numero} — ${jr.jornada.fecha_legible}`);
      if (!jr.panelistas.length) lineas.push('  (sin panelistas)');
      for (const p of jr.panelistas) {
        const extra = [
          p.transporte ? `transporte${p.direccion ? ` (${p.direccion}${p.hora_recogida ? `, ${String(p.hora_recogida).slice(0, 5)}` : ''})` : ''}` : null,
          p.desayuna ? 'desayuna' : null,
          p.almuerza ? 'almuerza' : null,
        ].filter(Boolean);
        lineas.push(`  • ${p.nombre}${extra.length ? ` — ${extra.join(' · ')}` : ''}`);
      }
      lineas.push('');
    }
    try { await navigator.clipboard.writeText(lineas.join('\n')); setAviso({ kind: 'ok', text: 'Resumen copiado.' }); }
    catch { setAviso({ kind: 'err', text: 'El navegador no permitió copiar.' }); }
  }
  async function excel() {
    try { await downloadFile(`/panelistas/admin/${cohorte}/resumen.xlsx`, `panelistas-${cohorte}.xlsx`); }
    catch (e: any) { setAviso({ kind: 'err', text: formatBackendError(e) }); }
  }

  if (!data) return <p className="text-inalde-gray">Cargando resumen…</p>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <button onClick={copiar} aria-label="Copiar el resumen" className="btn-inalde-secondary !py-1.5 !px-4 !text-xs">Copiar</button>
        <button onClick={excel} aria-label="Descargar el resumen en Excel" className="btn-inalde-secondary !py-1.5 !px-4 !text-xs">⬇ Excel</button>
      </div>
      <div className="bg-inalde-gray-bg/40 border border-inalde-gray-light rounded p-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-inalde-gray">Enviar este resumen logístico por correo:</span>
        <input type="email" placeholder="coordinador@inalde.edu.co" value={email} onChange={(e) => setEmail(e.target.value)} className="input-inalde !py-1.5 flex-1 min-w-[200px]" />
        <button onClick={enviarResumen} disabled={enviando} className="btn-inalde-primary !py-1.5 !px-4 !text-xs disabled:opacity-50">{enviando ? 'Enviando…' : 'Enviar por correo'}</button>
      </div>
      {aviso && <p role="status" className={`text-xs ${aviso.kind === 'ok' ? 'text-green-700' : 'text-inalde-red'}`}>{aviso.text}</p>}
      {data.por_jornada.map((jr: any) => (
        <div key={jr.jornada.numero} className="border border-inalde-gray-light rounded p-4">
          <h3 className="font-primary font-bold text-inalde-text">Jornada {jr.jornada.numero} · <span className="capitalize">{jr.jornada.fecha_legible}</span> {(jr.jornada.hora_inicio ?? '').slice(0, 5) && `· ${(jr.jornada.hora_inicio ?? '').slice(0, 5)}–${(jr.jornada.hora_fin ?? '').slice(0, 5)}`}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {jr.panelistas.map((p: any, i: number) => (
              <li key={i} className="text-inalde-text">
                <strong>{p.nombre}</strong>
                {p.transporte ? <span className="text-inalde-gray"> · 🚗 Transporte{p.direccion ? ` (${p.direccion}${p.hora_recogida ? `, ${p.hora_recogida.slice(0, 5)}` : ''})` : ''}</span> : <span className="text-inalde-gray"> · sin transporte</span>}
                <span className="text-inalde-gray"> · {p.desayuna ? '☕ Desayuna' : 'no desayuna'}</span>
                <span className="text-inalde-gray"> · {p.almuerza ? '🍽️ Almuerza' : 'no almuerza'}</span>
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
// Desayuno y almuerzo se preguntan para CUALQUIER día (Daniel, 18/11/2026).
// Antes solo almuerzo los viernes y desayuno los sábados, el calendario del Fin
// de Semana: con el Intensivo (martes y miércoles) no salía ninguna de las dos.
export function LogisticaModal({ panelista, jornadas, onClose, onSaved, admin, setMsg }:
  { panelista: any; jornadas: Jornada[]; onClose: () => void; onSaved: () => void; admin?: boolean; setMsg?: (m: any) => void }) {
  const misJornadas: Jornada[] = admin
    ? (panelista.asiste_todas ? jornadas : jornadas.filter((j) => panelista.jornadas?.some((x: any) => x.id === j.id)))
    : jornadas;
  const log: Logistica | null = panelista.logistica;

  const [transp, setTransp] = useState<'si' | 'no' | ''>(log?.necesita_transporte === true ? 'si' : log?.necesita_transporte === false ? 'no' : '');
  const [dir, setDir] = useState(log?.direccion_recogida ?? '');
  const [hora, setHora] = useState((log?.hora_recogida ?? '').slice(0, 5));
  const [transpFechas, setTranspFechas] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}; misJornadas.forEach((j) => { o[j.fecha] = log?.transporte_por_fecha?.[j.fecha] ?? true; }); return o;
  });
  const [alm, setAlm] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}; misJornadas.forEach((j) => { o[j.fecha] = log?.almuerzo_por_fecha?.[j.fecha] ?? false; }); return o;
  });
  const [des, setDes] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}; misJornadas.forEach((j) => { o[j.fecha] = log?.desayuno_por_fecha?.[j.fecha] ?? false; }); return o;
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

        {misJornadas.length > 0 && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-inalde-gray mb-1 font-semibold">Desayuna con INALDE</label>
              {misJornadas.map((j) => (
                <label key={j.id} className="flex items-center gap-2 text-sm mb-1"><input type="checkbox" checked={des[j.fecha] ?? false} onChange={(e) => setDes({ ...des, [j.fecha]: e.target.checked })} /> <span className="capitalize">{diaSemana(j.fecha)} {fechaCorta(j.fecha)}</span></label>
              ))}
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-inalde-gray mb-1 font-semibold">Almuerza con INALDE</label>
              {misJornadas.map((j) => (
                <label key={j.id} className="flex items-center gap-2 text-sm mb-1"><input type="checkbox" checked={alm[j.fecha] ?? false} onChange={(e) => setAlm({ ...alm, [j.fecha]: e.target.checked })} /> <span className="capitalize">{diaSemana(j.fecha)} {fechaCorta(j.fecha)}</span></label>
              ))}
            </div>
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
