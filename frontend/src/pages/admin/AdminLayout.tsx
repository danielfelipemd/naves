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

// Pantallas cuyo contenido es una tabla ancha. Con la caja fija en 1100 px la
// tabla de Programación (1280 px) nunca cabía, ni en un monitor de 1920: se
// medía 248 px escondidos a la derecha y el 40 % de la pantalla en márgenes
// vacíos. Estas usan el ancho de la ventana, hasta 1800 px. Las demás van en
// 1400, alineadas con el encabezado (Daniel, 24/11/2026; antes 1100).
const seccionesAnchas = new Set(['programacion', 'anteproyectos', 'participantes']);

export default function AdminLayout() {
  const { pathname } = useLocation();
  // /admin/<seccion>(/sub)
  const [seg = '', sub] = pathname.replace(/^\/admin\/?/, '').split('/');
  const isHome = !seg;
  const sectionLabel = sectionLabels[seg];
  // Solo la lista: el detalle (/admin/anteproyectos/:id) es un documento y
  // conserva el ancho de lectura.
  const ancha = seccionesAnchas.has(seg) && !sub;

  return (
    <>
      <Header />
      <main className="pt-32 pb-16 px-4">
        <div className={`${ancha ? 'max-w-[1800px]' : 'max-w-[1400px]'} mx-auto`}>
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
