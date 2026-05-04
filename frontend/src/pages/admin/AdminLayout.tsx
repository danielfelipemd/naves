import { Link, NavLink, Outlet } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { useAuth } from '../../auth/store';

const sections = [
  { to: '/admin',                label: 'Resumen',    icon: '📊' },
  { to: '/admin/cohortes',       label: 'Cohortes',   icon: '📅' },
  { to: '/admin/participantes',  label: 'Participantes', icon: '🎓' },
  { to: '/admin/profesores',     label: 'Profesores', icon: '👨‍🏫' },
  { to: '/admin/anteproyectos',  label: 'Anteproyectos', icon: '📋' },
  { to: '/admin/sabana',         label: 'Sábana de proyectos', icon: '📑' },
  { to: '/admin/solicitudes',    label: 'Solicitudes',icon: '📨' },
  { to: '/admin/auditoria',      label: 'Auditoría',  icon: '🔍' },
];

export default function AdminLayout() {
  const { signOut } = useAuth();
  return (
    <>
      <Header />
      <main className="pt-32 pb-16 px-4">
        <div className="max-w-[1280px] mx-auto grid lg:grid-cols-[240px_1fr] gap-8">
          <aside className="lg:sticky lg:top-32 self-start">
            <div className="bg-white rounded-lg shadow-inalde-card p-4">
              <p className="section-subtitle px-2 mb-3">Administración</p>
              <nav className="flex flex-col gap-0.5">
                {sections.map((s) => (
                  <NavLink key={s.to} to={s.to} end={s.to === '/admin'}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 rounded text-sm font-primary font-medium transition ${
                        isActive
                          ? 'bg-inalde-red/10 text-inalde-red'
                          : 'text-inalde-text hover:bg-inalde-gray-bg'
                      }`}
                  >
                    <span>{s.icon}</span>
                    <span>{s.label}</span>
                  </NavLink>
                ))}
              </nav>
              <hr className="my-3 border-inalde-gray-light" />
              <Link to="/" className="block text-xs text-inalde-gray hover:text-inalde-text px-3">
                ← Volver al dashboard
              </Link>
              <button onClick={signOut} className="block text-xs text-inalde-gray hover:text-inalde-red px-3 mt-1">
                Cerrar sesión
              </button>
            </div>
          </aside>
          <section className="bg-white rounded-lg shadow-inalde-card p-8 min-h-[400px]">
            <Outlet />
          </section>
        </div>
      </main>
    </>
  );
}
