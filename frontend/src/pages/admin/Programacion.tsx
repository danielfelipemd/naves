import { useEffect, useState } from 'react';
import { pedirTexto } from '../../components/inalde/Dialogos';
import { api, downloadFile } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { VisorArchivo } from '../../components/inalde/VisorArchivo';

interface Cohorte { id: string; etiqueta: string; activa: boolean; }
interface Config { evento_nombre: string; expo: number; trans: number; foto: number; cierre: number; break_min: number; bloque: number; }
interface Slot {
  slot: number; proyecto_id: string; proyecto: string; autores: string; sector: string;
  jornada_fija: number | null; // día al que está fijado (casos especiales); null = libre
  hora_inicio: string; hora_fin: string;
  resumen: string | null; linkedin: string | null; one_pager_url: string | null; logo_url: string | null;
}
interface Actividad { tipo: string; desc: string; hora_inicio: string; hora_fin: string; }
interface Jornada {
  id: string; numero: number; fecha: string; fecha_legible?: string;
  hora_inicio: string | null; hora_fin: string | null;
  foto_inicial: boolean; intro_min: number;
  // Dos pausas largas independientes: el break de la jornada y el almuerzo.
  break_jornada: boolean; break_jornada_min: number; break_jornada_tras_slot: number | null;
  almuerzo: boolean; almuerzo_min: number; almuerzo_tras_slot: number | null;
  slots: Slot[]; actividades: Actividad[];
}
interface Proyecto { proyecto_id: string; equipo_id: string; proyecto: string; autores: string; sector: string; asignado: boolean; jornada_fija: number | null; }

// Color estable por sector: mismo sector, mismo color en toda la tabla.
// Solo tokens del sistema (tailwind.config.ts): azul, dorado, texto y rojo
// oscuro. Los cuatro son oscuros, así que el texto blanco siempre contrasta.
const SECTOR_COLORS = ['#224d7c', '#9f885f', '#1a1a1a', '#cc292b'];
function colorSector(sector: string): string {
  let h = 0;
  for (let i = 0; i < sector.length; i++) h = (h * 31 + sector.charCodeAt(i)) >>> 0;
  return SECTOR_COLORS[h % SECTOR_COLORS.length];
}

// Slots y actividades en una sola lista, en orden cronológico (como se vive la
// jornada): foto e introducción arriba, breaks y cierre en su sitio.
type Fila = { kind: 'proyecto'; idx: number; s: Slot } | { kind: 'actividad'; a: Actividad };
function filasDe(j: Jornada): Fila[] {
  const filas: Fila[] = [
    ...j.slots.map((s, idx) => ({ kind: 'proyecto' as const, idx, s })),
    ...j.actividades.map((a) => ({ kind: 'actividad' as const, a })),
  ];
  return filas.sort((x, y) => {
    const hx = x.kind === 'proyecto' ? x.s.hora_inicio : x.a.hora_inicio;
    const hy = y.kind === 'proyecto' ? y.s.hora_inicio : y.a.hora_inicio;
    return hx.localeCompare(hy);
  });
}

// Duración y ubicación de una pausa larga (pausa adicional o almuerzo) de una
// jornada. En vez de «tras el slot [número]», un menú con las presentaciones del
// día: «Automático» o «después de la 7 · Nombre del proyecto».
// Número que se guarda al salir de la casilla o con Enter, no a cada tecla ni a
// cada clic de las flechas: antes cada cambio guardaba y recargaba la página, y
// no se podía escribir un número de dos cifras (JMV, 17-nov-2026).
function NumeroDiferido({ valor, min, max, step = 1, onGuardar, className }: {
  valor: number; min: number; max: number; step?: number; onGuardar: (v: number) => void; className?: string;
}) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => { setTexto(String(valor)); }, [valor]);
  const confirmar = () => {
    const v = Number(texto);
    if (texto.trim() === '' || !Number.isFinite(v) || v < min || v > max) { setTexto(String(valor)); return; }
    if (v !== valor) onGuardar(Math.round(v));
  };
  return (
    <input type="number" min={min} max={max} step={step} value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={className} />
  );
}

