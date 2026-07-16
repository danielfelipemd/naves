import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/store';
import { formatBackendError } from '../../lib/errors';

interface Proyecto {
  id: string; nombre: string; sector: string | null; ciiu: string | null;
  estado_seleccion: string;
  canvas_cliente: string | null;
  canvas_problema: string | null;
  canvas_solucion: string | null;
}
interface Equipo {
  id: string;
  creador_id: string;
  cohorte_id: string;
  proyecto_definitivo_id: string | null;
  fecha_seleccion_definitivo: string | null;
  reunion_1_profesor_at: string | null;
}
interface Cohorte {
  fecha_reunion_1: string | null;
  fecha_limite_seleccion_definitivo: string | null;
}

export default function SeleccionDefinitivo() {
  const navigate = useNavigate();
  const meParticipanteId = useAuth((s) => (s.user?.app_metadata as any)?.participante_id as string | undefined);
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [cohorte, setCohorte] = useState<Cohorte | null>(null);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [estadoAnte, setEstadoAnte] = useState<string>('borrador');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
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
      // Cohorte: necesitamos saber si ya paso la Reunion 1 para habilitar el
      // boton de marcar definitivo.
      const co = await api.get(`/cohortes/${eq.data.equipo.cohorte_id}`).catch(() => null);
      if (co?.data) setCohorte(co.data);
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function marcarDefinitivo(proyectoId: string, proyectoNombre: string) {
    if (!equipo) return;
    const ok = window.confirm(
      `Vas a marcar "${proyectoNombre}" como el proyecto definitivo del equipo. ` +
      'Los demás proyectos quedarán archivados. Esta decisión queda registrada en el sistema. ¿Confirmas?',
    );
    if (!ok) return;
    setBusy(proyectoId); setMsg(null);
    try {
      await api.post(`/equipos/${equipo.id}/seleccionar-proyecto-definitivo`, { proyecto_id: proyectoId });
      await load();
      setMsg({ kind: 'ok', text: 'Proyecto definitivo marcado correctamente.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(null); }
  }

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
        <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
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

          {/* Caso 3: 2+ proyectos, sin elegir → decide el creador del equipo */}
          {estadoAnte !== 'borrador' && proyectos.length > 1 && !yaSeleccionado && (() => {
            const esCreador = !!(meParticipanteId && equipo?.creador_id === meParticipanteId);
            const fechaR1 = cohorte?.fecha_reunion_1 ? new Date(cohorte.fecha_reunion_1) : null;
            // Si el profesor ya registró la Reunión 1 con este equipo, se abre la
            // selección aunque la fecha general de la cohorte no haya llegado:
            // la reunión ya ocurrió. Debe coincidir con la regla del servidor.
            const profesorMarcoR1 = !!equipo?.reunion_1_profesor_at;
            const yaPasoR1 = profesorMarcoR1 || !fechaR1 || new Date() >= fechaR1;
            return (
            <>
              <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 mb-6">
                <p className="font-primary font-bold text-sm text-inalde-text mb-1">
                  {esCreador ? 'Te corresponde marcar el proyecto definitivo' : 'Esperando decisión del creador del equipo'}
                </p>
                <p className="text-sm text-inalde-gray">
                  Tu equipo presentó <strong>{proyectos.length} proyectos</strong>.
                  {' '}Después de la Reunión 1,
                  {esCreador ? ' tú (como creador del equipo) marcas cuál queda como definitivo.' : ' el creador del equipo marcará cuál queda como definitivo.'}
                  {' '}Los otros quedarán archivados.
                </p>
                {esCreador && !yaPasoR1 && fechaR1 && (
                  <p className="text-xs text-inalde-gray mt-2 italic">
                    Disponible a partir del {fechaR1.toLocaleDateString('es-CO', { dateStyle: 'medium' })}, o antes si tu profesor registra que ya tuvieron la Reunión 1.
                  </p>
                )}
                {esCreador && profesorMarcoR1 && (
                  <p className="text-xs text-inalde-red font-semibold mt-2">
                    Tu profesor registró que ya tuvieron la Reunión 1: ya puedes elegir.
                  </p>
                )}
              </div>

              <p className="section-subtitle mb-3">Los proyectos que presentaron</p>
              <ul className="space-y-3">
                {noArchivados.map((p) => (
                  <li key={p.id} className="border border-inalde-gray-light rounded p-4">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <p className="font-primary font-bold">{p.nombre}</p>
                      {esCreador && (
                        <button
                          onClick={() => marcarDefinitivo(p.id, p.nombre)}
                          disabled={!yaPasoR1 || busy === p.id}
                          title={!yaPasoR1 ? 'Disponible después de la Reunión 1' : 'Marcar este proyecto como definitivo'}
                          className="text-xs font-semibold px-3 py-1.5 rounded border border-inalde-red text-inalde-red hover:bg-inalde-red hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition whitespace-nowrap">
                          {busy === p.id ? 'Marcando…' : 'Marcar como definitivo'}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-inalde-gray mt-1">
                      {p.sector && <span>{p.sector}</span>}
                      {p.ciiu && <span className="font-mono ml-2 text-inalde-gold">CIIU {p.ciiu}</span>}
                    </p>
                    {p.canvas_cliente && (
                      <p className="text-sm text-inalde-text mt-2"><strong>Cliente:</strong> {p.canvas_cliente}</p>
                    )}
                    {p.canvas_problema && (
                      <p className="text-sm text-inalde-text mt-1"><strong>Problema:</strong> {p.canvas_problema}</p>
                    )}
                    {p.canvas_solucion && (
                      <p className="text-sm text-inalde-text mt-1"><strong>Solución:</strong> {p.canvas_solucion}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
            );
          })()}

          {/* Caso 4: ya hay definitivo */}
          {estadoAnte !== 'borrador' && proyectos.length > 1 && yaSeleccionado && (
            <>
              <div className="rounded border-l-4 border-inalde-red bg-inalde-red/5 px-4 py-3 mb-6">
                <p className="text-sm uppercase tracking-wider font-semibold text-inalde-red mb-1">Proyecto definitivo</p>
                <p className="font-bold text-lg">{definitivo?.nombre}</p>
                {equipo?.fecha_seleccion_definitivo && (
                  <p className="text-xs text-inalde-gray mt-1">
                    Marcado el {new Date(equipo.fecha_seleccion_definitivo).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}.
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
