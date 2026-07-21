import { useEffect, useState } from 'react';
import { api, downloadFile } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; activa: boolean; }
interface Config { evento_nombre: string; expo: number; trans: number; foto: number; cierre: number; break_min: number; bloque: number; }
interface Slot {
  slot: number; proyecto_id: string; proyecto: string; autores: string; sector: string;
  hora_inicio: string; hora_fin: string;
  resumen: string | null; linkedin: string | null; one_pager_url: string | null; logo_url: string | null;
}
interface Actividad { tipo: string; desc: string; hora_inicio: string; hora_fin: string; }
interface Jornada { id: string; numero: number; fecha: string; fecha_legible?: string; hora_inicio: string | null; hora_fin: string | null; foto_inicial: boolean; intro_min: number; slots: Slot[]; actividades: Actividad[]; }
interface Proyecto { proyecto_id: string; equipo_id: string; proyecto: string; autores: string; sector: string; asignado: boolean; }

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

export default function Programacion() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [sinProyectoFinal, setSinProyectoFinal] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

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
      '· Se notificará a los participantes.',
      '',
      'No hay forma de deshacerlo desde el sistema.',
      '',
      'Escribe PUBLICAR para confirmar:',
    ].join('\n');
    if (prompt(aviso) !== 'PUBLICAR') return;

    setPublicando(true); setMsg(null);
    try {
      const { data } = await api.post(`/programacion/admin/${cohorte}/publicar`, {});
      setMsg(data.aviso
        ? { kind: 'err', text: data.aviso }
        : { kind: 'ok', text: `Programación publicada. Notificados ${data.notificados} participante(s) de ${data.proyectos} proyecto(s). Ya es visible para marketing, operaciones y el asistente de programa.` });
      load();
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setPublicando(false); }
  }

  useEffect(() => { (async () => {
    setCohortes(((await api.get('/admin/cohortes')).data as Cohorte[]).filter((c) => c.activa));
  })(); }, []);

  async function load() {
    if (!cohorte) { setConfig(null); setJornadas([]); setProyectos([]); return; }
    setLoading(true); setMsg(null);
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
      setMsg({ kind: 'ok', text: 'Configuración guardada.' }); load();
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }

  async function guardarJornada(j: Jornada, cambios: { foto_inicial?: boolean; intro_min?: number; hora_inicio?: string; hora_fin?: string; proyecto_ids?: string[] }) {
    try {
      await api.put(`/programacion/admin/jornada/${j.id}`, cambios);
      load();
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
            <button onClick={notificar} disabled={notificando} className="btn-inalde-secondary !py-2 !px-4 !text-xs disabled:opacity-50" title="Reenvía a cada participante la fecha y hora de su presentación">{notificando ? 'Notificando…' : '🔔 Reenviar aviso'}</button>
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

      {msg && <div className={`rounded border-l-4 px-4 py-3 text-sm mb-5 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>{msg.text}</div>}

      {!cohorte ? null : loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <>
          {config && !publicada && (
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
                    {(j.hora_inicio ?? '').slice(0, 5)}–{(j.hora_fin ?? '').slice(0, 5)} · {j.foto_inicial ? 'con foto inicial · ' : ''}intro {j.intro_min} min
                  </span>
                ) : (
                  <>
                    <label className="text-xs flex items-center gap-1 ml-auto">
                      Inicio
                      <input type="time" defaultValue={(j.hora_inicio ?? '').slice(0, 5)}
                        onBlur={(e) => { if (e.target.value && e.target.value !== (j.hora_inicio ?? '').slice(0, 5)) guardarJornada(j, { hora_inicio: e.target.value }); }}
                        className="text-inalde-text rounded px-1 py-0.5" />
                    </label>
                    <label className="text-xs flex items-center gap-1">
                      Fin
                      <input type="time" defaultValue={(j.hora_fin ?? '').slice(0, 5)}
                        onBlur={(e) => { if (e.target.value && e.target.value !== (j.hora_fin ?? '').slice(0, 5)) guardarJornada(j, { hora_fin: e.target.value }); }}
                        className="text-inalde-text rounded px-1 py-0.5" />
                    </label>
                    <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={j.foto_inicial} onChange={(e) => guardarJornada(j, { foto_inicial: e.target.checked })} /> Foto inicial</label>
                    <label className="text-xs flex items-center gap-1">Intro <input type="number" value={j.intro_min} min={0} onChange={(e) => guardarJornada(j, { intro_min: Number(e.target.value) })} className="w-14 text-inalde-text rounded px-1 py-0.5" /> min</label>
                  </>
                )}
              </div>
              <div className="overflow-x-auto">
                {/* Los anchos se declaran UNA vez en el colgroup y el layout es
                    fijo: con table-auto el navegador reparte el sobrante a su
                    manera y la cabecera deja de caer sobre su columna. */}
                <table className="w-full min-w-[1305px] table-fixed border-collapse bg-white">
                  <colgroup>
                    <col className="w-[70px]" /><col className="w-[120px]" /><col className="w-[190px]" />
                    <col className="w-[130px]" /><col className="w-[75px]" /><col className="w-[240px]" />
                    <col className="w-[260px]" /><col className="w-[130px]" /><col className="w-[90px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-inalde-text text-white">
                      {['Slot', 'Proyecto', 'Autores', 'Sector', 'Logo', 'One Pager', 'Post LinkedIn', 'Descargas', ''].map((h, i) => (
                        <th key={i} scope="col" className="text-left font-primary font-bold text-[0.68rem] tracking-widest uppercase whitespace-nowrap px-3 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filasDe(j).map((f) => f.kind === 'actividad' ? (
                      <tr key={`act-${f.a.tipo}-${f.a.hora_inicio}`} className="bg-inalde-gray-bg">
                        <td colSpan={9} className="border-l-4 border-inalde-red px-4 py-3">
                          <span className="font-primary font-extrabold text-[0.85rem] text-inalde-text">
                            <span aria-hidden="true">🕐 </span>{f.a.hora_inicio} – {f.a.hora_fin} hrs. — {f.a.desc}
                          </span>
                        </td>
                      </tr>
                    ) : (
                      <tr key={f.s.proyecto_id} className="border-b border-inalde-gray-light align-middle">
                        <td className="text-center px-3 py-2.5">
                          <strong className="font-primary text-inalde-text">{f.s.slot}</strong>
                          <span className="block text-[0.7rem] text-inalde-gray mt-0.5 font-mono">{f.s.hora_inicio}–{f.s.hora_fin}</span>
                        </td>
                        <td className="px-3 py-2.5 font-primary font-bold text-[0.85rem] text-inalde-text">{f.s.proyecto}</td>
                        <td className="px-3 py-2.5 text-[0.78rem] text-inalde-gray">{f.s.autores}</td>
                        <td className="px-3 py-2.5">
                          {f.s.sector && (
                            <span className="inline-block text-white rounded-[3px] px-2 py-0.5 font-primary font-bold text-[0.62rem] tracking-wider uppercase whitespace-nowrap" style={{ background: colorSector(f.s.sector) }}>{f.s.sector}</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          {f.s.logo_url
                            ? <img src={f.s.logo_url} alt={`Logo de ${f.s.proyecto}`} className="max-w-[55px] max-h-[45px] object-contain border border-inalde-gray-light p-0.5 mx-auto" />
                            : <span className="text-[0.7rem] text-inalde-gray italic">Sin logo</span>}
                        </td>
                        <td className="px-3 py-2.5 text-[0.8rem] leading-relaxed">
                          {f.s.resumen ?? <span className="text-inalde-gray italic">Sin resumen</span>}
                          {f.s.one_pager_url && <a href={f.s.one_pager_url} target="_blank" rel="noreferrer" className="block mt-1 font-primary font-bold text-[0.7rem] text-inalde-red hover:underline">Ver One Pager →</a>}
                        </td>
                        <td className="px-3 py-2.5">
                          {f.s.linkedin ? (
                            <>
                              <div className="text-[0.76rem] leading-relaxed text-inalde-text mb-1.5">{f.s.linkedin}</div>
                              <button onClick={() => copiar(f.s.proyecto_id, f.s.linkedin!)}
                                className={`font-primary font-bold text-[0.63rem] tracking-wider uppercase border px-2 py-1 transition-colors ${copied === f.s.proyecto_id ? 'bg-inalde-blue text-white border-inalde-blue' : 'border-inalde-gray-light text-inalde-gray hover:bg-inalde-text hover:text-white hover:border-inalde-text'}`}>
                                {copied === f.s.proyecto_id ? '✓ Copiado' : 'Copiar'}
                              </button>
                            </>
                          ) : <span className="text-[0.76rem] text-inalde-gray italic">Sin post</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {f.s.logo_url && <a href={f.s.logo_url} target="_blank" rel="noreferrer" className="inline-block m-0.5 px-2 py-1 rounded-[3px] font-primary font-bold text-[0.62rem] bg-inalde-gray-bg text-inalde-blue border border-inalde-blue hover:bg-inalde-blue hover:text-white whitespace-nowrap"><span aria-hidden="true">⬇ </span>Logo</a>}
                          {f.s.one_pager_url && <a href={f.s.one_pager_url} target="_blank" rel="noreferrer" className="inline-block m-0.5 px-2 py-1 rounded-[3px] font-primary font-bold text-[0.62rem] bg-inalde-gray-bg text-inalde-red border border-inalde-red hover:bg-inalde-red hover:text-white whitespace-nowrap"><span aria-hidden="true">⬇ </span>One Pager</a>}
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
                    {j.slots.length === 0 && <tr><td colSpan={9} className="py-3 text-center text-inalde-gray italic text-xs">Sin proyectos asignados</td></tr>}
                    {/* Sin hora de inicio el servidor no calcula la escaleta: los
                        horarios llegan como '--:--'. Se dice por qué, en vez de
                        dejar al admin mirando guiones. */}
                    {!j.hora_inicio && (
                      <tr><td colSpan={9} className="px-4 py-3 text-xs text-inalde-text bg-inalde-gray-bg border-l-4 border-inalde-red">
                        Esta jornada <strong>no tiene hora de inicio</strong>, así que no se pueden calcular los horarios. Ponle la hora de inicio arriba y se recalculan solos.
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
              <strong>{sinProyectoFinal}</strong> equipo(s) todavía no han entregado su proyecto final, así que aún no son programables. Aparecerán aquí en cuanto lo carguen.
            </p>
          )}
        </>
      )}
    </>
  );
}
