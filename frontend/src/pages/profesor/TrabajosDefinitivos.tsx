import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { VisorArchivo } from '../../components/inalde/VisorArchivo';

interface Proyecto {
  proyecto: string;
  autores: string;
  sector: string;
  resumen: string | null;
  linkedin: string | null;
  one_pager_url: string | null;
  logo_url: string | null;
}
interface CohorteBloque {
  cohorte_id: string;
  etiqueta: string;
  proyectos: Proyecto[];
}

export default function TrabajosDefinitivos() {
  const [cohortes, setCohortes] = useState<CohorteBloque[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Archivo abierto en el visor emergente (logo / one pager). Null = cerrado.
  const [visor, setVisor] = useState<{ url: string; titulo: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr('');
      try {
        const { data } = await api.get('/profesor-consulta/trabajos-definitivos');
        setCohortes(data.cohortes ?? []);
      } catch (e: any) { setErr(formatBackendError(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  const totalProyectos = cohortes.reduce((n, c) => n + c.proyectos.length, 0);

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[1100px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="section-subtitle mb-2">Mis cohortes asignadas</p>
              <h1 className="section-title">Trabajos de grado definitivos</h1>
              <p className="text-inalde-gray text-sm mt-2">
                Consulta los proyectos definitivos ya entregados por los equipos que tienes asignados.
                Vista de solo lectura.
              </p>
            </div>
            <Link to="/" className="text-sm text-inalde-gray hover:text-inalde-text whitespace-nowrap">
              ← Volver al inicio
            </Link>
          </div>

          {err && <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6">{err}</div>}

          {loading ? (
            <p className="text-inalde-gray">Cargando…</p>
          ) : totalProyectos === 0 ? (
            <p className="text-inalde-gray italic">
              No hay trabajos de grado definitivos para tus equipos todavía. Aparecerán aquí en cuanto los equipos entreguen su proyecto final.
            </p>
          ) : (
            <div className="space-y-10">
              {cohortes.map((c) => (
                <section key={c.cohorte_id}>
                  <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
                    {c.etiqueta} · {c.proyectos.length} proyecto(s)
                  </h2>

                  {c.proyectos.length === 0 ? (
                    <p className="text-inalde-gray text-sm italic">Sin proyectos definitivos en esta cohorte.</p>
                  ) : (
                    <div className="space-y-3">
                      {c.proyectos.map((p, i) => (
                        <div key={`${c.cohorte_id}-${i}`} className="border border-inalde-gray-light rounded-lg p-4">
                          {/* El logo no se muestra en la ficha: se abre desde el
                              botón de la derecha, como el one pager. */}
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="flex-1 min-w-[220px]">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-primary font-bold text-inalde-text">{p.proyecto}</h3>
                                {p.sector && <span className="text-[11px] px-2 py-0.5 rounded bg-inalde-gold/15 text-inalde-text">{p.sector}</span>}
                              </div>
                              <p className="text-xs text-inalde-gray mt-0.5">{p.autores || '—'}</p>
                              {p.resumen ? (
                                <p className="text-sm text-inalde-gray mt-2 clamp-4" title={p.resumen}>{p.resumen}</p>
                              ) : (
                                <p className="text-[11px] text-inalde-gray/70 italic mt-2">Sin resumen de comunicaciones aún.</p>
                              )}
                            </div>
                            {/* Los dos archivos se abren en el visor emergente: se
                                ven encima de la lista y al cerrar el profesor
                                sigue donde estaba. */}
                            <div className="flex flex-col gap-1.5 shrink-0 items-end">
                              {p.logo_url && (
                                <button onClick={() => setVisor({ url: p.logo_url!, titulo: `Logo · ${p.proyecto}` })} className="text-[11px] text-inalde-blue font-semibold hover:underline">Logo</button>
                              )}
                              {p.one_pager_url && (
                                <button onClick={() => setVisor({ url: p.one_pager_url!, titulo: `One Pager · ${p.proyecto}` })} className="text-[11px] text-inalde-red font-semibold hover:underline">One Pager</button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </main>

      {visor && <VisorArchivo url={visor.url} titulo={visor.titulo} onClose={() => setVisor(null)} />}
    </>
  );
}
