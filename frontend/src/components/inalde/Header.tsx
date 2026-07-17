import { useLocation, useNavigate } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';

export function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Botón "atrás" global: regla de navegación del sistema. Aparece en toda
  // pantalla salvo las "raíces" sin retroceso: el menú principal (destino de
  // "volver"), el login y la pantalla forzada de cambio de clave inicial (de la
  // que solo se sale cerrando sesión, no retrocediendo).
  const SIN_ATRAS = new Set(['/', '/login', '/cambiar-clave-inicial']);
  const mostrarAtras = !SIN_ATRAS.has(pathname);

  // Volver de forma segura: si hay historial dentro de la app se retrocede; si
  // se entró por un enlace directo (idx 0, sin historial propio) navigate(-1)
  // saldría del sitio, así que se va al menú principal.
  function volver() {
    const idx = (window.history.state && (window.history.state as any).idx) ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  }

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-white border-b border-inalde-gray-light shadow-sm">
      <div className="bg-inalde-black px-4 sm:px-8 py-2">
        <p className="text-right text-white font-primary font-medium text-[10px] sm:text-xs tracking-wider uppercase">
          INALDE Business School
        </p>
      </div>
      <div className="flex items-center max-w-[1400px] mx-auto px-4 sm:px-8 py-3 sm:py-4 bg-white">
        {mostrarAtras && (
          <button
            onClick={volver}
            aria-label="Volver a la pantalla anterior"
            className="mr-3 sm:mr-5 flex items-center gap-1 text-inalde-gray hover:text-inalde-red font-primary font-semibold text-sm shrink-0"
          >
            <span aria-hidden="true" className="text-lg leading-none">←</span>
            <span className="hidden sm:inline tracking-wider uppercase text-xs">Atrás</span>
          </button>
        )}
        <a href="/" className="flex items-center gap-3 sm:gap-6">
          <img
            src="/inalde-logo.jpg"
            alt="INALDE Business School"
            className="h-10 sm:h-14 w-auto"
          />
          <div className="w-px h-9 sm:h-11 bg-inalde-gray-light" />
          <div className="text-center">
            <p className="font-primary font-semibold text-[10px] sm:text-[0.7rem] tracking-widest uppercase text-inalde-gray mb-0.5">
              Trabajo de grado
            </p>
            <p className="font-primary font-extrabold text-lg sm:text-xl tracking-tight leading-none text-inalde-text">
              MBA
            </p>
          </div>
        </a>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
