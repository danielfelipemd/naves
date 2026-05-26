import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Proyecto {
  id: string; nombre: string; sector: string | null; ciiu: string | null;
  estado_seleccion: string; canvas_cliente_problema: string | null;
}
interface Equipo {
  id: string;
  proyecto_definitivo_id: string | null;
  fecha_seleccion_definitivo: string | null;
}

export default function SeleccionDefinitivo() {
  const navigate = useNavigate();
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [estadoAnte, setEstadoAnte] = useState<string>('borrador');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const eq = await api.get('/equipos/mi-equipo');
      if (!eq.data.equipo) { navigate('/'); return; }
      setEquipo(eq.data.equipo);
      const ant = await api.get('/anteproyectos/mi-anteproyecto');
      const a = ant.data.anteproyecto;
      if (!a) { navigate('/equipo'); return; }
      setEstadoAnte(a.estado);
      setProyectos((a.proyectos ?? []).sort((x: any, y: any) => x.posicion - y.posicion));
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;
  }

  const yaSeleccionado = equipo?.proyecto_definitivo_id;
  const definitivo = proyectos.find((p) => p.estado_seleccion === 'definitivo');
  const archivados = proyectos.filter((p) => p.estado_seleccion === 'archivado');
  const noArchivados = proyectos.filter((p) => p.estado_seleccion !== 'archivado');

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Proyecto definitivo</p>
            <h1 className="section-title">Selección del proyecto definitivo</h1>
          </div>

          {msg && (
            <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 whitespace-pre-line ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
              {msg.text}
            </div>
          )}

          {/* Caso 1: anteproyecto aún en borrador */}
          {estadoAnte === 'borrador' && (
            <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm">
              Tu anteproyecto aún está en borrador. Termina y envíalo desde el formulario antes de hablar del proyecto definitivo.
              <div className="mt-2"><button onClick={() => navigate('/anteproyecto')} className="text-inalde-red font-semibold">Ir al formulario →</button></div>
            </div>
          )}

          {/* Caso 2: 1 solo proyecto → auto-definitivo */}
          {estadoAnte !== 'borrador' && proyectos.length === 1 && (
            <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm">
              Tu equipo presentó un solo proyecto. Quedó marcado como definitivo automáticamente:
              <p className="font-bold mt-2">{proyectos[0].nombre}</p>
            </div>
          )}

          {/* Caso 3: 2+ proyectos, sin elegir → pendiente del profesor */}
          {estadoAnte !== 'borrador' && proyectos.length > 1 && !yaSeleccionado && (
            <>
              <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 mb-6">
                <p className="font-primary font-bold text-sm text-inalde-text mb-1">Esperando decisión del profesor</p>
                <p className="text-sm text-inalde-gray">
                  Tu equipo presentó <strong>{proyectos.length} proyectos</strong>. Después de la Reunión 1,
                  tu profesor asignado entrará al sistema y marcará cuál queda como definitivo.
                  Los otros quedarán archivados.
                </p>
              </div>

              <p className="section-subtitle mb-3">Los proyectos que presentaron</p>
              <ul className="space-y-3">
                {noArchivados.map((p) => (
                  <li key={p.id} className="border border-inalde-gray-light rounded p-4">
                    <p className="font-primary font-bold">{p.nombre}</p>
                    <p className="text-xs text-inalde-gray mt-1">
                      {p.sector && <span>{p.sector}</span>}
                      {p.ciiu && <span className="font-mono ml-2 text-inalde-gold">CIIU {p.ciiu}</span>}
                    </p>
                    {p.canvas_cliente_problema && (
                      <p className="text-sm text-inalde-text mt-2">{p.canvas_cliente_problema}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Caso 4: ya hay definitivo */}
          {estadoAnte !== 'borrador' && proyectos.length > 1 && yaSeleccionado && (
            <>
              <div className="rounded border-l-4 border-inalde-red bg-inalde-red/5 px-4 py-3 mb-6">
                <p className="text-sm uppercase tracking-wider font-semibold text-inalde-red mb-1">Proyecto definitivo</p>
                <p className="font-bold text-lg">{definitivo?.nombre}</p>
                {equipo?.fecha_seleccion_definitivo && (
                  <p className="text-xs text-inalde-gray mt-1">
                    Marcado por tu profesor el {new Date(equipo.fecha_seleccion_definitivo).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}.
                  </p>
                )}
              </div>
              {archivados.length > 0 && (
                <>
                  <p className="section-subtitle mb-2">Proyectos archivados</p>
                  <ul className="space-y-2 mb-6">
                    {archivados.map((p) => (
                      <li key={p.id} className="border border-inalde-gray-light rounded p-3 flex justify-between items-center">
                        <span className="text-inalde-gray line-through">{p.nombre}</span>
                        <button onClick={() => {
                          const motivo = prompt('Motivo para solicitar desarchivar este proyecto (mínimo 20 caracteres):');
                          if (!motivo || motivo.length < 20) return alert('Motivo demasiado corto');
                          api.post(`/proyectos/${p.id}/solicitar-desarchivar`, { motivo })
                            .then(() => alert('Solicitud enviada al profesor.'))
                            .catch((e) => alert(formatBackendError(e)));
                        }} className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover">
                          Solicitar desarchivar
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          <div className="mt-8 pt-6 border-t border-inalde-gray-light">
            <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
              ← Dashboard
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
