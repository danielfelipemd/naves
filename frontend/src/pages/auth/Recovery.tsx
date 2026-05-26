import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';

export default function Recovery() {
  const [mode, setMode] = useState<'cedula' | 'email'>('cedula');
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const payload = mode === 'cedula'
        ? { cedula: identifier.replace(/[\s.\-]/g, '') }
        : { email: identifier.trim().toLowerCase() };
      await api.post('/auth/recovery', payload);
      setDone(true);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[480px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Recuperar acceso</p>
            <h1 className="section-title">Olvidé mi clave</h1>
          </div>

          {done ? (
            <>
              <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm mb-6">
                Si el usuario existe, recibirás un correo en tu email institucional con un enlace para crear una nueva clave.
                El enlace expira en 30 minutos.
              </div>
              <Link to="/login" className="text-sm text-inalde-red font-semibold">← Volver al login</Link>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mb-6 p-1 bg-inalde-gray-bg rounded">
                <button type="button" onClick={() => { setMode('cedula'); setIdentifier(''); }}
                  className={`py-2 rounded text-sm font-primary font-semibold uppercase tracking-wider ${mode === 'cedula' ? 'bg-white text-inalde-red shadow' : 'text-inalde-gray'}`}>
                  Participante
                </button>
                <button type="button" onClick={() => { setMode('email'); setIdentifier(''); }}
                  className={`py-2 rounded text-sm font-primary font-semibold uppercase tracking-wider ${mode === 'email' ? 'bg-white text-inalde-red shadow' : 'text-inalde-gray'}`}>
                  Profesor
                </button>
              </div>

              <form onSubmit={submit} className="space-y-5">
                <div>
                  <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                    {mode === 'cedula' ? 'Cédula' : 'Email institucional'}
                  </label>
                  <input
                    type={mode === 'cedula' ? 'tel' : 'email'}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    className="input-inalde"
                  />
                </div>
                {error && (
                  <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm">{error}</div>
                )}
                <button type="submit" disabled={busy} className="btn-inalde-primary w-full">
                  {busy ? 'Enviando…' : 'Enviar enlace de recuperación'}
                </button>
                <div className="text-center text-sm">
                  <Link to="/login" className="text-inalde-gray hover:text-inalde-red">← Volver al login</Link>
                </div>
              </form>
            </>
          )}
        </div>
      </main>
    </>
  );
}
