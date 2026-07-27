import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';

// Decisor de Anteproyecto: herramienta autónoma (matriz de decisión
// multicriterio). Vive como archivo estático en /public y se embebe en un
// <iframe> para reproducirla TAL CUAL (la fuente de verdad es el HTML). No
// guarda nada ni toca la BD: solo, al terminar, avisa por postMessage el nombre
// del anteproyecto ganador para arrancar el formulario de registro.
const DECISOR_URL = '/decisor-anteproyecto.html';

export default function Decisor() {
  const navigate = useNavigate();
  // Antes de embeber el iframe comprobamos que la herramienta responda. Si no,
  // el navegador pintaba su propio error crudo ("rechazó la conexión") dentro
  // del marco y el participante quedaba sin ninguna salida.
  const [estado, setEstado] = useState<'verificando' | 'ok' | 'error'>('verificando');

  const verificar = useCallback(async () => {
    setEstado('verificando');
    try {
      const r = await fetch(DECISOR_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const html = await r.text();
      // El SPA responde index.html a rutas desconocidas: si lo que llega no es
      // la herramienta, tratarlo como no disponible en vez de embeber la app.
      if (!/decisor/i.test(html)) throw new Error('CONTENIDO_INESPERADO');
      setEstado('ok');
    } catch {
      setEstado('error');
    }
  }, []);

  useEffect(() => { verificar(); }, [verificar]);

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

        {estado === 'verificando' && (
          <div className="max-w-[1100px] mx-auto px-4 py-16 text-center text-inalde-gray">
            Abriendo la herramienta de apoyo…
          </div>
        )}

        {estado === 'error' && (
          <div className="max-w-[720px] mx-auto px-4 py-10">
            <div className="bg-white rounded-lg shadow-inalde-card p-6 sm:p-8">
              <div className="border-b-[3px] border-inalde-red pb-4 mb-5">
                <p className="section-subtitle mb-2">Herramienta de apoyo</p>
                <h1 className="section-title">No pudimos abrir la herramienta</h1>
              </div>
              <p className="text-inalde-text leading-relaxed mb-3">
                La herramienta de apoyo no está respondiendo en este momento. No perdiste nada:
                esta herramienta no guarda información, solo te ayuda a comparar tus ideas.
              </p>
              <p className="text-inalde-gray text-sm leading-relaxed mb-6">
                Puedes intentarlo de nuevo en unos minutos o continuar directamente con el
                registro de tu anteproyecto. Si el problema persiste, avisa a la coordinación
                del programa.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={verificar} className="btn-inalde-primary">Reintentar</button>
                <button
                  onClick={() => navigate('/anteproyecto')}
                  className="px-5 py-3 rounded font-primary font-semibold text-xs uppercase tracking-wider border-2 border-inalde-gray text-inalde-gray hover:border-inalde-text hover:text-inalde-text transition">
                  Continuar sin la herramienta →
                </button>
              </div>
            </div>
          </div>
        )}

        {estado === 'ok' && (
          <iframe
            src={DECISOR_URL}
            title="Decisor de Anteproyecto"
            className="w-full border-0 bg-white"
            style={{ height: 'calc(100dvh - 190px)' }}
            onError={() => setEstado('error')}
          />
        )}
      </main>
    </>
  );
}
