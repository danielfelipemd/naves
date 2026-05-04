import { Link } from 'react-router-dom';
import { Header } from '../components/inalde/Header';
import { useAuth } from '../auth/store';

export default function Dashboard() {
  const { user, role, signOut } = useAuth();
  const isSuperAdmin = (user?.app_metadata as any)?.es_super_admin === true;
  const isProfesor = role === 'profesor' || role === 'super_admin';

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[900px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
          <div className="border-b-[3px] border-inalde-red pb-6 mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="section-title mb-2">
                Bienvenid{role === 'profesor' || role === 'super_admin' ? 'o' : 'o'} a NAVES
              </h1>
              <p className="text-inalde-gray text-sm leading-relaxed">
                {role === 'participante'
                  ? 'Selecciona la entrega de trabajo de grado que deseas completar.'
                  : 'Acceso al sistema de gestión del trabajo de grado del MBA.'}
              </p>
            </div>
            <button onClick={signOut} className="text-sm text-inalde-gray hover:text-inalde-red whitespace-nowrap">
              Salir
            </button>
          </div>

          <div className="text-xs text-inalde-gray mb-8">
            Sesión: <span className="text-inalde-text">{user?.email}</span> · Rol:{' '}
            <span className="text-inalde-red font-semibold uppercase tracking-wider">{role}</span>
          </div>

          {/* Vista participante */}
          {role === 'participante' && (
            <div className="grid sm:grid-cols-2 gap-8">
              <Link to="/equipo" className="card-inalde-interactive flex flex-col gap-4 text-center">
                <div className="text-5xl">📋</div>
                <h2 className="font-primary font-bold text-xl">Anteproyecto NAVES</h2>
                <p className="text-inalde-gray text-sm">Primera etapa — tu idea de negocio en síntesis</p>
                <p className="text-xs font-semibold tracking-wider text-inalde-gold">Equipo · Canvas · CIIU · Cronograma</p>
                <span className="btn-inalde-primary mt-auto">Comenzar →</span>
              </Link>
              <div className="card-inalde flex flex-col gap-4 text-center opacity-60">
                <div className="text-5xl">📊</div>
                <h2 className="font-primary font-bold text-xl">Business Plan Final</h2>
                <p className="text-inalde-gray text-sm">Segunda etapa</p>
                <p className="text-xs font-semibold tracking-wider text-inalde-gold">Mercado · Financiero · Riesgos</p>
                <span className="inline-block bg-inalde-gray-bg text-inalde-gray px-5 py-3 rounded-full text-xs font-semibold mt-auto">
                  🔒 Próximamente
                </span>
              </div>
            </div>
          )}

          {/* Vista profesor / super_admin */}
          {isProfesor && (
            <div className="grid sm:grid-cols-2 gap-6">
              {isSuperAdmin && (
                <Link to="/admin" className="card-inalde-interactive flex flex-col gap-3">
                  <div className="text-3xl">⚙️</div>
                  <h2 className="font-primary font-bold text-lg">Administración</h2>
                  <p className="text-inalde-gray text-sm">Cohortes, participantes, profesores, sábana, solicitudes y auditoría.</p>
                  <span className="text-sm font-semibold text-inalde-red">Entrar →</span>
                </Link>
              )}
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
