import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/store';
import { formatBackendError } from '../../lib/errors';

interface Miembro {
  id: string;
  posicion: number;
  participantes_lista: { id: string; nombre_completo: string };
}
interface Equipo {
  id: string;
  nombre_equipo: string | null;
  cohorte_id: string;
  creador_id: string;
  tipo_trabajo_grado: 'business_plan' | 'caso' | 'proyecto_investigacion';
  miembros_equipo: Miembro[];
}

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';

export default function MiEquipo() {
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; nombre_completo: string; perfil_completo?: boolean }>>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const [nombreEquipo, setNombreEquipo] = useState('');
  const [modalidad, setModalidad] = useState<Modalidad | null>(null);
  // Multi-select de compañeros para crear el equipo en un solo paso
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const { user } = useAuth();
  const cohorteId = (user?.app_metadata as any)?.cohorte_id ?? '';

  function toggleSeleccionado(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= 2) return prev; // máximo 2 compañeros + el creador = 3
      next.add(id);
      return next;
    });
  }

  // Cargar la modalidad del participante para adaptar copys cuando aun no hay equipo
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/participantes/mi-modalidad');
        setModalidad((data?.tipo_trabajo_grado as Modalidad | null) ?? null);
      } catch { /* ignore */ }
    })();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/equipos/mi-equipo');
      setEquipo(data.equipo);
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function crear() {
    setBusy(true); setError(null);
    try {
      await api.post('/equipos', {
        nombre_equipo: nombreEquipo || undefined,
        miembros_ids: Array.from(seleccionados),
      });
      setSeleccionados(new Set());
      await load();
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setBusy(false); }
  }

  // Carga la lista de compañeros disponibles. Si ya hay equipo, excluye a sus miembros
  // (para usarla en "Agregar miembro"). Si no hay equipo, carga toda la lista para el
  // multi-select de creación.
  useEffect(() => {
    if (!cohorteId) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    (async () => {
      try {
        const { data } = await api.get('/participantes/buscar', { params: { cohorte: cohorteId } });
        if (seq === searchSeq.current) {
          const miembrosIds = new Set((equipo?.miembros_equipo ?? []).map((m) => m.participantes_lista.id));
          setResults((data ?? []).filter((p: any) => !miembrosIds.has(p.id)));
        }
      } catch (e: any) {
        if (seq === searchSeq.current) setError(formatBackendError(e));
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    })();
  }, [cohorteId, equipo]);

  async function remover(participante_id: string) {
    if (!equipo) return;
    if (!confirm('¿Remover este miembro del equipo?')) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/equipos/${equipo.id}/remover-miembro`, { participante_id });
      await load();
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setBusy(false); }
  }

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando equipo…</main></>;
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Sección 1</p>
            <h1 className="section-title">Información del equipo</h1>
          </div>

          {error && (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6">
              {error}
            </div>
          )}

          {!equipo ? (
            <div className="space-y-6">
              <p className="text-inalde-gray">
                Aún no perteneces a un equipo. Selecciona a otro(s) participante(s) de tu modalidad y
                créalo en un solo paso (equipos de 1 a 3 personas).
              </p>

              {/* El Business Plan se identifica por el NOMBRE DEL PROYECTO (del
                  anteproyecto), no por un nombre de equipo (QA #8). El nombre
                  provisional solo aplica a Caso/PI, donde ES el nombre del trabajo. */}
              {modalidad !== 'business_plan' && (
                <div>
                  <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                    {modalidad === 'caso'
                      ? 'Nombre provisional del caso'
                      : 'Nombre provisional del proyecto de investigación'}
                  </label>
                  <input
                    type="text"
                    value={nombreEquipo}
                    onChange={(e) => setNombreEquipo(e.target.value)}
                    placeholder={
                      modalidad === 'caso'
                        ? 'Ej.: Caso Empresa XYZ'
                        : 'Ej.: Investigación en sector salud'
                    }
                    className="input-inalde"
                    maxLength={100}
                  />
                </div>
              )}

              <div>
                <p className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">
                  Participantes del equipo
                </p>
                <p className="text-xs text-inalde-gray mb-2">
                  Los equipos pueden ser de 1 a 3 personas. Tú ya cuentas como una, así que puedes
                  seleccionar hasta 2 participantes más.
                </p>
                {searching ? (
                  <p className="text-sm text-inalde-gray italic">Cargando participantes disponibles…</p>
                ) : results.length === 0 ? (
                  <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-xs text-inalde-text">
                    Aún no hay otros participantes disponibles en tu modalidad. Puedes crear el equipo
                    solo(a) y agregar participantes más adelante cuando ellos ingresen.
                  </div>
                ) : (
                  <>
                    <div className="border border-inalde-gray-light rounded max-h-60 overflow-y-auto divide-y divide-inalde-gray-light/60">
                      {results.map((p) => {
                        const checked = seleccionados.has(p.id);
                        const disabled = !checked && seleccionados.size >= 2;
                        return (
                          <label key={p.id}
                            className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-inalde-gray-bg/40 ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                            <input type="checkbox" checked={checked} disabled={disabled}
                              onChange={() => toggleSeleccionado(p.id)}
                              className="accent-inalde-red" />
                            <span className="font-medium">{p.nombre_completo}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-xs text-inalde-gray mt-2">
                      Tu equipo tendrá {seleccionados.size + 1} de 3 personas.
                    </p>
                  </>
                )}
              </div>

              <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-xs text-inalde-text">
                <strong>¿No encuentras a un participante en la lista?</strong> Es porque aún no ha
                ingresado a la plataforma o todavía no ha elegido su modalidad. Pídele que ingrese y
                seleccione la misma modalidad para que aparezca aquí.
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-inalde-gray-light">
                <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
                  ← Menú principal
                </button>
                <button onClick={crear} disabled={busy} className="btn-inalde-primary">
                  {busy ? 'Guardando…' : 'Siguiente →'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <p className="text-xs uppercase tracking-wider text-inalde-gray mb-1">
                  {equipo.tipo_trabajo_grado === 'caso'
                    ? 'Nombre provisional del caso'
                    : equipo.tipo_trabajo_grado === 'proyecto_investigacion'
                      ? 'Nombre provisional del proyecto de investigación'
                      : 'Tu equipo'}
                </p>
                <h2 className="text-xl font-primary font-bold text-inalde-text">
                  {equipo.tipo_trabajo_grado === 'business_plan'
                    ? (equipo.miembros_equipo
                        .slice()
                        .sort((a, b) => a.posicion - b.posicion)
                        .map((m) => m.participantes_lista?.nombre_completo)
                        .filter(Boolean)
                        .join(' · ') || 'Tu equipo')
                    : (equipo.nombre_equipo ?? '(sin nombre)')}
                </h2>
                <p className="text-xs text-inalde-gray mt-1">Cohorte {equipo.cohorte_id} · {equipo.miembros_equipo.length} de 3 miembros</p>
              </div>

              <div className="space-y-3 mb-8">
                {equipo.miembros_equipo
                  .sort((a, b) => a.posicion - b.posicion)
                  .map((m) => (
                    <div key={m.id} className="flex items-center justify-between p-4 border border-inalde-gray-light rounded">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-inalde-red text-white flex items-center justify-center font-primary font-bold text-sm">
                          {m.posicion}
                        </span>
                        <span className="font-medium">{m.participantes_lista.nombre_completo}</span>
                        {m.participantes_lista.id === equipo.creador_id && (
                          <span className="text-xs text-inalde-gold font-semibold uppercase tracking-wider">creador</span>
                        )}
                      </div>
                      {m.participantes_lista.id !== equipo.creador_id && (
                        <button
                          onClick={() => remover(m.participantes_lista.id)}
                          disabled={busy}
                          className="text-sm text-inalde-gray hover:text-inalde-red"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  ))}
              </div>

              {/* La conformacion del equipo se hace en un solo paso al crearlo
                  (multi-select en la pantalla previa). Aqui ya no se agregan
                  participantes uno a uno. */}

              <div className="mt-10 pt-6 border-t border-inalde-gray-light flex justify-between">
                <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
                  ← Dashboard
                </button>
                <button
                  onClick={() =>
                    navigate(equipo.tipo_trabajo_grado === 'business_plan' ? '/anteproyecto' : '/trabajo-grado')
                  }
                  className="btn-inalde-primary"
                >
                  {equipo.tipo_trabajo_grado === 'business_plan'
                    ? 'Continuar al anteproyecto →'
                    : 'Continuar a cargar el anteproyecto →'}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
