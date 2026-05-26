import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Proyecto {
  id: string;
  nombre: string;
  tipo: string | null;
  sector: string | null;
  ciiu: string | null;
  estado_seleccion: string;
  estado: string | null;
  canvas_cliente_problema: string | null;
  canvas_ingresos: string | null;
  canvas_recursos: string | null;
  canvas_actividades: string | null;
  fuentes_primarias: string | null;
  fuentes_secundarias: string | null;
}

interface EquipoAsignado {
  equipo_id: string;
  nombre_equipo: string | null;
  cohorte_id: string;
  anteproyecto_estado: string | null;
  proyecto_definitivo_id: string | null;
  fecha_seleccion_definitivo: string | null;
  miembros: string[];
  proyectos: Proyecto[];
  requiere_seleccion: boolean;
}

export default function SeleccionarProyectos() {
  const navigate = useNavigate();
  const [equipos, setEquipos] = useState<EquipoAsignado[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function cargar() {
    setLoading(true); setMsg(null);
    try {
      const r = await api.get('/profesor/mis-equipos-pendientes');
      setEquipos(r.data?.equipos ?? []);
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setLoading(false); }
  }

  useEffect(() => { cargar(); }, []);

  async function elegirDefinitivo(equipoId: string, proyectoId: string, nombreProyecto: string) {
    if (!confirm(`¿Marcar "${nombreProyecto}" como proyecto definitivo del equipo? Los demás proyectos se archivarán.`)) return;
    setBusy(equipoId); setMsg(null);
    try {
      await api.post(`/equipos/${equipoId}/seleccionar-proyecto-definitivo`, { proyecto_id: proyectoId });
      setMsg({ kind: 'ok', text: `Proyecto "${nombreProyecto}" marcado como definitivo.` });
      await cargar();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(null); }
  }

  const pendientes = equipos.filter(e => e.requiere_seleccion);
  const yaResueltos = equipos.filter(e => !e.requiere_seleccion);

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[1100px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="section-subtitle mb-2">Mis equipos asignados</p>
              <h1 className="section-title">Seleccionar proyecto definitivo</h1>
              <p className="text-inalde-gray text-sm mt-2">
                Tras la Reunión 1 con cada equipo, elige cuál de los proyectos del equipo queda como
                definitivo. Los demás se archivan automáticamente.
              </p>
            </div>
            <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text whitespace-nowrap">
              ← Dashboard
            </button>
          </div>

          {msg && (
            <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 whitespace-pre-line ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
              {msg.text}
            </div>
          )}

          {equipos.length === 0 && (
            <p className="text-inalde-gray italic">No tienes equipos asignados todavía.</p>
          )}

          {pendientes.length > 0 && (
            <section className="mb-10">
              <h2 className="font-primary font-bold text-lg text-inalde-text mb-4">
                Pendientes de tu decisión ({pendientes.length})
              </h2>
              <div className="space-y-6">
                {pendientes.map(eq => (
                  <div key={eq.equipo_id} className="border border-inalde-gray-light rounded p-5">
                    <div className="flex items-start justify-between gap-4 mb-4 pb-3 border-b border-inalde-gray-light">
                      <div>
                        <h3 className="font-primary font-bold text-base text-inalde-text">
                          {eq.nombre_equipo || '(sin nombre)'}
                        </h3>
                        <p className="text-xs text-inalde-gray mt-1">
                          Cohorte {eq.cohorte_id} · {eq.miembros.length} miembro(s): {eq.miembros.join(', ')}
                        </p>
                      </div>
                      <span className="text-[11px] uppercase tracking-wider font-bold text-inalde-red bg-red-50 px-3 py-1 rounded">
                        {eq.proyectos.length} proyectos · elegir 1
                      </span>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      {eq.proyectos.map(p => (
                        <div key={p.id} className="border border-inalde-gray-light rounded p-4 flex flex-col gap-2">
                          <h4 className="font-primary font-bold text-sm text-inalde-text">{p.nombre}</h4>
                          <p className="text-xs text-inalde-gray">
                            {p.tipo} {p.sector ? `· ${p.sector}` : ''} {p.ciiu ? `· CIIU ${p.ciiu}` : ''}
                          </p>
                          {p.canvas_cliente_problema && (
                            <p className="text-xs text-inalde-text mt-2 line-clamp-4">
                              <strong>Cliente / problema:</strong> {p.canvas_cliente_problema}
                            </p>
                          )}
                          {p.estado && (
                            <p className="text-[11px] text-inalde-gray italic">Estado del proyecto: {p.estado}</p>
                          )}
                          <button
                            onClick={() => elegirDefinitivo(eq.equipo_id, p.id, p.nombre)}
                            disabled={busy === eq.equipo_id}
                            className="btn-inalde-primary !py-2 !text-xs mt-2 disabled:opacity-50"
                          >
                            {busy === eq.equipo_id ? 'Guardando…' : 'Marcar como definitivo'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {yaResueltos.length > 0 && (
            <section>
              <h2 className="font-primary font-bold text-lg text-inalde-text mb-4">
                Ya resueltos ({yaResueltos.length})
              </h2>
              <div className="space-y-3">
                {yaResueltos.map(eq => {
                  const def = eq.proyectos.find(p => p.id === eq.proyecto_definitivo_id);
                  return (
                    <div key={eq.equipo_id} className="border border-inalde-gray-light rounded p-4 flex items-center justify-between">
                      <div>
                        <p className="font-primary font-bold text-sm">{eq.nombre_equipo || '(sin nombre)'} · {eq.cohorte_id}</p>
                        <p className="text-xs text-inalde-gray mt-1">
                          {eq.proyecto_definitivo_id
                            ? `Definitivo: ${def?.nombre ?? '—'}`
                            : eq.anteproyecto_estado === 'borrador'
                              ? 'Anteproyecto aún en borrador'
                              : eq.proyectos.length === 1
                                ? `Proyecto único (auto-definitivo): ${eq.proyectos[0]?.nombre ?? '—'}`
                                : 'Sin acciones pendientes'}
                        </p>
                      </div>
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-inalde-blue">
                        {eq.proyecto_definitivo_id ? '✓ Definitivo elegido' : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
