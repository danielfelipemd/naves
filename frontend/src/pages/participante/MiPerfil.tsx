import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/store';
import { formatBackendError } from '../../lib/errors';

type Perfil = 'emprendedor' | 'directivo' | 'ambos';
type Emocion = 'crear' | 'dinero' | 'problema' | 'autonomia' | 'ninguna';
type Preocupacion = 'financiera' | 'estres' | 'habilidades' | 'familia' | 'ninguna';
type Quiebra = 'nunca_despego' | 'funcionamiento' | 'vendido' | 'quebro' | 'na';

const PERFILES: Array<{ value: Perfil; label: string }> = [
  { value: 'emprendedor', label: 'Emprendedor (crear desde cero)' },
  { value: 'directivo',   label: 'Directivo (liderar estructuras existentes)' },
  { value: 'ambos',       label: 'Ambos por igual' },
];
const EMOCIONES: Array<{ value: Emocion; label: string }> = [
  { value: 'crear',     label: 'Crear algo nuevo desde cero' },
  { value: 'dinero',    label: 'El potencial económico' },
  { value: 'problema',  label: 'Resolver un problema que me apasiona' },
  { value: 'autonomia', label: 'La autonomía e independencia' },
  { value: 'ninguna',   label: 'Aún no siento emoción' },
];
const PREOCUPACIONES: Array<{ value: Preocupacion; label: string }> = [
  { value: 'financiera',  label: 'La incertidumbre financiera' },
  { value: 'estres',      label: 'El estrés y sobrecarga de trabajo' },
  { value: 'habilidades', label: 'No sé si tengo las habilidades necesarias' },
  { value: 'familia',     label: 'El impacto en mi familia' },
  { value: 'ninguna',     label: 'Aún no me preocupa nada' },
];
const ESTADO_EMPRENDIMIENTO: Array<{ value: Quiebra; label: string }> = [
  { value: 'nunca_despego',  label: 'Nunca despegó' },
  { value: 'funcionamiento', label: 'Está en funcionamiento' },
  { value: 'vendido',        label: 'Lo vendí' },
  { value: 'quebro',         label: 'Se quebró' },
  { value: 'na',             label: 'N/A' },
];

