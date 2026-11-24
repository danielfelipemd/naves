import { Link, Outlet, useLocation } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';

const sectionLabels: Record<string, string> = {
  cohortes: 'Cohortes',
  participantes: 'Participantes',
  profesores: 'Profesores',
  directores: 'Directores',
  anteproyectos: 'Anteproyectos',
  equipos: 'Equipos',
  panelistas: 'Panelistas',
  programacion: 'Programación',
  'proyectos-db': 'Trabajos de grado definitivos',
  'trabajos-sector': 'Trabajos por sector',
  sectores: 'Sectores',
  'dashboard-control': 'Dashboard de control',
  aol: 'AoL — Assurance of Learning',
  actas: 'Actas de grado',
  solicitudes: 'Solicitudes de desarchivado',
  'roles-permisos': 'Roles y permisos',
};

// Todas las pantallas usan el ancho de la ventana donde se abra el sistema
// (celular, portátil o monitor grande), con el mismo margen lateral que el
// encabezado. Antes unas iban en 1100 px y otras en 1800 (Daniel, 24/11/2026).

export default function AdminLayout() {
  const { pathname } = useLocation();
  // /admin/<seccion>(/sub)
  const [seg = ''] = pathname.replace(/^\/admin\/?/, '').split('/');
  const isHome = !seg;
  const sectionLabel = sectionLabels[seg];

  return (
    <>
      <Header />
      <main className="pt-32 pb-16 px-4 sm:px-8">
        <div className="w-full">
          <nav className="mb-6 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to="/" className="text-inalde-gray hover:text-inalde-red font-primary font-semibold tracking-wider uppercase text-xs">
              ← Menú principal
            </Link>
            {!isHome && (
              <>
                <span className="text-inalde-gray">/</span>
                <Link to="/admin" className="text-inalde-gray hover:text-inalde-red font-primary font-semibold tracking-wider uppercase text-xs">
                  Panel administrativo
                </Link>
              </>
            )}
            {sectionLabel && (
              <>
                <span className="text-inalde-gray">/</span>
                <span className="text-inalde-text font-primary font-semibold tracking-wider uppercase text-xs">{sectionLabel}</span>
              </>
            )}
          </nav>
          <section className="bg-white rounded-lg shadow-inalde-card p-4 sm:p-8 min-h-[400px]">
            <Outlet />
          </section>
        </div>
      </main>
    </>
  );
}
