import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/store';

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
  miembros_equipo: Miembro[];
}

export default function MiEquipo() {
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Array<{ id: string; nombre_completo: string }>>([]);
  const [nombreEquipo, setNombreEquipo] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  const cohorteId = (user?.app_metadata as any)?.cohorte_id ?? '';

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/equipos/mi-equipo');
      setEquipo(data.equipo);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function crear() {
    setBusy(true); setError(null);
    try {
      await api.post('/equipos', { nombre_equipo: nombreEquipo || undefined });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message);
    } finally { setBusy(false); }
  }

  async function buscar() {
    if (!cohorteId) { setError('No se detectó tu cohorte en el JWT'); return; }
    try {
      const { data } = await api.get('/participantes/buscar', { params: { cohorte: cohorteId, query: search } });
      setResults(data);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message);
    }
  }

  async function agregar(participante_id: string) {
    if (!equipo) return;
    setBusy(true); setError(null);
    try {
      // Buscar siguiente posición libre (2 o 3)
      const taken = new Set(equipo.miembros_equipo.map((m) => m.posicion));
      const posicion = [2, 3].find((p) => !taken.has(p));
      if (!posicion) { setError('Equipo lleno (máx 3)'); return; }
      await api.post(`/equipos/${equipo.id}/agregar-miembro`, { participante_id, posicion });
      await load();
      setSearch(''); setResults([]);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message);
    } finally { setBusy(false); }
  }

  async function remover(participante_id: string) {
    if (!equipo) return;
    if (!confirm('¿Remover este miembro del equipo?')) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/equipos/${equipo.id}/remover-miembro`, { participante_id });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message);
    } finally { setBusy(false); }
  }

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando equipo…</main></>;
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Sección 1</p>
            <h1 className="section-title">Información del equipo emprendedor</h1>
          </div>

          {error && (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6">
              {error}
            </div>
          )}

          {!equipo ? (
            <div className="space-y-6">
              <p className="text-inalde-gray">
                Aún no perteneces a un equipo. Crea uno y luego agrega 1 o 2 compañeros (equipos de 1, 2 o 3 personas).
              </p>
              <div>
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                  Nombre del equipo (opcional)
                </label>
                <input
                  type="text"
                  value={nombreEquipo}
                  onChange={(e) => setNombreEquipo(e.target.value)}
                  placeholder="Los Disruptores"
                  className="input-inalde"
                  maxLength={100}
                />
              </div>
              <button onClick={crear} disabled={busy} className="btn-inalde-primary">
                {busy ? 'Creando…' : 'Crear mi equipo →'}
              </button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <p className="text-xs uppercase tracking-wider text-inalde-gray mb-1">Equipo</p>
                <h2 className="text-xl font-primary font-bold text-inalde-text">
                  {equipo.nombre_equipo ?? '(sin nombre)'}
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

              {equipo.miembros_equipo.length < 3 && (
                <div className="border-t border-inalde-gray-light pt-6">
                  <p className="section-subtitle mb-3">Agregar miembro</p>
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && buscar()}
                      placeholder="Busca por nombre…"
                      className="input-inalde flex-1"
                    />
                    <button onClick={buscar} className="btn-inalde-primary">Buscar</button>
                  </div>
                  {results.length > 0 && (
                    <ul className="border border-inalde-gray-light rounded divide-y divide-inalde-gray-light">
                      {results.map((p) => (
                        <li key={p.id} className="flex items-center justify-between px-4 py-3">
                          <span>{p.nombre_completo}</span>
                          <button
                            onClick={() => agregar(p.id)}
                            disabled={busy}
                            className="text-sm font-semibold text-inalde-red hover:text-inalde-red-hover"
                          >
                            Agregar →
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="mt-10 pt-6 border-t border-inalde-gray-light flex justify-between">
                <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
                  ← Dashboard
                </button>
                <button onClick={() => navigate('/anteproyecto')} className="btn-inalde-primary">
                  Continuar al anteproyecto →
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