export default function MiPerfil() {
  const navigate = useNavigate();
  const refreshEstado = useAuth((s) => s.refreshEstado);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yaCompleto, setYaCompleto] = useState(false);

  const [perfil, setPerfil] = useState<Perfil | ''>('');
  const [fueEmprendedor, setFueEmprendedor] = useState<boolean | null>(null);
  const [quiebra, setQuiebra] = useState<Quiebra | ''>('');
  const [aprendizajes, setAprendizajes] = useState('');
  const [emociones, setEmociones] = useState<Emocion[]>([]);
  const [preocupaciones, setPreocupaciones] = useState<Preocupacion[]>([]);

  useEffect(() => { (async () => {
    try {
      const { data } = await api.get('/participantes/mi-perfil');
      if (data?.perfil) setPerfil(data.perfil);
      if (typeof data?.fue_emprendedor === 'boolean') setFueEmprendedor(data.fue_emprendedor);
      if (data?.quiebra) setQuiebra(data.quiebra);
      if (data?.aprendizajes_quiebra) setAprendizajes(data.aprendizajes_quiebra);
      if (Array.isArray(data?.emociones)) setEmociones(data.emociones);
      if (Array.isArray(data?.preocupaciones)) setPreocupaciones(data.preocupaciones);
      if (data?.perfil_completo_at) setYaCompleto(true);
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setLoading(false); }
  })(); }, []);

  function toggleArr<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!perfil) { setError('Elige tu rol.'); return; }
    if (fueEmprendedor === null) { setError('Indica si has hecho algún emprendimiento.'); return; }
    if (fueEmprendedor && !quiebra) { setError('Indica el estado de tu emprendimiento.'); return; }
    if (fueEmprendedor && quiebra === 'quebro' && aprendizajes.trim().length < 20) {
      setError('Cuéntanos al menos 20 caracteres sobre los aprendizajes de la quiebra.');
      return;
    }
    if (emociones.length === 0) { setError('Selecciona al menos una emoción.'); return; }
    if (preocupaciones.length === 0) { setError('Selecciona al menos una preocupación.'); return; }

    setBusy(true);
    try {
      await api.put('/participantes/mi-perfil', {
        perfil,
        fue_emprendedor: fueEmprendedor,
        quiebra: fueEmprendedor ? quiebra : undefined,
        aprendizajes_quiebra: fueEmprendedor && quiebra === 'quebro' ? aprendizajes : undefined,
        emociones,
        preocupaciones,
      });
      await refreshEstado();
      navigate('/', { replace: true });
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setBusy(false); }
  }

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Diligenciar antes de formar equipo</p>
            <h1 className="section-title">Mi perfil emprendedor</h1>
            <p className="text-sm text-inalde-text mt-3">
              Este formulario lo llena <strong>cada participante</strong> antes de crear o ser agregado a un equipo.
              {yaCompleto && ' Ya lo completaste; puedes editarlo si lo necesitas.'}
            </p>
          </div>

          <form onSubmit={guardar} className="space-y-8">
            <div>
              <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                Rol con el que más te identificas
              </label>
              <select value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil)} className="input-inalde">
                <option value="">Selecciona…</option>
                {PERFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            <div>
              <h2 className="font-primary font-bold text-base text-inalde-text mb-3">Perfil emprendedor</h2>
              <p className="text-sm text-inalde-red font-primary font-semibold mb-2">¿Has hecho algún emprendimiento?</p>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="fue" checked={fueEmprendedor === false} onChange={() => setFueEmprendedor(false)} /> No
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="fue" checked={fueEmprendedor === true} onChange={() => setFueEmprendedor(true)} /> Sí
                </label>
              </div>

              {fueEmprendedor && (
                <div className="mt-4 space-y-4 pl-4 border-l-[3px] border-inalde-gold">
                  <div>
                    <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                      Estado del emprendimiento
                    </label>
                    <select value={quiebra} onChange={(e) => setQuiebra(e.target.value as Quiebra)} className="input-inalde">
                      <option value="">Selecciona…</option>
                      {ESTADO_EMPRENDIMIENTO.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
                    </select>
                  </div>
                  {quiebra === 'quebro' && (
                    <div>
                      <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                        ¿Cuál fue el aprendizaje de esta gran experiencia?
                      </label>
                      <textarea value={aprendizajes} onChange={(e) => setAprendizajes(e.target.value)} maxLength={200} rows={3} className="input-inalde resize-none" />
                      <p className="text-xs text-inalde-gray text-right mt-1">{aprendizajes.length} / 200</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-inalde-red font-primary font-semibold mb-1">¿Qué te emociona del emprendimiento?</p>
              <p className="text-xs text-inalde-gray italic mb-3">Selecciona uno o varios</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {EMOCIONES.map((e) => (
                  <label key={e.value} className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded hover:bg-inalde-gray-bg/40">
                    <input type="checkbox" checked={emociones.includes(e.value)} onChange={() => setEmociones((arr) => toggleArr(arr, e.value))} className="accent-inalde-red" />
                    {e.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm text-inalde-red font-primary font-semibold mb-1">¿Qué te preocupa?</p>
              <p className="text-xs text-inalde-gray italic mb-3">Selecciona uno o varios</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {PREOCUPACIONES.map((p) => (
                  <label key={p.value} className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded hover:bg-inalde-gray-bg/40">
                    <input type="checkbox" checked={preocupaciones.includes(p.value)} onChange={() => setPreocupaciones((arr) => toggleArr(arr, p.value))} className="accent-inalde-red" />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end border-t border-inalde-gray-light pt-5">
              <button type="button" onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
                Volver
              </button>
              <button type="submit" disabled={busy} className="btn-inalde-primary !py-2 !px-5 !text-sm">
                {busy ? 'Guardando…' : yaCompleto ? 'Actualizar perfil →' : 'Guardar perfil y continuar →'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
