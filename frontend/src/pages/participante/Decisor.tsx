import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';

// Decisor de Anteproyecto: herramienta autónoma (matriz de decisión
// multicriterio). Vive como archivo estático en /public y se embebe en un
// <iframe> para reproducirla TAL CUAL (la fuente de verdad es el HTML). No
// guarda nada ni toca la BD: solo, al terminar, avisa por postMessage el nombre
// del anteproyecto ganador para arrancar el formulario de registro.
export default function Decisor() {
  const navigate = useNavigate();

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Solo aceptamos mensajes del propio origen (el iframe se sirve desde
      // /public, mismo origen que la app).
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== 'naves:registrar-anteproyecto') return;
      const nombre = typeof e.data?.nombre === 'string' ? e.data.nombre.trim() : '';
      // Pasamos el nombre elegido como sugerencia de arranque. El formulario lo
      // usa solo si el anteproyecto sigue en borrador y el nombre está vacío.
      navigate('/anteproyecto', { state: { prefillNombre: nombre } });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  return (
    <>
      <Header />
      <main className="pt-[140px] min-h-screen bg-inalde-gray-bg/30">
        <div className="max-w-[1100px] mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={() => navigate('/trabajo-grado')}
            className="text-sm text-inalde-gray hover:text-inalde-text"
          >
            ← Volver a mi trabajo de grado
          </button>
          <p className="text-xs text-inalde-gray">
            Herramienta de apoyo · no guarda nada hasta que registres tu anteproyecto
          </p>
        </div>
        <iframe
          src="/decisor-anteproyecto.html"
          title="Decisor de Anteproyecto"
          className="w-full border-0 bg-white"
          style={{ height: 'calc(100dvh - 190px)' }}
        />
      </main>
    </>
  );
}
