import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Equipo {
  nombre_equipo: string;
  tipo_trabajo_grado: string | null;
  miembros: string[];
}
interface CohorteBloque {
  cohorte_id: string;
  etiqueta: string;
  equipos: Equipo[];
}

const TIPO_LABEL: Record<string, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

export default function EquiposConsulta() {
  const [cohortes, setCohortes] = useState<CohorteBloque[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true); setErr('');
      try {
        const { data } = await api.get('/profesor-consulta/equipos');
        setCohortes(data.cohortes ?? []);
      } catch (e: any) { setErr(formatBackendError(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  const totalEquipos = cohortes.reduce((n, c) => n + c.equipos.length, 0);

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[1100px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="section-subtitle mb-2">Mis cohortes asignadas</p>
              <h1 className="section-title">Consulta de equipos</h1>
              <p className="text-inalde-gray text-sm mt-2">
                Consulta los equipos que tienes asignados y sus participantes. Vista de solo lectura.
              </p>
            </div>
            <Link to="/" className="text-sm text-inalde-gray hover:text-inalde-text whitespace-nowrap">
              ← Volver al inicio
            </Link>
          </div>

          {err && <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6">{err}</div>}

          {loading ? (
            <p className="text-inalde-gray">Cargando…</p>
          ) : totalEquipos === 0 ? (
            <p className="text-inalde-gray italic">No tienes equipos asignados todavía.</p>
          ) : (
            <div className="space-y-10">
              {cohortes.map((c) => (
                <section key={c.cohorte_id}>
                  <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
                    {c.etiqueta} · {c.equipos.length} equipo(s)
                  </h2>

                  {c.equipos.length === 0 ? (
                    <p className="text-inalde-gray text-sm italic">Sin equipos en esta cohorte.</p>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-4">
                      {c.equipos.map((e, i) => (
                        <div key={`${c.cohorte_id}-${i}`} className="border border-inalde-gray-light rounded-lg p-4">
                          <div className="flex items-start justify-between gap-3 mb-3 pb-2 border-b border-inalde-gray-light">
                            <h3 className="font-primary font-bold text-base text-inalde-text">{e.nombre_equipo}</h3>
                            {e.tipo_trabajo_grado && (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-inalde-gold/15 text-inalde-text whitespace-nowrap">
                                {TIPO_LABEL[e.tipo_trabajo_grado] ?? e.tipo_trabajo_grado}
                              </span>
                            )}
                          </div>
                          {e.miembros.length > 0 ? (
                            <ul className="space-y-1">
                              {e.miembros.map((m, j) => (
                                <li key={j} className="text-sm text-inalde-text flex items-center gap-2">
                                  <span className="text-inalde-red" aria-hidden="true">•</span>
                                  {m}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-inalde-gray italic">Sin participantes registrados.</p>
                          )}
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
    </>
  );
}
