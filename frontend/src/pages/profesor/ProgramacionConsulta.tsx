import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Slot {
  slot: number; proyecto: string; autores: string; sector: string;
  hora_inicio: string; hora_fin: string;
  resumen: string | null; linkedin: string | null; one_pager_url: string | null; logo_url: string | null;
}
interface Actividad { tipo: string; desc: string; hora_inicio: string; hora_fin: string; }
interface Jornada {
  id: string; numero: number; fecha: string; fecha_legible?: string;
  hora_inicio: string | null; hora_fin: string | null; slots: Slot[]; actividades: Actividad[];
}
interface CohorteBloque {
  cohorte_id: string; etiqueta: string; publicada: boolean; publicada_at: string | null; jornadas: Jornada[];
}

// Color estable por sector (mismos tokens del sistema que la vista de admin).
const SECTOR_COLORS = ['#224d7c', '#9f885f', '#1a1a1a', '#cc292b'];
function colorSector(sector: string): string {
  let h = 0;
  for (let i = 0; i < sector.length; i++) h = (h * 31 + sector.charCodeAt(i)) >>> 0;
  return SECTOR_COLORS[h % SECTOR_COLORS.length];
}

// Slots y actividades en una sola lista, en orden cronológico.
type Fila = { kind: 'proyecto'; s: Slot } | { kind: 'actividad'; a: Actividad };
function filasDe(j: Jornada): Fila[] {
  const filas: Fila[] = [
    ...j.slots.map((s) => ({ kind: 'proyecto' as const, s })),
    ...j.actividades.map((a) => ({ kind: 'actividad' as const, a })),
  ];
  return filas.sort((x, y) => {
    const hx = x.kind === 'proyecto' ? x.s.hora_inicio : x.a.hora_inicio;
    const hy = y.kind === 'proyecto' ? y.s.hora_inicio : y.a.hora_inicio;
    return hx.localeCompare(hy);
  });
}

