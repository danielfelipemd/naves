import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Proyecto {
  id: string;
  nombre: string;
  sector: string | null;
  ciiu: string | null;
  canvas_problema: string | null;
  canvas_solucion: string | null;
}
interface Fila {
  equipo_id: string;
  nombre_equipo: string | null;
  autores: string;
  proyectos: Proyecto[];
}

/**
 * Vista de SOLO LECTURA para el participante: la "Sábana de proyectos" lista los
 * equipos de su cohorte que están buscando socios. No hay nada editable.
 */
export default function SabanaSocios() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data } = await api.get('/sabana/buscando-socios');
        setFilas((data?.filas ?? []) as Fila[]);
      } catch (e: any) {
        setError(formatBackendError(e));
      } finally { setLoading(false); }
    })();
  }, []);

  const q = buscar.trim().toLowerCase();
  const filtradas = !q ? filas : filas.filter((f) => {
    const hay = [f.autores, f.nombre_equipo ?? '', ...f.proyectos.map((p) => `${p.nombre} ${p.sector ?? ''}`)]
      .join(' ').toLowerCase();
    return hay.includes(q);
  });

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[1100px] mx-auto">
          <Link to="/" className="text-sm text-inalde-gray hover:text-inalde-red">← Menú principal</Link>
          <div className="border-b-[3px] border-inalde-red pb-4 mb-6 mt-3">
            <p className="section-subtitle mb-1">Participante</p>
            <h1 className="section-title">Sábana de proyectos</h1>
            <p className="text-sm text-inalde-gray mt-2">
              Proyectos de tu cohorte que están <strong className="text-inalde-text">buscando socios</strong>.
              Es una vista informativa de solo lectura.
            </p>
          </div>

          {loading ? (
            <p className="text-inalde-gray">Cargando…</p>
          ) : error ? (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm">{error}</div>
          ) : filas.length === 0 ? (
            <p className="text-inalde-gray text-sm">Por ahora ningún proyecto de tu cohorte está buscando socios.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-inalde-gray">
                  {filtradas.length} de {filas.length} proyecto(s) buscando socios
                </span>
                <div className="flex-1 min-w-[200px] ml-auto">
                  <input type="text" placeholder="Buscar autor, proyecto, sector…"
                    value={buscar}
                    onChange={(e) => setBuscar(e.target.value)}
                    className="w-full text-sm border border-inalde-gray-light rounded px-3 py-1.5 focus:outline-none focus:border-inalde-red" />
                </div>
              </div>

              <div className="rounded-lg border border-inalde-gray-light overflow-x-auto shadow-inalde-card bg-white w-fit max-w-full">
                <table className="text-sm border-collapse w-auto">
                  <thead>
                    <tr className="bg-gradient-to-b from-inalde-text to-[#2a2a2a]">
                      <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">#</th>
                      <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Participantes</th>
                      <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Proyecto(s)</th>
                      <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Sector</th>
                      <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">CIIU</th>
                      <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Problema · Solución</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-12 text-center text-inalde-gray italic">No hay proyectos que coincidan con la búsqueda.</td></tr>
                    ) : filtradas.map((f, idx) => (
                      <tr key={f.equipo_id} className={`border-t border-inalde-gray-light/60 align-top ${idx % 2 === 0 ? 'bg-white' : 'bg-inalde-gray-bg/40'}`}>
                        <td className="px-2.5 py-3 align-top">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-inalde-text text-white text-xs font-bold font-mono">{idx + 1}</span>
                        </td>
                        <td className="px-2.5 py-3 align-top">
                          <div className="max-w-[210px] min-w-[140px]">
                            <p className="font-medium text-inalde-text break-words leading-snug">
                              {f.autores || <span className="italic text-inalde-gray font-normal">—</span>}
                            </p>
                          </div>
                        </td>
                        <td className="px-2.5 py-3 align-top">
                          <div className="max-w-[240px] min-w-[150px]">
                            {f.proyectos.length > 1 ? (
                              <div className="space-y-2">
                                {f.proyectos.map((p, i) => (
                                  <div key={p.id || i} className="bg-inalde-gold/5 border-l-[3px] border-inalde-gold rounded-sm pl-2.5 py-1.5">
                                    <p className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold mb-0.5">Proyecto {i + 1}</p>
                                    <p className="font-medium text-inalde-text leading-tight break-words">{p.nombre}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="font-medium text-inalde-text leading-snug break-words">
                                {f.proyectos[0]?.nombre ?? <span className="italic text-inalde-gray font-normal">—</span>}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-2.5 py-3 align-top text-inalde-gray text-xs">
                          <div className="max-w-[130px] break-words">
                            {f.proyectos.length > 1
                              ? f.proyectos.map((p, i) => (
                                  <div key={p.id || i} className="leading-tight">
                                    <span className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold">P{i + 1}</span>{' '}
                                    {p.sector || <span className="italic">—</span>}
                                  </div>
                                ))
                              : (f.proyectos[0]?.sector ?? <span className="italic">—</span>)}
                          </div>
                        </td>
                        <td className="px-2.5 py-3 align-top">
                          {f.proyectos.length > 1
                            ? f.proyectos.map((p, i) => (
                                <div key={p.id || i} className="leading-tight">
                                  <span className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold">P{i + 1}</span>{' '}
                                  <span className="font-mono text-xs text-inalde-text">{p.ciiu || <span className="italic text-inalde-gray">—</span>}</span>
                                </div>
                              ))
                            : <span className="font-mono text-xs text-inalde-text">{f.proyectos[0]?.ciiu || <span className="italic text-inalde-gray">—</span>}</span>}
                        </td>
                        <td className="px-2.5 py-3 align-top text-xs">
                          <div className="max-w-[620px] min-w-[440px]">
                            {f.proyectos.map((p, i) => {
                              const tieneTexto = p.canvas_problema || p.canvas_solucion;
                              return (
                                <div key={p.id || i} className={f.proyectos.length > 1 ? 'border-l-2 border-inalde-gold/40 pl-2 mb-3 last:mb-0' : ''}>
                                  {f.proyectos.length > 1 && (
                                    <p className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold mb-1">Proyecto {i + 1}</p>
                                  )}
                                  {p.canvas_problema && (
                                    <p className="text-inalde-text leading-snug mb-1"><span className="text-[10px] uppercase tracking-wider text-inalde-gray font-semibold">Problema:</span> {p.canvas_problema}</p>
                                  )}
                                  {p.canvas_solucion && (
                                    <p className="text-inalde-text leading-snug"><span className="text-[10px] uppercase tracking-wider text-inalde-gray font-semibold">Solución:</span> {p.canvas_solucion}</p>
                                  )}
                                  {!tieneTexto && <span className="italic text-inalde-gray">—</span>}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