function PausaJornada({ minutos, trasSlot, slots, onMinutos, onTrasSlot }: {
  minutos: number; trasSlot: number | null; slots: Slot[];
  onMinutos: (v: number) => void; onTrasSlot: (v: number | null) => void;
}) {
  return (
    <>
      <label className="text-xs flex items-center gap-1">
        de
        <NumeroDiferido valor={minutos} min={5} max={240} step={5} onGuardar={onMinutos}
          className="w-14 text-inalde-text rounded px-1 py-0.5" /> min, después de
      </label>
      <select value={trasSlot ?? ''} onChange={(e) => onTrasSlot(e.target.value === '' ? null : Number(e.target.value))}
        className="text-xs text-inalde-text rounded px-1 py-0.5 max-w-[220px]">
        <option value="">Automático (a mitad de la jornada)</option>
        {slots.slice(0, -1).map((s, i) => (
          // value = posición dentro del día (lo que usa el motor); texto = número corrido del evento.
          <option key={s.proyecto_id} value={i + 1}>la presentación {s.slot} · {s.proyecto}</option>
        ))}
        {trasSlot != null && trasSlot > Math.max(0, slots.length - 1) && <option value={trasSlot}>la presentación {trasSlot}</option>}
      </select>
    </>
  );
}

export default function Programacion() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [sinProyectoFinal, setSinProyectoFinal] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  // Archivo abierto en el visor emergente (logo / one pager). Null = cerrado.
  const [visor, setVisor] = useState<{ url: string; titulo: string } | null>(null);

  async function copiar(id: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch { setMsg({ kind: 'err', text: 'El navegador no permitió copiar al portapapeles.' }); }
  }
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [notificando, setNotificando] = useState(false);
  const [publicadaAt, setPublicadaAt] = useState<string | null>(null);
  const [publicando, setPublicando] = useState(false);
  const [repartiendo, setRepartiendo] = useState(false);

  // Publicada = definitiva. Deja de ser editable aquí y pasa a ser visible para
  // marketing, operaciones y el asistente de programa.
  const publicada = !!publicadaAt;

  async function notificar() {
    setNotificando(true); setMsg(null);
    try {
      const { data } = await api.post(`/programacion/admin/${cohorte}/notificar`, {});
      setMsg({ kind: 'ok', text: `Notificados ${data.notificados} participante(s) de ${data.proyectos} proyecto(s) programado(s).` });
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setNotificando(false); }
  }

  // Repartir los proyectos entre las jornadas. Se abre un panel con el total y
  // una casilla por jornada (JMV no siempre quiere partes iguales: p. ej. 20 y
  // 15). Arranca con el reparto parejo y la suma tiene que dar el total.
  const [reparto, setReparto] = useState<number[] | null>(null);
  const [agruparSector, setAgruparSector] = useState(true);
  function abrirReparto() {
    const total = proyectos.length, dias = jornadas.length;
    const base = Math.floor(total / dias), sobran = total % dias;
    setReparto(jornadas.map((_, i) => base + (i < sobran ? 1 : 0)));
  }
  async function repartir() {
    if (!reparto) return;
    setRepartiendo(true); setMsg(null);
    try {
      const { data } = await api.post(`/programacion/admin/${cohorte}/repartir`, { por_jornada: reparto, agrupar_por_sector: agruparSector });
      const detalle = (data.por_jornada ?? []).map((p: any) => `jornada ${p.numero}: ${p.proyectos}`).join(' · ');
      setMsg({ kind: 'ok', text: `Repartidos ${data.repartidos} proyecto(s) — ${detalle}.` });
      setReparto(null);
      load(true);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setRepartiendo(false); }
  }

  async function publicar() {
    // Doble confirmación a propósito: es irreversible y no hay botón para
    // deshacerlo. Escribir PUBLICAR obliga a leer lo que va a pasar.
    const asignados = jornadas.reduce((n, j) => n + j.slots.length, 0);
    const aviso = [
      'Vas a PUBLICAR la programación. Esto es definitivo:',
      '',
      `· Quedan fijos ${asignados} proyecto(s) en ${jornadas.length} jornada(s).`,
      '· No podrás reordenar, agregar ni quitar proyectos nunca más.',
      '· No podrás cambiar los tiempos del evento ni las jornadas.',
      '· Marketing, operaciones y el asistente de programa la verán de inmediato.',
      '· Cada participante recibe un aviso en la plataforma (campana) con su día, número y hora, y desde ese momento los ve en «Mi presentación».',
      '',
      'No hay forma de deshacerlo desde el sistema.',
    ].join('\n');
    const escrito = await pedirTexto({
      titulo: 'Publicar la programación',
      mensaje: aviso,
      etiqueta: 'Escribe PUBLICAR para confirmar',
      exacto: 'PUBLICAR',
      aceptar: 'Publicar',
      tono: 'peligro',
    });
    if (escrito !== 'PUBLICAR') return;

    setPublicando(true); setMsg(null);
    try {
      const { data } = await api.post(`/programacion/admin/${cohorte}/publicar`, {});
      setMsg(data.aviso
        ? { kind: 'err', text: data.aviso }
        : { kind: 'ok', text: `Programación publicada. Notificados ${data.notificados} participante(s) de ${data.proyectos} proyecto(s). Ya es visible para marketing, operaciones y el asistente de programa.` });
      load(true);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setPublicando(false); }
  }

  useEffect(() => { (async () => {
    setCohortes(((await api.get('/admin/cohortes')).data as Cohorte[]).filter((c) => c.activa));
  })(); }, []);

  // silencioso: recarga los datos sin el «Cargando…» que desmonta la tabla (y
  // hace saltar la página) ni borra el mensaje que se acaba de mostrar.
  async function load(silencioso = false) {
    if (!cohorte) { setConfig(null); setJornadas([]); setProyectos([]); return; }
    if (!silencioso) { setLoading(true); setMsg(null); }
    try {
      const { data } = await api.get(`/programacion/admin/${cohorte}`);
      setConfig(data.config); setJornadas(data.jornadas ?? []); setProyectos(data.proyectos ?? []);
      setSinProyectoFinal(data.equipos_sin_proyecto_final ?? 0);
      setPublicadaAt(data.publicada_at ?? null);
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
      setMsg({ kind: 'ok', text: 'Configuración guardada.' }); load(true);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }

  async function guardarJornada(j: Jornada, cambios: {
    foto_inicial?: boolean; intro_min?: number; hora_inicio?: string;
    break_jornada?: boolean; break_jornada_min?: number; break_jornada_tras_slot?: number | null;
    almuerzo?: boolean; almuerzo_min?: number; almuerzo_tras_slot?: number | null;
    proyecto_ids?: string[];
  }) {
    try {
      await api.put(`/programacion/admin/jornada/${j.id}`, cambios);
      load(true);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }

  // Fija un proyecto a una jornada (o lo libera). Lo aplica el próximo «Repartir».
  async function fijarJornada(proyectoId: string, jornada: number | null) {
    try {
      await api.patch(`/programacion/admin/proyecto/${proyectoId}/jornada-fija`, { jornada });
      load(true);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }

  function idsDe(j: Jornada) { return j.slots.map((s) => s.proyecto_id); }
  function asignar(j: Jornada, proyectoId: string) { guardarJornada(j, { proyecto_ids: [...idsDe(j), proyectoId] }); }
  function quitar(j: Jornada, proyectoId: string) { guardarJornada(j, { proyecto_ids: idsDe(j).filter((x) => x !== proyectoId) }); }
  function mover(j: Jornada, idx: number, dir: -1 | 1) {
    const ids = idsDe(j); const ni = idx + dir; if (ni < 0 || ni >= ids.length) return;
    [ids[idx], ids[ni]] = [ids[ni], ids[idx]]; guardarJornada(j, { proyecto_ids: ids });
  }

  const disponibles = proyectos.filter((e) => !e.asignado);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Programación de presentaciones</h1>
        <p className="text-sm text-inalde-gray mt-2">Asigna a los slots de cada jornada los proyectos que ya entregaron su proyecto final: son los únicos que se presentan. Los horarios se calculan automáticamente. Descarga el Excel de calificación para los panelistas.</p>
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
            {/* Solo con la programación publicada: antes, el aviso llevaría a los
                participantes un horario que todavía puede cambiar. Publicar ya avisa. */}
            {publicada && (
              <button onClick={notificar} disabled={notificando} className="btn-inalde-secondary !py-2 !px-4 !text-xs disabled:opacity-50" title="Vuelve a enviar a cada participante la fecha y hora de su presentación (aviso dentro de la plataforma)">{notificando ? 'Notificando…' : '🔔 Reenviar aviso'}</button>
            )}
            {!publicada && proyectos.length > 0 && jornadas.length > 1 && (
              <button onClick={abrirReparto} disabled={repartiendo || !!reparto} className="btn-inalde-secondary !py-2 !px-4 !text-xs disabled:opacity-50"
                title="Decide cuántos proyectos presentan cada día y el sistema los reparte entre las jornadas">
                {repartiendo ? 'Repartiendo…' : '⇄ Repartir entre las jornadas'}
              </button>
            )}
            {!publicada && (
              <button onClick={publicar} disabled={publicando || !jornadas.some((j) => j.slots.length > 0)} className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-50"
                title="Deja la programación definitiva y la hace visible para marketing, operaciones y el asistente de programa">
                {publicando ? 'Publicando…' : '🔒 Publicar programación'}
              </button>
            )}
          </>
        )}
      </div>

      {publicada && (
        <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm mb-5">
          <p className="font-semibold text-inalde-text mb-0.5"><span aria-hidden="true">🔒 </span>Programación publicada — definitiva</p>
          <p className="text-inalde-gray">
            Se publicó el {new Date(publicadaAt!).toLocaleString('es-CO')}. Ya no se puede modificar: ni el orden, ni los tiempos, ni las jornadas.
            Marketing, operaciones y el asistente de programa la están viendo en su Programación Interna.
          </p>
        </div>
      )}

      {msg && <div className={`rounded border-l-4 px-4 py-3 text-sm mb-5 whitespace-pre-line ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>{msg.text}</div>}

      {cohorte && !loading && !publicada && proyectos.length > 0 && (
        <p className="text-sm text-inalde-text mb-4">
          <strong>{proyectos.length}</strong> proyecto(s) para presentar
          {' · '}{proyectos.filter((p) => p.asignado).length} ya programado(s)
          {disponibles.length > 0 && <> · <span className="text-inalde-red">{disponibles.length} sin programar</span></>}
          {sinProyectoFinal > 0 && <span className="text-inalde-gray"> · {sinProyectoFinal} equipo(s) aún sin entrega final completa (no entran)</span>}
        </p>
      )}

      {reparto && (() => {
        const suma = reparto.reduce((a, b) => a + b, 0);
        const total = proyectos.length;
        const cuadra = suma === total;
        const sinHora = jornadas.filter((j, i) => reparto[i] > 0 && !j.hora_inicio).map((j) => j.numero);
        return (
          <div className="border-2 border-inalde-blue rounded-lg p-4 mb-5 bg-blue-50/40">
            <h3 className="font-primary font-bold text-inalde-text mb-1">Repartir proyectos entre las jornadas</h3>
            <p className="text-sm text-inalde-gray mb-3">
              Hay <strong className="text-inalde-text">{total}</strong> proyecto(s) para presentar. Escribe cuántos presentan cada día.
              Los primeros van a la jornada 1 y así sucesivamente.
            </p>
            <label className="flex items-start gap-2 text-sm mb-3">
              <input type="checkbox" checked={agruparSector} onChange={(e) => setAgruparSector(e.target.checked)} className="mt-1" />
              <span>
                <strong>Agrupar por sector</strong> (recomendado): los proyectos de un mismo sector quedan seguidos.
                {!agruparSector && <span className="text-inalde-gray"> Sin esto se conserva el orden actual de la programación.</span>}
              </span>
            </label>
            <div className="flex flex-wrap gap-4 items-end mb-3">
              {jornadas.map((j, i) => (
                <label key={j.id} className="text-sm">
                  <span className="block text-xs text-inalde-gray capitalize mb-1">Jornada {j.numero} · {j.fecha_legible ?? j.fecha}</span>
                  <input type="number" min={0} max={total} value={reparto[i]}
                    onChange={(e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); setReparto(reparto.map((x, k) => (k === i ? v : x))); }}
                    className="input-inalde !py-1.5 w-24" /> proyectos
                </label>
              ))}
              <span className={`text-sm font-semibold ${cuadra ? 'text-green-700' : 'text-inalde-red'}`}>
                Suma: {suma} de {total}{cuadra ? ' ✓' : suma > total ? ` (sobran ${suma - total})` : ` (faltan ${total - suma})`}
              </span>
            </div>
            {(() => {
              const fijos = jornadas.map((jj, i) => ({ jj, i, n: proyectos.filter((p) => p.jornada_fija === jj.numero).length })).filter((x) => x.n > 0);
              if (!fijos.length) return null;
              const exceden = fijos.filter(({ i, n }) => n > reparto[i]);
              return (
                <p className={`text-sm mb-3 ${exceden.length ? 'text-inalde-red' : 'text-inalde-gray'}`}>
                  📌 Fijados: {fijos.map(({ jj, n }) => `${n} en la jornada ${jj.numero}`).join(' · ')}. Se quedan en su día; los demás se acomodan alrededor.
                  {exceden.length > 0 && ` La jornada ${exceden.map(({ jj }) => jj.numero).join(' y ')} tiene más fijados que su cantidad: súbela.`}
                </p>
              );
            })()}
            {sinHora.length > 0 && (
              <p className="text-sm text-inalde-red mb-3">La jornada {sinHora.join(' y ')} no tiene hora de inicio. Ponla en la barra de la jornada antes de repartir.</p>
            )}
            <div className="flex gap-2">
              <button onClick={repartir} disabled={!cuadra || sinHora.length > 0 || repartiendo} className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-50">{repartiendo ? 'Repartiendo…' : 'Repartir'}</button>
              <button onClick={() => setReparto(null)} disabled={repartiendo} className="btn-inalde-secondary !py-2 !px-4 !text-xs">Cancelar</button>
            </div>
          </div>
        );
      })()}

      {!cohorte ? null : loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <>
          {config && !publicada && (
            <div className="bg-inalde-gray-bg/40 border border-inalde-gray-light rounded p-3 mb-5">
              <h3 className="text-xs font-primary font-semibold uppercase tracking-wider text-inalde-gray mb-2">Tiempos del evento (minutos)</h3>
              <div className="flex flex-wrap gap-3 items-end">
                {([['evento_nombre', 'Evento', 'text'], ['expo', 'Exposición', 'n'], ['trans', 'Transición', 'n'], ['foto', 'Foto inicial', 'n'], ['cierre', 'Cierre', 'n'], ['break_min', 'Break entre bloques', 'n'], ['bloque', 'Presentaciones por bloque', 'n']] as const).map(([k, l, t]) => (
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
            <p className="text-inalde-gray text-sm">
              Las jornadas salen del cronograma de la cohorte y esta todavía no tiene fechas de presentaciones.
              Ponlas en <strong>Cohortes → Editar</strong>, en los hitos <strong>12 (Primera jornada presentaciones)</strong> y <strong>13 (Segunda jornada presentaciones)</strong>, y aparecerán aquí solas.
            </p>
          ) : jornadas.map((j) => (
            <div key={j.id} className="border border-inalde-gray-light rounded-lg mb-5 overflow-hidden">
              <div className="bg-inalde-text text-white px-4 py-2.5 flex flex-wrap items-center gap-3">
                <span className="font-primary font-extrabold tracking-widest uppercase text-sm"><span aria-hidden="true">📅 </span>Jornada {j.numero}</span>
                {/* La fecha no se edita: viene del cronograma (hito 12/13). */}
                <span className="text-white/70 text-sm capitalize" title={`Del cronograma de la cohorte — hito ${j.numero === 1 ? '12' : '13'}. Para cambiarla, edita la cohorte.`}>
                  {j.fecha_legible ?? j.fecha}
                </span>
                {publicada ? (
                  <span className="text-xs text-white/70 ml-auto">
                    {(j.hora_inicio ?? '').slice(0, 5) || '—'}–{(j.hora_fin ?? '').slice(0, 5) || '—'} · {j.foto_inicial ? 'con foto inicial · ' : ''}intro {j.intro_min} min{j.break_jornada ? ` · break ${j.break_jornada_min} min` : ''}{j.almuerzo ? ` · almuerzo ${j.almuerzo_min} min` : ''}
                  </span>
                ) : (
                  <>
                    <label className="text-xs flex items-center gap-1 ml-auto" title="Hora en que arranca la jornada: la primera actividad (foto o introducción). Las presentaciones empiezan después.">
                      Inicio de la jornada
                      <input type="time" defaultValue={(j.hora_inicio ?? '').slice(0, 5)}
                        onBlur={(e) => { if (e.target.value && e.target.value !== (j.hora_inicio ?? '').slice(0, 5)) guardarJornada(j, { hora_inicio: e.target.value }); }}
                        className="text-inalde-text rounded px-1 py-0.5" />
                    </label>
                    {/* El fin no se elige: la jornada termina cuando termina su
                        última franja. Se muestra calculado para que el admin lo
                        vea moverse al agregar o quitar proyectos. */}
                    <span className="text-xs text-white/70" title="La calcula el sistema: la jornada termina al acabar la última franja (el cierre). Cambia sola al agregar o quitar proyectos.">
                      Termina (calculado) <span className="font-mono text-white">{(j.hora_fin ?? '').slice(0, 5) || '—'}</span>
                    </span>
                    <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={j.foto_inicial} onChange={(e) => guardarJornada(j, { foto_inicial: e.target.checked })} /> Foto inicial</label>
                    <label className="text-xs flex items-center gap-1">Intro <NumeroDiferido valor={j.intro_min} min={0} max={240} onGuardar={(v) => guardarJornada(j, { intro_min: v })} className="w-14 text-inalde-text rounded px-1 py-0.5" /> min</label>
                    {/* Break y almuerzo son DOS pausas distintas y de cada
                        jornada: un día se para a almorzar y el otro no, y la
                        parada no siempre dura lo mismo. Se pueden tener las dos.
                        Aparte está el break automático de fin de bloque, que es
                        de la cohorte y dura lo mismo en todas las jornadas. */}
                    <label className="text-xs flex items-center gap-1" title="Una pausa larga solo para este día, además de los breaks automáticos entre bloques. Reemplaza el break que caiga en ese punto."><input type="checkbox" checked={j.break_jornada} onChange={(e) => guardarJornada(j, { break_jornada: e.target.checked })} /> Pausa adicional</label>
                    {j.break_jornada && (
                      <PausaJornada
                        minutos={j.break_jornada_min} trasSlot={j.break_jornada_tras_slot} slots={j.slots}
                        onMinutos={(v) => guardarJornada(j, { break_jornada_min: v })}
                        onTrasSlot={(v) => guardarJornada(j, { break_jornada_tras_slot: v })} />
                    )}
                    <label className="text-xs flex items-center gap-1" title="La parada para almorzar de este día. Es independiente de la pausa adicional."><input type="checkbox" checked={j.almuerzo} onChange={(e) => guardarJornada(j, { almuerzo: e.target.checked })} /> Almuerzo</label>
                    {j.almuerzo && (
                      <PausaJornada
                        minutos={j.almuerzo_min} trasSlot={j.almuerzo_tras_slot} slots={j.slots}
                        onMinutos={(v) => guardarJornada(j, { almuerzo_min: v })}
                        onTrasSlot={(v) => guardarJornada(j, { almuerzo_tras_slot: v })} />
                    )}
                    {config && (
                      <span className="basis-full text-[11px] text-white/60">
                        Cada {config.bloque} presentaciones hay un break de {config.break_min} min (se cambia en «Tiempos del evento»).
                        La pausa adicional y el almuerzo reemplazan el break que caiga en ese punto; si los dos caen en el mismo sitio, queda solo el almuerzo.
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="tabla-scroll">
                {/* Los anchos se declaran UNA vez en el colgroup y el layout es
                    fijo: con table-auto el navegador reparte el sobrante a su
                    manera y la cabecera deja de caer sobre su columna. */}
                <table className="w-full min-w-[1280px] table-fixed border-collapse bg-white">
                  {/* Sin columna de logo: la miniatura repetía lo que ya abre el
                      botón "Logo" de Archivos, y sus 95 px se los reparten
                      Autores y Resumen, que sí necesitan ancho para leerse. */}
                  <colgroup>
                    <col className="w-[70px]" /><col className="w-[130px]" /><col className="w-[190px]" />
                    <col className="w-[150px]" /><col className="w-[290px]" /><col className="w-[250px]" />
                    <col className="w-[120px]" /><col className="w-[80px]" />
                  </colgroup>
                  {/* El encabezado de columnas solo tiene sentido si la jornada
                      tiene proyectos. En jornadas de solo actividades (p. ej. la
                      apertura) se oculta para no mostrar columnas vacías. */}
                  {j.slots.length > 0 && (
                  <thead>
                    <tr className="bg-inalde-text text-white">
                      {/* La sexta columna muestra el RESUMEN del proyecto; el one
                          pager vive en "Archivos", que es donde se abre y se baja. */}
                      {['Slot', 'Proyecto', 'Autores', 'Sector', 'Resumen', 'Post LinkedIn', 'Archivos', ''].map((h, i) => (
                        <th key={i} scope="col" className="bg-inalde-text text-left font-primary font-bold text-[0.68rem] tracking-widest uppercase whitespace-nowrap px-3 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  )}
                  <tbody>
                    {filasDe(j).map((f) => f.kind === 'actividad' ? (
                      <tr key={`act-${f.a.tipo}-${f.a.hora_inicio}`} className="bg-inalde-gray-bg">
                        <td colSpan={8} className="border-l-4 border-inalde-red px-4 py-3">
                          <span className="font-primary font-extrabold text-[0.85rem] text-inalde-text">
                            <span aria-hidden="true">🕐 </span>{f.a.hora_inicio} – {f.a.hora_fin} hrs. — {f.a.desc}
                          </span>
                        </td>
                      </tr>
                    ) : (
                      <tr key={f.s.proyecto_id} className="border-b border-inalde-gray-light align-top">
                        <td className="text-center px-3 py-2.5">
                          <strong className="font-primary text-inalde-text">{f.s.slot}</strong>
                          <span className="block text-[0.7rem] text-inalde-gray mt-0.5 font-mono">{f.s.hora_inicio}–{f.s.hora_fin}</span>
                          {publicada ? (
                            f.s.jornada_fija != null && <span className="block text-[0.65rem] text-inalde-blue mt-1">📌 Día {f.s.jornada_fija}</span>
                          ) : (
                            <select value={f.s.jornada_fija ?? ''} onChange={(e) => fijarJornada(f.s.proyecto_id, e.target.value === '' ? null : Number(e.target.value))}
                              title="Fija este proyecto a un día: «Repartir» lo deja siempre en esa jornada"
                              className={`mt-1 text-[0.65rem] rounded border px-0.5 py-0.5 max-w-[84px] ${f.s.jornada_fija != null ? 'border-inalde-blue text-inalde-blue font-semibold' : 'border-inalde-gray-light text-inalde-gray'}`}>
                              <option value="">Día libre</option>
                              {jornadas.map((jj) => <option key={jj.id} value={jj.numero}>📌 Día {jj.numero}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-primary font-bold text-[0.85rem] text-inalde-text">{f.s.proyecto}</td>
                        {/* Autores vacío = el equipo se quedó sin miembros (p. ej.
                            tras resetear a un participante). En blanco parecía un
                            fallo de la pantalla; se dice lo que pasa. */}
                        <td className="px-3 py-2.5 text-[0.78rem] text-inalde-gray">
                          {f.s.autores
                            ? f.s.autores
                            : <span className="italic" title="Este equipo no tiene participantes registrados. Revísalo en Equipos.">Sin autores</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {f.s.sector && (
                            <span className="inline-block max-w-full text-white rounded-[3px] px-2 py-0.5 font-primary font-bold text-[0.62rem] tracking-wider uppercase whitespace-normal break-words leading-tight" style={{ background: colorSector(f.s.sector) }}>{f.s.sector}</span>
                          )}
                        </td>
                        {/* El resumen ya no se recorta a tres líneas: con la
                            columna del logo fuera tiene ancho de sobra, y al lado
                            el post de LinkedIn se muestra entero — recortar solo
                            este parecía un error. */}
                        <td className="px-3 py-2.5 text-[0.8rem] leading-relaxed align-top">
                          {f.s.resumen
                            ? f.s.resumen
                            : <span className="text-inalde-gray italic">Sin resumen</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {f.s.linkedin ? (
                            <>
                              <div className="text-[0.76rem] leading-relaxed text-inalde-text mb-1.5 whitespace-pre-line">{f.s.linkedin}</div>
                              <button onClick={() => copiar(f.s.proyecto_id, f.s.linkedin!)}
                                className={`font-primary font-bold text-[0.63rem] tracking-wider uppercase border px-2 py-1 transition-colors ${copied === f.s.proyecto_id ? 'bg-inalde-blue text-white border-inalde-blue' : 'border-inalde-gray-light text-inalde-gray hover:bg-inalde-text hover:text-white hover:border-inalde-text'}`}>
                                {copied === f.s.proyecto_id ? '✓ Copiado' : 'Copiar'}
                              </button>
                            </>
                          ) : <span className="text-[0.76rem] text-inalde-gray italic">Sin post</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {/* Abren el visor emergente: se ve el archivo encima de
                              la tabla y al cerrar se vuelve a la misma fila. */}
                          {f.s.logo_url && <button onClick={() => setVisor({ url: f.s.logo_url!, titulo: `Logo · ${f.s.proyecto}` })} className="inline-block m-0.5 px-2 py-1 rounded-[3px] font-primary font-bold text-[0.62rem] bg-inalde-gray-bg text-inalde-blue border border-inalde-blue hover:bg-inalde-blue hover:text-white whitespace-nowrap">Logo</button>}
                          {f.s.one_pager_url && <button onClick={() => setVisor({ url: f.s.one_pager_url!, titulo: `One Pager · ${f.s.proyecto}` })} className="inline-block m-0.5 px-2 py-1 rounded-[3px] font-primary font-bold text-[0.62rem] bg-inalde-gray-bg text-inalde-red border border-inalde-red hover:bg-inalde-red hover:text-white whitespace-nowrap">One Pager</button>}
                          {!f.s.logo_url && !f.s.one_pager_url && <span className="text-[0.7rem] text-inalde-gray italic">—</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right whitespace-nowrap">
                          {!publicada && (
                            <>
                              <button onClick={() => mover(j, f.idx, -1)} disabled={f.idx === 0} aria-label={`Subir ${f.s.proyecto}`} className="text-inalde-gray disabled:opacity-30 px-1">↑</button>
                              <button onClick={() => mover(j, f.idx, 1)} disabled={f.idx === j.slots.length - 1} aria-label={`Bajar ${f.s.proyecto}`} className="text-inalde-gray disabled:opacity-30 px-1">↓</button>
                              <button onClick={() => quitar(j, f.s.proyecto_id)} aria-label={`Quitar ${f.s.proyecto} de la jornada`} className="text-inalde-gray hover:text-inalde-red px-1">✕</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {j.slots.length === 0 && <tr><td colSpan={8} className="py-3 text-center text-inalde-gray italic text-xs">Sin proyectos asignados</td></tr>}
                    {/* Sin hora de inicio el servidor no calcula la escaleta: los
                        horarios llegan como '--:--'. Se dice por qué, en vez de
                        dejar al admin mirando guiones. */}
                    {!j.hora_inicio && (
                      <tr><td colSpan={8} className="px-4 py-3 text-xs text-inalde-text bg-inalde-gray-bg border-l-4 border-inalde-red">
                        Esta jornada <strong>no tiene hora de inicio</strong>, así que no se pueden calcular los horarios. Ponle la hora de inicio arriba y se recalculan solos.
                      </td></tr>
                    )}
                    {/* El almuerzo parte el día EN DOS: con menos de dos
                        presentaciones no hay dónde partirlo y la franja no
                        aparece. Se dice, en vez de dejar la casilla marcada sin
                        efecto visible. */}
                    {j.almuerzo && j.slots.length < 2 && (
                      <tr><td colSpan={8} className="px-4 py-3 text-xs text-inalde-text bg-inalde-gray-bg border-l-4 border-inalde-red">
                        El <strong>almuerzo</strong> parte la jornada en dos, así que necesita al menos dos presentaciones. Asigna proyectos y la franja aparecerá sola.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {disponibles.length > 0 && !publicada && (
                <div className="p-3">
                  <select onChange={(e) => { if (e.target.value) { asignar(j, e.target.value); e.target.value = ''; } }} className="input-inalde !py-1.5 text-sm">
                    <option value="">+ Agregar proyecto a esta jornada…</option>
                    {disponibles.map((e) => <option key={e.proyecto_id} value={e.proyecto_id}>{e.proyecto} — {e.autores.slice(0, 40)}</option>)}
                  </select>
                </div>
              )}
            </div>
          ))}

          {disponibles.length > 0 && (
            <p className="text-xs text-inalde-gray">Proyectos sin asignar a ninguna jornada: <strong>{disponibles.length}</strong></p>
          )}
          {sinProyectoFinal > 0 && (
            <p className="text-xs text-inalde-gray mt-1">
              <strong>{sinProyectoFinal}</strong> equipo(s) todavía no tienen los 4 documentos completos (Business Plan, One Pager, Logo y Modelo Financiero), así que aún no son programables. Aparecerán aquí en cuanto los suban todos.
            </p>
          )}
        </>
      )}

      {visor && <VisorArchivo url={visor.url} titulo={visor.titulo} onClose={() => setVisor(null)} />}
    </>
  );
}