export default function ProgramacionConsulta() {
  const [cohortes, setCohortes] = useState<CohorteBloque[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true); setErr('');
      try {
        const { data } = await api.get('/profesor-consulta/programacion');
        setCohortes(data.cohortes ?? []);
      } catch (e: any) { setErr(formatBackendError(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  async function copiar(id: string, texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopied(id); setTimeout(() => setCopied(''), 2000); } catch { /* noop */ }
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[1200px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="section-subtitle mb-2">Mis cohortes asignadas</p>
              <h1 className="section-title">Programación final</h1>
              <p className="text-inalde-gray text-sm mt-2">
                Consulta la programación publicada de las presentaciones de tus cohortes. Vista de solo lectura.
              </p>
            </div>
            <Link to="/" className="text-sm text-inalde-gray hover:text-inalde-text whitespace-nowrap">
              ← Volver al inicio
            </Link>
          </div>

          {err && <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6">{err}</div>}

          {loading ? (
            <p className="text-inalde-gray">Cargando…</p>
          ) : cohortes.length === 0 ? (
            <p className="text-inalde-gray italic">No tienes cohortes asignadas todavía.</p>
          ) : (
            <div className="space-y-10">
              {cohortes.map((c) => (
                <section key={c.cohorte_id}>
                  <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
                    {c.etiqueta}
                  </h2>

                  {!c.publicada ? (
                    <div className="rounded border-l-4 border-inalde-gold bg-inalde-gold/10 px-4 py-3 text-sm">
                      La programación aún no se ha publicado. Cuando esté lista aparecerá aquí.
                    </div>
                  ) : (
                    <>
                      {c.publicada_at && (
                        <p className="text-xs text-inalde-gray mb-4">
                          <span aria-hidden="true">🔒 </span>Publicada el {new Date(c.publicada_at).toLocaleString('es-CO')} — definitiva.
                        </p>
                      )}

                      {c.jornadas.length === 0 ? (
                        <p className="text-inalde-gray text-sm italic">Sin jornadas.</p>
                      ) : c.jornadas.map((j) => (
                        <div key={j.id} className="border border-inalde-gray-light rounded-lg mb-5 overflow-hidden">
                          <div className="bg-inalde-text text-white px-4 py-2.5 flex flex-wrap items-center gap-3">
                            <span className="font-primary font-extrabold tracking-widest uppercase text-sm"><span aria-hidden="true">📅 </span>Jornada {j.numero}</span>
                            <span className="text-white/70 text-sm capitalize">{j.fecha_legible ?? j.fecha}</span>
                            <span className="text-xs text-white/70 ml-auto">
                              {(j.hora_inicio ?? '').slice(0, 5)}{j.hora_fin ? `–${j.hora_fin.slice(0, 5)}` : ''}
                            </span>
                          </div>
                          <div className="tabla-scroll">
                            <table className="w-full min-w-[1100px] table-fixed border-collapse bg-white">
                              <colgroup>
                                <col className="w-[80px]" /><col className="w-[200px]" /><col className="w-[220px]" />
                                <col className="w-[160px]" /><col className="w-[80px]" /><col className="w-[250px]" />
                                <col className="w-[110px]" />
                              </colgroup>
                              <thead>
                                <tr className="bg-inalde-text text-white">
                                  {['Slot', 'Proyecto', 'Autores', 'Sector', 'Logo', 'Resumen', 'One Pager'].map((h, i) => (
                                    <th key={i} scope="col" className="bg-inalde-text text-left font-primary font-bold text-[0.68rem] tracking-widest uppercase whitespace-nowrap px-3 py-2.5">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {filasDe(j).map((f, idx) => f.kind === 'actividad' ? (
                                  <tr key={`act-${idx}`} className="bg-inalde-gray-bg">
                                    <td colSpan={7} className="border-l-4 border-inalde-red px-4 py-3">
                                      <span className="font-primary font-extrabold text-[0.85rem] text-inalde-text">
                                        <span aria-hidden="true">🕐 </span>{f.a.hora_inicio} – {f.a.hora_fin} hrs. — {f.a.desc}
                                      </span>
                                    </td>
                                  </tr>
                                ) : (
                                  <tr key={`slot-${idx}`} className="border-b border-inalde-gray-light align-top">
                                    <td className="text-center px-3 py-2.5">
                                      <strong className="font-primary text-inalde-text">{f.s.slot}</strong>
                                      <span className="block text-[0.7rem] text-inalde-gray mt-0.5 font-mono">{f.s.hora_inicio}–{f.s.hora_fin}</span>
                                    </td>
                                    <td className="px-3 py-2.5 font-primary font-bold text-[0.85rem] text-inalde-text">{f.s.proyecto}</td>
                                    <td className="px-3 py-2.5 text-[0.78rem] text-inalde-gray">{f.s.autores}</td>
                                    <td className="px-3 py-2.5">
                                      {f.s.sector && (
                                        <span className="inline-block max-w-full text-white rounded-[3px] px-2 py-0.5 font-primary font-bold text-[0.62rem] tracking-wider uppercase whitespace-normal break-words leading-tight" style={{ background: colorSector(f.s.sector) }}>{f.s.sector}</span>
                                      )}
                                    </td>
                                    <td className="text-center px-3 py-2.5">
                                      {f.s.logo_url
                                        ? <img src={f.s.logo_url} alt={`Logo de ${f.s.proyecto}`} className="max-w-[55px] max-h-[45px] object-contain border border-inalde-gray-light p-0.5 mx-auto" />
                                        : <span className="text-[0.7rem] text-inalde-gray italic">Sin logo</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-[0.8rem] leading-relaxed align-top">
                                      {f.s.resumen
                                        ? <span className="clamp-4" title={f.s.resumen}>{f.s.resumen}</span>
                                        : <span className="text-inalde-gray italic">Sin resumen</span>}
                                      {f.s.linkedin && (
                                        <button onClick={() => copiar(`${j.id}-${idx}`, f.s.linkedin!)}
                                          className={`block mt-1.5 font-primary font-bold text-[0.63rem] tracking-wider uppercase border px-2 py-1 transition-colors ${copied === `${j.id}-${idx}` ? 'bg-inalde-blue text-white border-inalde-blue' : 'border-inalde-gray-light text-inalde-gray hover:bg-inalde-text hover:text-white hover:border-inalde-text'}`}>
                                          {copied === `${j.id}-${idx}` ? '✓ Copiado' : 'Copiar LinkedIn'}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5">
                                      {f.s.one_pager_url
                                        ? <a href={f.s.one_pager_url} target="_blank" rel="noreferrer" className="font-primary font-bold text-[0.7rem] text-inalde-red hover:underline">Ver →</a>
                                        : <span className="text-[0.7rem] text-inalde-gray italic">—</span>}
                                    </td>
                                  </tr>
                                ))}
                                {j.slots.length === 0 && <tr><td colSpan={7} className="py-3 text-center text-inalde-gray italic text-xs">Sin proyectos asignados</td></tr>}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
