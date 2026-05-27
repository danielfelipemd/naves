import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header } from '../components/inalde/Header';
import { useAuth } from '../auth/store';
import { api } from '../lib/api';
import { formatBackendError } from '../lib/errors';

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
    descripcion: 'Conformación de equipo y formulario de anteproyecto NAVES.',
  },
  {
    id: 'caso',
    emoji: '📄',
    titulo: 'Caso',
    descripcion: 'Conformación de equipo y cargue del anteproyecto.',
  },
  {
    id: 'proyecto_investigacion',
    emoji: '🔬',
    titulo: 'Proyecto de Investigación',
    descripcion: 'Conformación de equipo y cargue del anteproyecto.',
  },
];

function destinoModalidad(_m: Modalidad): string {
  // Todas las modalidades pasan por la pantalla de equipo (1 a 3 miembros).
  // En business_plan luego van al formulario; en caso/PI van a subir archivos.
  return '/equipo';
}

// Convención colombiana: "Nombre1 [Nombre2] Apellido1 Apellido2".
// Quita los dos últimos tokens (apellidos) si hay 3 o más; si solo hay 1 o 2,
// usa el primero.
function soloNombres(full: string | null | undefined): string {
  if (!full) return '';
  const parts = full.trim().split(/\s+/);
  if (parts.length >= 3) return parts.slice(0, parts.length - 2).join(' ');
  return parts[0] ?? '';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, role, signOut, refreshEstado, requierePerfil } = useAuth();

  // Si es BP y aun no completo el perfil emprendedor, no puede estar en
  // ninguna otra pantalla (incluida esta). Se le envia inmediatamente al
  // formulario; el resto del flujo queda bloqueado hasta que termine.
  useEffect(() => {
    if (role === 'participante' && requierePerfil) {
      navigate('/mi-perfil', { replace: true });
    }
  }, [role, requierePerfil, navigate]);
  const isSuperAdmin = (user?.app_metadata as any)?.es_super_admin === true;
  const isProfesor = role === 'profesor' || role === 'super_admin';

  const [modalidad, setModalidad] = useState<Modalidad | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fijando, setFijando] = useState<Modalidad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  const [esperandoEquipo, setEsperandoEquipo] = useState(false);
  const [enEquipo, setEnEquipo] = useState(false);
  const [opBusy, setOpBusy] = useState(false);

  // Cargar el nombre real del usuario + flags de equipo
  async function cargarMe() {
    try {
      const { data } = await api.get('/auth/me');
      setNombre(data?.nombre_completo ?? null);
      setEsperandoEquipo(!!data?.esperando_equipo);
    } catch { /* ignore */ }
  }
  useEffect(() => { cargarMe(); }, []);

  // Saber si el participante ya está en un equipo (para no mostrar la pantalla
  // 'esperando' si ya fue agregado).
  useEffect(() => {
    if (role !== 'participante') return;
    (async () => {
      try {
        const { data } = await api.get('/equipos/mi-equipo');
        setEnEquipo(!!data?.equipo);
      } catch { /* ignore */ }
    })();
  }, [role]);

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
        if (!cancel) setError(formatBackendError(e));
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => { cancel = true; };
  }, [role]);

  // Modalidad recien elegida: muestra la pantalla intermedia "estas en la lista"
  // antes de llevar al participante al flujo de equipo.
  const [recienElegida, setRecienElegida] = useState<Modalidad | null>(null);

  async function elegirEsperar() {
    if (!recienElegida) return;
    setOpBusy(true); setError(null);
    try {
      await api.put('/participantes/esperar-equipo');
      setEsperandoEquipo(true);
      setRecienElegida(null);
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setOpBusy(false); }
  }

  async function cancelarEspera() {
    setOpBusy(true); setError(null);
    try {
      await api.put('/participantes/cancelar-espera');
      setEsperandoEquipo(false);
      navigate('/equipo', { replace: true });
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setOpBusy(false); }
  }

  async function volverMenuDesdeEspera() {
    setOpBusy(true); setError(null);
    try {
      await api.put('/participantes/cancelar-espera');
      setEsperandoEquipo(false);
      // Queda en el dashboard normal con modalidad ya elegida
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setOpBusy(false); }
  }

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
      // Refresca el estado: para BP activa requierePerfil (lo usa
      // ProtectedRoute para redirigir cualquier otra ruta a /mi-perfil).
      await refreshEstado();
      setModalidad(m);
      if (m === 'business_plan') {
        // BP: pasa inmediatamente al formulario del perfil emprendedor.
        // Es obligatorio antes de poder ir a /equipo o cualquier otra
        // pantalla del flujo; saltar este paso bloqueaba la creacion
        // de equipo con un error que el usuario no entendia.
        navigate('/mi-perfil', { replace: true });
        return;
      }
      // Caso / Proyecto de investigacion: pantalla intermedia para que
      // decida entre crear equipo o esperar a ser agregado.
      setRecienElegida(m);
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally {
      setFijando(null);
    }
  }

  // Pantalla intermedia tras elegir modalidad: confirmacion de que el participante
  // ya esta en la lista de candidatos para su modalidad. De aqui pasa al flujo de
  // formacion de equipo. Si para ese momento ya lo seleccionaron, vera el equipo
  // formado en /equipo; si no, vera la pantalla para crear equipo.
  if (recienElegida) {
    const labelModalidad = MODALIDADES.find((x) => x.id === recienElegida)?.titulo ?? '';
    return (
      <>
        <Header />
        <main className="pt-36 pb-16 px-4">
          <div className="max-w-[640px] mx-auto bg-white rounded-lg shadow-inalde-card p-6 sm:p-10">
            <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
              <p className="section-subtitle mb-2">Modalidad elegida</p>
              <h1 className="section-title">
                Estás en la lista de participantes que eligieron la modalidad {labelModalidad}
              </h1>
            </div>
            <p className="text-inalde-gray mb-6 leading-relaxed">
              Desde este momento estás disponible para que otros participantes de esta misma
              modalidad te seleccionen o para crear tu equipo.
            </p>
            {error && (
              <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-4">
                {error}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => navigate(destinoModalidad(recienElegida), { replace: true })}
                disabled={opBusy}
                className="btn-inalde-primary disabled:opacity-40">
                Continuar a Mi equipo →
              </button>
              <button
                onClick={elegirEsperar}
                disabled={opBusy}
                className="px-5 py-3 rounded font-primary font-semibold text-xs uppercase tracking-wider border-2 border-inalde-gray text-inalde-gray hover:border-inalde-text hover:text-inalde-text transition disabled:opacity-40">
                {opBusy ? 'Guardando…' : 'Esperar a ser agregado'}
              </button>
            </div>
            <p className="text-xs text-inalde-gray mt-4 leading-relaxed">
              <strong>"Esperar a ser agregado":</strong> volverás al menú principal y, hasta que otro
              participante te agregue a su equipo, no podrás avanzar en el sistema. Pídele al
              participante que te agregue cuando ingrese.
            </p>
          </div>
        </main>
      </>
    );
  }

  // Pantalla bloqueada "esperando a ser agregado": el participante eligio
  // explicitamente esperar y aun no tiene equipo. No puede avanzar hasta que
  // alguien lo agregue (auto-clear del flag) o decida crear su propio equipo.
  if (role === 'participante' && esperandoEquipo && !enEquipo) {
    const labelModalidad = modalidad ? MODALIDADES.find((x) => x.id === modalidad)?.titulo ?? '' : '';
    return (
      <>
        <Header />
        <main className="pt-36 pb-16 px-4">
          <div className="max-w-[640px] mx-auto bg-white rounded-lg shadow-inalde-card p-6 sm:p-10">
            <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
              <p className="section-subtitle mb-2">Esperando</p>
              <h1 className="section-title">Estás a la espera de ser agregado a un equipo</h1>
            </div>
            {nombre && (
              <p className="text-inalde-text mb-3">Hola, <strong>{nombre}</strong>.</p>
            )}
            <p className="text-inalde-gray mb-3 leading-relaxed">
              Elegiste la modalidad <strong>{labelModalidad}</strong> y declaraste que esperarás a que
              otro participante te agregue a su equipo.
            </p>
            <p className="text-inalde-gray mb-6 leading-relaxed">
              Cuando un participante te agregue, esta pantalla se cerrará automáticamente y podrás
              continuar con tu trabajo de grado. Mientras tanto no es posible avanzar en el sistema.
            </p>
            {error && (
              <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-4">
                {error}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={cargarMe} disabled={opBusy} className="btn-inalde-primary disabled:opacity-40">
                Volver a comprobar
              </button>
              <button
                onClick={volverMenuDesdeEspera}
                disabled={opBusy}
                className="px-5 py-3 rounded font-primary font-semibold text-xs uppercase tracking-wider border-2 border-inalde-gray text-inalde-gray hover:border-inalde-text hover:text-inalde-text transition disabled:opacity-40">
                {opBusy ? 'Procesando…' : 'Volver al menú principal'}
              </button>
            </div>
            <div className="mt-5">
              <button
                onClick={cancelarEspera}
                disabled={opBusy}
                className="text-sm text-inalde-gray hover:text-inalde-red underline disabled:opacity-40">
                {opBusy ? 'Procesando…' : 'Cambié de opinión, quiero crear mi equipo'}
              </button>
            </div>
            <div className="mt-8 pt-4 border-t border-inalde-gray-light">
              <button onClick={signOut} className="text-sm text-inalde-gray hover:text-inalde-text">
                Cerrar sesión
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[900px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-6 mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="section-title mb-2">
                Te damos la bienvenida{nombre ? `, ${soloNombres(nombre)}` : ''}
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
                        <Link to="/mi-perfil" className="card-inalde-interactive flex flex-col gap-3">
                          <div className="text-3xl">🧭</div>
                          <h2 className="font-primary font-bold text-lg">Mi perfil emprendedor</h2>
                          <p className="text-inalde-gray text-sm">Llena tu perfil <strong>antes de formar equipo</strong></p>
                          <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
                        </Link>
                      )}
                      {modalidad === 'business_plan' && (
                        <Link to="/seleccion" className="card-inalde-interactive flex flex-col gap-3">
                          <div className="text-3xl">✅</div>
                          <h2 className="font-primary font-bold text-lg">Selección del proyecto definitivo</h2>
                          <p className="text-inalde-gray text-sm">Después de la Reunión 1 con tu profesor</p>
                          <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
                        </Link>
                      )}
                      {modalidad === 'business_plan' && (
                        <Link to="/mi-profesor" className="card-inalde-interactive flex flex-col gap-3">
                          <div className="text-3xl">👨‍🏫</div>
                          <h2 className="font-primary font-bold text-lg">Mi profesor</h2>
                          <p className="text-inalde-gray text-sm">Profesor asignado y agenda</p>
                          <span className="text-sm font-semibold text-inalde-red">Ver →</span>
                        </Link>
                      )}
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
