import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { PasswordInput } from '../../components/inalde/PasswordInput';
import { api } from '../../lib/api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (pw !== pw2) { setError('Las claves no coinciden.'); return; }
    if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw) || pw.length < 8) {
      setError('Mínimo 8 caracteres con mayúscula, minúscula y número.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/recovery/confirm', { token, password: pw });
      alert('Clave actualizada. Inicia sesión con tu nueva clave.');
      navigate('/login', { replace: true });
    } catch (e: any) {
      const code = e?.response?.data?.error;
      const map: Record<string, string> = {
        TOKEN_NOT_FOUND: 'Enlace inválido.',
        TOKEN_USED: 'Este enlace ya fue utilizado. Solicita uno nuevo.',
        TOKEN_EXPIRED: 'El enlace expiró. Solicita uno nuevo.',
      };
      setError(map[code] ?? code ?? e.message);
    } finally { setBusy(false); }
  }

  if (!token) {
    return (
      <>
        <Header />
        <main className="pt-36 px-4">
          <div className="max-w-[420px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10 text-center">
            <p className="text-inalde-gray mb-4">Enlace inválido.</p>
            <Link to="/recovery" className="text-inalde-red font-semibold">Solicitar uno nuevo →</Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[420px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Nueva clave</p>
            <h1 className="section-title">Crear nueva contraseña</h1>
          </div>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                Nueva clave
              </label>
              <PasswordInput value={pw} onChange={setPw}
                required minLength={8} autoComplete="new-password" />
              <p className="text-xs text-inalde-gray mt-1">Mín 8 caracteres, con mayúscula, minúscula y número.</p>
            </div>
            <div>
              <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                Repetir nueva clave
              </label>
              <PasswordInput value={pw2} onChange={setPw2}
                required minLength={8} autoComplete="new-password" />
            </div>
            {error && <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm">{error}</div>}
            <button type="submit" disabled={busy} className="btn-inalde-primary w-full">
              {busy ? 'Procesando…' : 'Cambiar clave →'}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
