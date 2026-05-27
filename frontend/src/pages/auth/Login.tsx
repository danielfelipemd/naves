import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { supabase, syntheticEmailFromCedula } from '../../lib/supabase';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

type Mode = 'participante' | 'profesor';

export default function Login() {
  const [mode, setMode] = useState<Mode>('participante');
  const [identifier, setIdentifier] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let email: string;
      if (mode === 'participante') {
        const clean = identifier.replace(/[\s.\-]/g, '');
        if (!/^\d{6,20}$/.test(clean)) {
          throw new Error('La cédula debe tener entre 6 y 20 dígitos.');
        }
        // Verifica que la cédula esté en la lista pre-cargada
        try {
          await api.post('/auth/verificar-cedula', { cedula: clean });
        } catch (err: any) {
          const code = err?.response?.data?.error;
          if (code === 'CEDULA_NO_ENCONTRADA') {
            throw new Error('Tu cédula no está registrada. Pídele a tu profesor que te incluya en la lista de la cohorte.');
          }
          throw err;
        }
        email = await syntheticEmailFromCedula(clean);
      } else {
        email = identifier.trim().toLowerCase();
      }

      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: clave });
      if (authErr) {
        const msg = (authErr.message ?? '').toLowerCase();
        const status = (authErr as any)?.status;
        if (status === 429 || msg.includes('rate') || msg.includes('too many')) {
          throw new Error('Demasiados intentos de inicio de sesión. Espera unos segundos y vuelve a intentar.');
        }
        if (msg.includes('invalid')) {
          throw new Error('La cédula o la clave no coinciden. Si es tu primer ingreso, recuerda que tu clave inicial es tu cédula.');
        }
        if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
          throw new Error('Tu cuenta aún no fue confirmada por el administrador. Contacta a la asistente del programa.');
        }
        if (status && status >= 500) {
          throw new Error('Tuvimos un problema autenticándote. Inténtalo en unos minutos.');
        }
        throw new Error('No pudimos iniciar tu sesión. Verifica tu cédula y clave e inténtalo de nuevo.');
      }
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(formatBackendError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[480px] mx-auto">
          <div className="bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
            <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
              <p className="section-subtitle mb-2">Iniciar sesión</p>
              <h1 className="section-title">
                Bienvenid{mode === 'participante' ? 'o' : 'a'} a la plataforma de trabajos de grado del MBA
              </h1>
            </div>

            {/* Toggle rol */}
            <div className="grid grid-cols-2 gap-2 mb-8 p-1 bg-inalde-gray-bg rounded">
              <button
                type="button"
                onClick={() => { setMode('participante'); setIdentifier(''); }}
                className={`py-2 rounded font-primary font-semibold text-sm tracking-wider uppercase transition
                  ${mode === 'participante' ? 'bg-white text-inalde-red shadow' : 'text-inalde-gray hover:text-inalde-text'}`}
              >
                Participante
              </button>
              <button
                type="button"
                onClick={() => { setMode('profesor'); setIdentifier(''); }}
                className={`py-2 rounded font-primary font-semibold text-sm tracking-wider uppercase transition
                  ${mode === 'profesor' ? 'bg-white text-inalde-red shadow' : 'text-inalde-gray hover:text-inalde-text'}`}
              >
                Profesor
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-5">
              <div>
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                  {mode === 'participante' ? 'Cédula' : 'Email institucional'}
                </label>
                <input
                  type={mode === 'participante' ? 'tel' : 'email'}
                  inputMode={mode === 'participante' ? 'numeric' : 'email'}
                  autoComplete={mode === 'participante' ? 'username' : 'email'}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="input-inalde"
                />
              </div>

              <div>
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                  Clave
                </label>
                <div className="relative">
                  <input
                    type={verClave ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    required
                    minLength={6}
                    className="input-inalde pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setVerClave((v) => !v)}
                    aria-label={verClave ? 'Ocultar clave' : 'Mostrar clave'}
                    className="absolute inset-y-0 right-3 flex items-center text-inalde-gray hover:text-inalde-red transition">
                    {verClave ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                {mode === 'participante' && (
                  <p className="text-sm text-inalde-text mt-2">
                    Si es tu primer ingreso, tu clave es tu <strong>número de cédula</strong>.
                  </p>
                )}
              </div>

              {error && (
                <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm text-inalde-text">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-inalde-primary w-full">
                {loading ? 'Ingresando...' : 'Ingresar →'}
              </button>

              <div className="text-sm pt-2">
                <Link to="/recovery" className="text-inalde-gray hover:text-inalde-red transition">
                  ¿Olvidaste tu clave?
                </Link>
              </div>
            </form>
          </div>

          <p className="text-center text-xs text-inalde-gray mt-6 leading-relaxed">
            NAVES — Nuevas Aventuras Empresariales
            <br />
            INALDE Business School · MBA
          </p>
        </div>
      </main>
    </>
  );
}
