import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';

// Vista PÚBLICA de trabajos de grado definitivos agrupados por sector
// (Comentario 13). Protegida por clave (se valida en el backend contra el hash de
// la cohorte). No requiere sesión: es para compartir fuera del sistema.

interface Item {
  proyecto_id: string;
  proyecto: string;
  autores: string;
  sector: string;
  confidencial: boolean;
  resumen: string | null;
  linkedin: string | null;
  one_pager_url: string | null;
  logo_url: string | null;
}
interface GrupoSector { sector: string; proyectos: Item[]; }
interface Data { cohorte_id: string; etiqueta: string; sectores: GrupoSector[]; }

export default function TrabajosSector() {
  const { cohorteId = '' } = useParams();
  const [clave, setClave] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function abrir(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const r = await api.get(`/trabajos-sector/publico/${encodeURIComponent(cohorteId)}`, { params: { clave } });
      setData(r.data);
    } catch (err: any) {
      const code = err?.response?.status;
      if (code === 401) setError('La clave no es correcta. Verifícala e inténtalo de nuevo.');
      else if (code === 403) setError('Esta vista no está habilitada para consulta.');
      else if (code === 404) setError('No encontramos esta cohorte.');
      else setError('No se pudo abrir la vista. Inténtalo más tarde.');
    } finally {
      setCargando(false);
    }
  }

  async function copiar(id: string, texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(id); setTimeout(() => setCopiado(null), 1800); } catch { /* noop */ }
  }

  return (
    <div className="min-h-screen bg-inalde-gray-bg/30">
      {/* Header INALDE simple (sin campana ni back: es público) */}
      <header className="bg-white border-b border-inalde-gray-light shadow-sm">
        <div className="bg-inalde-black px-4 sm:px-8 py-2">
          <p className="text-right text-white font-primary font-medium text-[10px] sm:text-xs tracking-wider uppercase">INALDE Business School</p>
        </div>
        <div className="flex items-center gap-3 sm:gap-6 max-w-[1200px] mx-auto px-4 sm:px-8 py-3 sm:py-4">
          <img src="/inalde-logo.jpg" alt="INALDE Business School" className="h-10 sm:h-14 w-auto" />
          <div className="w-px h-9 sm:h-11 bg-inalde-gray-light" />
          <div>
            <p className="font-primary font-semibold text-[10px] sm:text-[0.7rem] tracking-widest uppercase text-inalde-gray mb-0.5">NAVES · Trabajos de grado MBA</p>
            <p className="font-primary font-extrabold text-lg sm:text-xl tracking-tight leading-none text-inalde-text">Proyectos por sector</p>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-8 py-10">
        {!data ? (
          <div className="max-w-md mx-auto bg-white rounded-lg shadow-inalde-card p-6 sm:p-8 mt-6">
            <h1 className="font-primary font-extrabold text-xl text-inalde-text mb-2">Acceso a los proyectos</h1>
            <p className="text-sm text-inalde-gray mb-5">Ingresa la clave que te compartieron para consultar los proyectos de esta cohorte.</p>
            <form onSubmit={abrir} className="space-y-4">
              <input
                type="password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="Clave de acceso"
                autoFocus
                className="input-inalde"
              />
              {error && <p className="text-sm text-inalde-red">{error}</p>}
              <button type="submit" disabled={cargando || !clave} className="btn-inalde-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
                {cargando ? 'Verificando…' : 'Entrar'}
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className="border-b-[3px] border-inalde-red pb-4 mb-8">
              <p className="section-subtitle mb-1">Trabajos de grado definitivos</p>
              <h1 className="section-title">{data.etiqueta}</h1>
            </div>

            {data.sectores.length === 0 && (
              <p className="text-inalde-gray">Aún no hay proyectos publicados para esta cohorte.</p>
            )}

            {data.sectores.map((g) => (
              <section key={g.sector} className="mb-10">
                <h2 className="font-primary font-extrabold text-sm uppercase tracking-widest text-white bg-inalde-text rounded px-3 py-2 mb-4">
                  {g.sector} <span className="text-white/60 font-semibold">· {g.proyectos.length}</span>
                </h2>
                <div className="grid gap-4">
                  {g.proyectos.map((p) => (
                    <div key={p.proyecto_id} className="bg-white rounded-lg shadow-inalde-card p-5 flex flex-col sm:flex-row gap-4">
                      <div className="shrink-0 w-[90px] flex items-start justify-center">
                        {p.confidencial ? (
                          <span className="text-3xl" title="Proyecto confidencial" aria-label="Confidencial">🔒</span>
                        ) : p.logo_url ? (
                          <img src={p.logo_url} alt={`Logo de ${p.proyecto}`} className="max-w-[80px] max-h-[64px] object-contain border border-inalde-gray-light p-1" />
                        ) : (
                          <span className="text-[0.7rem] text-inalde-gray italic">Sin logo</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-primary font-bold text-lg text-inalde-text">{p.proyecto}</h3>
                          {p.confidencial && (
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray bg-inalde-gray-bg px-2 py-0.5 rounded">Confidencial</span>
                          )}
                        </div>
                        <p className="text-sm text-inalde-gray mb-2">{p.autores}</p>

                        {p.confidencial ? (
                          <p className="text-sm text-inalde-gray italic">Este proyecto es confidencial: no se comparte su material.</p>
                        ) : (
                          <>
                            {p.resumen && <p className="text-sm text-inalde-text leading-relaxed mb-2 clamp-4" title={p.resumen}>{p.resumen}</p>}
                            <div className="flex flex-wrap items-center gap-2">
                              {p.one_pager_url && (
                                <a href={p.one_pager_url} target="_blank" rel="noreferrer" className="text-[0.72rem] font-primary font-bold text-inalde-red hover:underline">Ver One Pager →</a>
                              )}
                              {p.logo_url && (
                                <a href={p.logo_url} target="_blank" rel="noreferrer" className="text-[0.62rem] font-primary font-bold px-2 py-1 rounded-[3px] bg-inalde-gray-bg text-inalde-blue border border-inalde-blue hover:bg-inalde-blue hover:text-white whitespace-nowrap"><span aria-hidden="true">⬇ </span>Logo</a>
                              )}
                              {p.one_pager_url && (
                                <a href={p.one_pager_url} target="_blank" rel="noreferrer" className="text-[0.62rem] font-primary font-bold px-2 py-1 rounded-[3px] bg-inalde-gray-bg text-inalde-red border border-inalde-red hover:bg-inalde-red hover:text-white whitespace-nowrap"><span aria-hidden="true">⬇ </span>One Pager</a>
                              )}
                              {p.linkedin && (
                                <button
                                  onClick={() => copiar(p.proyecto_id, p.linkedin!)}
                                  className={`text-[0.62rem] font-primary font-bold px-2 py-1 rounded-[3px] border transition-colors ${copiado === p.proyecto_id ? 'bg-inalde-blue text-white border-inalde-blue' : 'border-inalde-gray-light text-inalde-gray hover:bg-inalde-text hover:text-white hover:border-inalde-text'}`}>
                                  {copiado === p.proyecto_id ? '✓ Post copiado' : 'Copiar post LinkedIn'}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
