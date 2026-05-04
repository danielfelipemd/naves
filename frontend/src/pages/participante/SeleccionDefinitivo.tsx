import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';

interface Proyecto {
  id: string; nombre: string; sector: string | null; ciiu: string | null;
  estado_seleccion: string; canvas_cliente_problema: string | null;
}
interface Equipo {
  id: string; reunion_1_marcada_por: string | null; reunion_1_fecha_marcado: string | null;
  proyecto_definitivo_id: string | null;
}

export default function SeleccionDefinitivo() {
  const navigate = useNavigate();
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [estadoAnte, setEstadoAnte] = useState<string>('borrador');
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function marcarReunion() {
    if (!equipo) return;
    if (!confirm('Confirmas que tu equipo ya tuvo la Reunión 1 con el profesor?')) return;
    setBusy(true); setMsg(null);
    try {
      await api.post(`/equipos/${equipo.id}/marcar-reunion-1`);
      await load();
    } catch (e: any) {
      const code = e?.response?.data?.error;
      const map: Record<string, string> = {
        TOO_EARLY: 'Aún no llega la fecha de Reunión 1 establecida en tu cohorte.',
        ALREADY_MARKED: 'Ya marcaste la Reunión 1.',
        ONLY_ONE_PROJECT: 'Tu equipo solo entregó un proyecto, ya está marcado como definitivo automáticamente.',
        FECHA_LIMITE_EXPIRADA: 'La fecha límite para seleccionar el definitivo ya pasó.',
      };
      setMsg({ kind: 'err', text: map[code] ?? code ?? e.message });
    } finally { setBusy(false); }
  }

  async function confirmarSeleccion() {
    if (!equipo || !seleccionado) return;
    const proy = proyectos.find((p) => p.id === seleccionado);
    if (!proy) return;
    if (!confirm(`Vas a seleccionar "${proy.nombre}" como proyecto DEFINITIVO. Los demás proyectos quedarán archivados y solo podrán desarchivarse con aprobación del profesor. ¿Continuar?`)) return;
    setBusy(true); setMsg(null);
    try {
      await api.post(`/equipos/${equipo.id}/seleccionar-proyecto-definitivo`, { proyecto_id: seleccionado });
      setMsg({ kind: 'ok', text: 'Proyecto definitivo registrado.' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;
  }

  // Casos:
  // 1. Sólo 1 proyecto → ya está marcado como definitivo automáticamente
  // 2. 2-3 proyectos, ante en borrador → debe enviar primero
  // 3. 2-3 proyectos, enviado, sin marcar Reunión 1 → mostrar botón
  // 4. 2-3 proyectos, enviado, marcada → mostrar selector
  // 5. ya seleccionado → mostrar resultado

  const yaSeleccionado = equipo?.proyecto_definitivo_id;
  const reunionMarcada = equipo?.reunion_1_marcada_por;
  const definitivo = proyectos.find((p) => p.estado_seleccion === 'definitivo');
  const archivados = proyectos.filter((p) => p.estado_seleccion === 'archivado');

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Sección 3</p>
            <h1 className="section-title">Selección del proyecto definitivo</h1>
          </div>

          {msg && (
            <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
              {msg.text}
            </div>
          )}

          {estadoAnte === 'borrador' && (
            <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm">
              Tu anteproyecto aún está en borrador. Termina y envíalo desde el formulario antes de seleccionar el definitivo.
              <div className="mt-2"><button onClick={() => navigate('/anteproyecto')} className="text-inalde-red font-semibold">Ir al formulario →</button></div>
            </div>
          )}

          {estadoAnte !== 'borrador' && proyectos.length === 1 && (
            <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm">
              Tu equipo entregó un solo proyecto. Ya quedó marcado como definitivo automáticamente:
              <p className="font-bold mt-2">{proyectos[0].nombre}</p>
            </div>
          )}

          {estadoAnte !== 'borrador' && proyectos.length > 1 && yaSeleccionado && (
            <>
              <div className="rounded border-l-4 border-inalde-red bg-inalde-red/5 px-4 py-3 mb-6">
                <p className="text-sm uppercase tracking-wider font-semibold text-inalde-red mb-1">Proyecto definitivo</p>
                <p className="font-bold text-lg">{definitivo?.nombre}</p>
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
                            .catch((e) => alert(e?.response?.data?.error ?? e.message));
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

          {estadoAnte !== 'borrador' && proyectos.length > 1 && !yaSeleccionado && !reunionMarcada && (
            <>
              <p className="text-inalde-gray mb-6">
                Tu equipo entregó {proyectos.length} alternativas. Después de la <strong>Reunión 1</strong> con tu profesor,
                deben elegir una como definitivo.
              </p>
              <button onClick={marcarReunion} disabled={busy} className="btn-inalde-primary">
                {busy ? 'Procesando…' : 'Confirmo que ya tuvimos la Reunión 1'}
              </button>
            </>
          )}

          {estadoAnte !== 'borrador' && proyectos.length > 1 && !yaSeleccionado && reunionMarcada && (
            <>
              <p className="text-inalde-gray mb-6">
                Reunión 1 marcada el {new Date(reunionMarcada || '').toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}.{' '}
                <strong>Selecciona ahora el proyecto definitivo</strong>. Los demás quedarán archivados.
              </p>
              <div className="space-y-3 mb-6">
                {proyectos.map((p) => (
                  <label key={p.id}
                    className={`flex items-start gap-3 p-4 rounded border-2 cursor-pointer transition ${
                      seleccionado === p.id ? 'border-inalde-red bg-inalde-red/5' : 'border-inalde-gray-light hover:border-inalde-gray'
                    }`}>
                    <input type="radio" name="proy" value={p.id}
                      checked={seleccionado === p.id}
                      onChange={() => setSeleccionado(p.id)}
                      className="mt-1" />
                    <div className="flex-1">
                      <p className="font-primary font-bold">{p.nombre}</p>
                      <p className="text-xs text-inalde-gray mt-1">
                        {p.sector && <span>{p.sector}</span>}
                        {p.ciiu && <span className="font-mono ml-2 text-inalde-gold">CIIU {p.ciiu}</span>}
                      </p>
                      {p.canvas_cliente_problema && (
                        <p className="text-sm text-inalde-text mt-2">{p.canvas_cliente_problema}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              <button onClick={confirmarSeleccion} disabled={busy || !seleccionado} className="btn-inalde-primary">
                {busy ? 'Confirmando…' : 'Confirmar proyecto definitivo →'}
              </button>
            </>
          )}

          <div className="mt-10 pt-6 border-t border-inalde-gray-light">
            <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
              ← Dashboard
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
