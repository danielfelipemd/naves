import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/store';
import { formatBackendError } from '../../lib/errors';

export default function CambiarClaveInicial() {
  const navigate = useNavigate();
  const marcarActivado = useAuth((s) => s.marcarActivado);
  const nombre = useAuth((s) => s.nombre ?? '');
  const [clave1, setClave1] = useState('');
  const [clave2, setClave2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave1 !== clave2) { setError('Las claves no coinciden.'); return; }
    if (clave1.length < 8 || !/[A-Z]/.test(clave1) || !/[a-z]/.test(clave1) || !/\d/.test(clave1)) {
      setError('La clave debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/cambiar-clave-inicial', { password: clave1 });
      marcarActivado();
      navigate('/', { replace: true });
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setLoading(false); }
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[520px] mx-auto">
          <div className="bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
            <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
              <p className="section-subtitle mb-2">Primer ingreso</p>
              <h1 className="section-title">Crea tu clave personal</h1>
            </div>

            <p className="text-sm text-inalde-text mb-6">
              Esta es la primera vez que entras a NAVES. Por seguridad, debes reemplazar la clave temporal
              (tu número de cédula) por una clave propia antes de continuar.
            </p>

            <form onSubmit={onSubmit} className="space-y-5">
              <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-xs text-inalde-text">
                Tu clave debe tener mínimo <strong>8 caracteres</strong>, una <strong>mayúscula</strong>,
                una <strong>minúscula</strong> y un <strong>número</strong>.
              </div>

              <div>
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                  Nueva clave
                </label>
                <input type="password" autoComplete="new-password" minLength={8}
                  value={clave1} onChange={(e) => setClave1(e.target.value)}
                  required className="input-inalde" />
              </div>

              <div>
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                  Repite la clave
                </label>
                <input type="password" autoComplete="new-password" minLength={8}
                  value={clave2} onChange={(e) => setClave2(e.target.value)}
                  required className="input-inalde" />
              </div>

              {error && (
                <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm text-inalde-text">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-inalde-primary w-full">
                {loading ? 'Guardando…' : 'Activar mi cuenta →'}
              </button>
            </form>

            {nombre && (
              <p className="text-center text-[11px] text-inalde-gray mt-6">
                Sesión iniciada como <span className="font-semibold text-inalde-text">{nombre}</span>
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
