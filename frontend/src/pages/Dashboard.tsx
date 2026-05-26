import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../components/inalde/Header';
import { useAuth } from '../auth/store';
import { api } from '../lib/api';

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';

const MODALIDADES: Array<{
  id: Modalidad;
  emoji: string;
  titulo: string;
  descripcion: string;
}> = [
  {
    id: 'business_plan',
    emoji: '📋',
    titulo: 'Business Plan NAVES',
    descripcion: 'Equipo, miembros y formulario completo del anteproyecto NAVES',
  },
  {
    id: 'caso',
    emoji: '📄',
    titulo: 'Caso',
    descripcion: 'Sube el anteproyecto (PDF) y el proyecto final (PDF o Word)',
  },
  {
    id: 'proyecto_investigacion',
    emoji: '🔬',
    titulo: 'Proyecto de Investigación',
    descripcion: 'Sube el anteproyecto (PDF) y el proyecto final (PDF o Word)',
  },
];

function destinoModalidad(m: Modalidad): string {
  return m === 'business_plan' ? '/equipo' : '/equipo';
}

export default function Dashboard() {
  const { user, role, signOut } = useAuth();
  const isSuperAdmin = (user?.app_metadata as any)?.es_super_admin === true;
  const isProfesor = role === 'profesor' || role === 'super_admin';

  const [modalidad, setModalidad] = useState<Modalidad | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fijando, setFijando] = useState<Modalidad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);

  // Cargar el nombre real del usuario (no el email sintético hasheado)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await api.get('/auth/me');
        if (!cancel) setNombre(data?.nombre_completo ?? null);
      } catch { /* ignore */ }
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (role !== 'participante') {
      setCargando(false);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const { data } = await api.get('/participantes/mi-modalidad');
        if (!cancel) setModalidad((data?.tipo_trabajo_grado as Modalidad | null) ?? null);
      } catch (e: any) {
        if (!cancel) setError(e?.response?.data?.error ?? e.message);
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => { cancel = true; };
  }, [role]);

  async function elegirModalidad(m: Modalidad) {
    if (modalidad) return;
    const confirmar = window.confirm(
      `Vas a elegir "${MODALIDADES.find((x) => x.id === m)?.titulo}" como tu trabajo de grado. ` +
      `Esta elección es DEFINITIVA y no se puede cambiar. ¿Confirmas?`,
    );
    if (!confirmar) return;
    setFijando(m); setError(null);
    try {
      await api.put('/participantes/mi-modalidad', { tipo: m });
      setModalidad(m);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setFijando(null);
    }
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[900px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-6 mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="section-title mb-2">
                Bienvenid{role === 'participante' ? 'o' : 'o'}{nombre ? `, ${nombre}` : ''}
              </h1>
              <p className="text-inalde-gray text-sm leading-relaxed">
                Rol: <span className="text-inalde-red font-semibold uppercase tracking-wider">{role}</span>
                {role === 'participante' && (
                  <>
                    {' · '}
                    {modalidad
                      ? 'Tu modalidad de trabajo de grado ya está elegida.'
                      : 'Elige tu modalidad de trabajo de grado.'}
                  </>
                )}
              </p>
            </div>
            <button onClick={signOut} className="text-sm text-inalde-gray hover:text-inalde-red whitespace-nowrap">
              Salir
            </button>
          </div>

          {/* Vista participante */}
          {role === 'participante' && (
            <>
              {error && (
                <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6">
                  {error}
                </div>
              )}

              {cargando ? (
                <p className="text-inalde-gray">Cargando…</p>
              ) : (
                <>
                  <div className="grid sm:grid-cols-3 gap-5 mb-8">
                    {MODALIDADES.map((m) => {
                      const elegida = modalidad === m.id;
                      const otraElegida = !!modalidad && !elegida;

                      if (elegida) {
                        return (
                          <Link
                            key={m.id}
                            to={destinoModalidad(m.id)}
                            className="card-inalde-interactive flex flex-col gap-3 border-2 border-inalde-red"
                          >
                            <div className="text-3xl">{m.emoji}</div>
                            <h2 className="font-primary font-bold text-lg">{m.titulo}</h2>
                            <p className="text-inalde-gray text-sm">{m.descripcion}</p>
                            <span className="text-xs uppercase tracking-wider text-inalde-red font-semibold">
                              ✓ Tu modalidad · Continuar →
                            </span>
                          </Link>
                        );
                      }
                      if (otraElegida) {
                        return (
                          <div key={m.id} className="card-inalde flex flex-col gap-3 opacity-50 cursor-not-allowed">
                            <div className="text-3xl grayscale">{m.emoji}</div>
                            <h2 className="font-primary font-bold text-lg">{m.titulo}</h2>
                            <p className="text-inalde-gray text-sm">{m.descripcion}</p>
                            <span className="text-xs text-inalde-gray italic">No elegiste esta modalidad</span>
                          </div>
                        );
                      }
                      // sinElegir: clickable
                      return (
                        <button
                          key={m.id}
                          onClick={() => elegirModalidad(m.id)}
                          disabled={!!fijando}
                          className="card-inalde-interactive flex flex-col gap-3 text-left disabled:opacity-50"
                        >
                          <div className="text-3xl">{m.emoji}</div>
                          <h2 className="font-primary font-bold text-lg">{m.titulo}</h2>
                          <p className="text-inalde-gray text-sm">{m.descripcion}</p>
                          <span className="text-sm font-semibold text-inalde-red">
                            {fijando === m.id ? 'Guardando…' : 'Elegir esta modalidad →'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {modalidad && (
                    <div className="grid sm:grid-cols-2 gap-6">
                      {modalidad === 'business_plan' && (
                        <Link to="/seleccion" className="card-inalde-interactive flex flex-col gap-3">
                          <div className="text-3xl">✅</div>
                          <h2 className="font-primary font-bold text-lg">Selección del proyecto definitivo</h2>
                          <p className="text-inalde-gray text-sm">Después de la Reunión 1 con tu profesor</p>
                          <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
                        </Link>
                      )}
                      <Link to="/mi-profesor" className="card-inalde-interactive flex flex-col gap-3">
                        <div className="text-3xl">👨‍🏫</div>
                        <h2 className="font-primary font-bold text-lg">Mi profesor</h2>
                        <p className="text-inalde-gray text-sm">Profesor asignado y agenda</p>
                        <span className="text-sm font-semibold text-inalde-red">Ver →</span>
                      </Link>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Vista super_admin */}
          {isSuperAdmin && (
            <Link to="/admin" className="card-inalde-interactive flex items-center gap-6 p-8">
              <div className="text-5xl">⚙️</div>
              <div className="flex-1">
                <h2 className="font-primary font-bold text-xl mb-1">Panel administrativo</h2>
                <p className="text-inalde-gray text-sm">
                  Cohortes, participantes, profesores, anteproyectos, sábana de proyectos, solicitudes y auditoría.
                </p>
              </div>
              <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
            </Link>
          )}

          {/* Vista profesor (no super_admin) */}
          {isProfesor && !isSuperAdmin && (
            <div className="grid sm:grid-cols-2 gap-6">
              <Link to="/profesor/seleccionar-proyectos" className="card-inalde-interactive flex flex-col gap-3">
                <div className="text-3xl">🎯</div>
                <h2 className="font-primary font-bold text-lg">Elegir proyecto definitivo</h2>
                <p className="text-inalde-gray text-sm">Para cada uno de tus equipos asignados con más de un proyecto, marca cuál queda como definitivo después de la Reunión 1.</p>
                <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
              </Link>
              <Link to="/admin/anteproyectos" className="card-inalde-interactive flex flex-col gap-3">
                <div className="text-3xl">📋</div>
                <h2 className="font-primary font-bold text-lg">Ver anteproyectos</h2>
                <p className="text-inalde-gray text-sm">Lee los anteproyectos enviados por los equipos de tus cohortes.</p>
                <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
              </Link>
              <Link to="/admin/sabana" className="card-inalde-interactive flex flex-col gap-3">
                <div className="text-3xl">📑</div>
                <h2 className="font-primary font-bold text-lg">Sábana</h2>
                <p className="text-inalde-gray text-sm">Vista consolidada para la reunión de asignación.</p>
                <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
              </Link>
              <Link to="/admin/solicitudes" className="card-inalde-interactive flex flex-col gap-3">
                <div className="text-3xl">📨</div>
                <h2 className="font-primary font-bold text-lg">Solicitudes</h2>
                <p className="text-inalde-gray text-sm">Aprueba o rechaza desarchivado de proyectos.</p>
                <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
