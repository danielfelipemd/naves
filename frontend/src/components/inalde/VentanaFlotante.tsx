import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as PointerEventReact, type ReactNode } from 'react';

/**
 * Panel que puede ir anclado en la página o salir a una ventana flotante.
 *
 * Anclado se ve como una tarjeta más, en su sitio. Flotante queda fijo en la
 * pantalla, se arrastra por su barra de título y NO es modal: no oscurece el
 * fondo ni bloquea nada, así que se puede cambiar una opción y ver al mismo
 * tiempo cómo cambia la tabla de abajo. Se puede minimizar a la barra.
 *
 * Lo que eligió la persona (anclado o flotante, posición, minimizado) se
 * recuerda en este navegador. Es solo una comodidad: si el almacenamiento
 * falla, el panel arranca anclado y funciona igual.
 *
 * Capas: z-40, por debajo de la cabecera y de <Modal> (z-50) y de los diálogos
 * del sistema (z-[60]). Un aviso o un visor de archivo siempre queda encima.
 *
 * `children` recibe si está flotando, por si el contenido quiere cambiar algo
 * en ese modo (p. ej. mostrar dentro un mensaje que arriba no se vería).
 */
const ANCHO = 460;
const MARGEN = 8;
const ALTO_BARRA = 44;

interface Estado { flotante: boolean; x: number; y: number; minimizado: boolean; }

function leer(clave: string): Partial<Estado> {
  try {
    const crudo = window.localStorage.getItem(clave);
    if (!crudo) return {};
    const v = JSON.parse(crudo);
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function guardar(clave: string, e: Estado) {
  try { window.localStorage.setItem(clave, JSON.stringify(e)); } catch { /* sin almacenamiento: no se recuerda, nada más */ }
}

// La cabecera es fija y mide distinto según el ancho; Header publica su alto en
// --alto-cabecera. La ventana no puede subir más allá, o quedaría tapada.
function altoCabecera(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--alto-cabecera'));
  return Number.isFinite(v) ? v : 0;
}

function anchoVentana(): number {
  return Math.min(ANCHO, window.innerWidth - MARGEN * 2);
}

// Mantiene la ventana dentro de la pantalla: al arrastrar y al achicar el navegador.
function encajar(x: number, y: number): { x: number; y: number } {
  const maxX = window.innerWidth - anchoVentana() - MARGEN;
  const minY = altoCabecera() + MARGEN;
  const maxY = window.innerHeight - ALTO_BARRA - MARGEN;
  return {
    x: Math.round(Math.max(MARGEN, Math.min(x, maxX))),
    y: Math.round(Math.max(minY, Math.min(y, Math.max(minY, maxY)))),
  };
}

export function VentanaFlotante({ titulo, clave, children }: {
  titulo: string;
  /** Clave de localStorage donde se recuerda el modo y la posición. */
  clave: string;
  children: (flotante: boolean) => ReactNode;
}) {
  const idTitulo = useId();
  const [estado, setEstado] = useState<Estado>(() => {
    const g = leer(clave);
    // Sin posición guardada: arriba a la derecha, bajo la cabecera. Se encaja
    // ya aquí: un `left: Infinity` en el primer render es un estilo inválido.
    const inicial = encajar(Number.POSITIVE_INFINITY, 0);
    return {
      flotante: g.flotante === true,
      x: typeof g.x === 'number' && Number.isFinite(g.x) ? g.x : inicial.x,
      y: typeof g.y === 'number' && Number.isFinite(g.y) ? g.y : inicial.y,
      minimizado: g.minimizado === true,
    };
  });
  const arrastre = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => { guardar(clave, estado); }, [clave, estado]);

  // Al flotar (y al montar ya flotando) se encaja: la posición guardada puede
  // venir de una pantalla más grande, y la inicial es «lo más a la derecha».
  // Layout y no effect: así no se pinta un cuadro con la posición sin encajar.
  useLayoutEffect(() => {
    if (!estado.flotante) return;
    const reencajar = () => setEstado((e) => ({ ...e, ...encajar(e.x, e.y) }));
    reencajar();
    window.addEventListener('resize', reencajar);
    return () => window.removeEventListener('resize', reencajar);
  }, [estado.flotante]);

  const cambiar = useCallback((cambios: Partial<Estado>) => setEstado((e) => ({ ...e, ...cambios })), []);

  function empezarArrastre(ev: PointerEventReact<HTMLDivElement>) {
    // Los botones de la barra no arrastran: se pulsan.
    if ((ev.target as HTMLElement).closest('button')) return;
    if (ev.button !== 0) return;
    arrastre.current = { dx: ev.clientX - estado.x, dy: ev.clientY - estado.y };
    ev.currentTarget.setPointerCapture(ev.pointerId);
    ev.preventDefault(); // que no seleccione texto mientras se arrastra
  }
  function moverArrastre(ev: PointerEventReact<HTMLDivElement>) {
    const a = arrastre.current;
    if (!a) return;
    cambiar(encajar(ev.clientX - a.dx, ev.clientY - a.dy));
  }
  function soltarArrastre(ev: PointerEventReact<HTMLDivElement>) {
    if (!arrastre.current) return;
    arrastre.current = null;
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId);
  }

  const botonBarra = 'font-primary font-bold text-[0.65rem] tracking-wider uppercase border px-2.5 py-1 rounded-[3px] transition-colors whitespace-nowrap';

  if (!estado.flotante) {
    return (
      <section aria-labelledby={idTitulo} className="bg-white border border-inalde-gray-light rounded-lg mb-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-inalde-gray-light">
          <h2 id={idTitulo} className="font-primary font-bold text-xs tracking-widest uppercase text-inalde-text">{titulo}</h2>
          <button type="button" onClick={() => cambiar({ flotante: true, minimizado: false })}
            title="Saca las opciones a una ventana que puedes mover por la pantalla, para ver la tabla mientras las cambias"
            className={`${botonBarra} border-inalde-gray-light text-inalde-gray hover:border-inalde-blue hover:text-inalde-blue`}>
            <span aria-hidden="true">⧉ </span>Ventana flotante
          </button>
        </div>
        <div className="p-4">{children(false)}</div>
      </section>
    );
  }

  return (
    <>
      {/* En su sitio queda una marca: así se sabe dónde fueron las opciones y
          se pueden volver a anclar sin buscar la ventana. */}
      <div className="flex flex-wrap items-center gap-3 border border-dashed border-inalde-gray-light rounded-lg px-4 py-2.5 mb-5 text-sm text-inalde-gray">
        <span><span aria-hidden="true">⧉ </span><strong className="text-inalde-text">{titulo}</strong> en ventana flotante.</span>
        <button type="button" onClick={() => cambiar({ flotante: false })}
          className={`${botonBarra} border-inalde-gray-light text-inalde-gray hover:border-inalde-blue hover:text-inalde-blue`}>
          Anclar aquí
        </button>
      </div>

      <section role="dialog" aria-modal="false" aria-labelledby={idTitulo}
        className="fixed z-40 bg-white border border-inalde-gray-light rounded-lg shadow-xl flex flex-col"
        style={{
          left: estado.x, top: estado.y, width: `min(${ANCHO}px, calc(100vw - ${MARGEN * 2}px))`,
          maxHeight: `calc(100vh - ${estado.y}px - ${MARGEN}px)`,
        }}>
        <div
          onPointerDown={empezarArrastre} onPointerMove={moverArrastre}
          onPointerUp={soltarArrastre} onPointerCancel={soltarArrastre}
          title="Arrastra para moverla"
          className={`flex items-center gap-2 px-3 py-2 bg-inalde-text text-white cursor-move select-none touch-none ${estado.minimizado ? 'rounded-lg' : 'rounded-t-lg'}`}>
          <span aria-hidden="true" className="text-white/50 tracking-tighter">⋮⋮</span>
          <h2 id={idTitulo} className="flex-1 min-w-0 truncate font-primary font-bold text-xs tracking-wider uppercase" title={titulo}>{titulo}</h2>
          <button type="button" onClick={() => cambiar({ minimizado: !estado.minimizado })}
            aria-expanded={!estado.minimizado}
            title={estado.minimizado ? 'Mostrar las opciones' : 'Dejar solo la barra'}
            className={`${botonBarra} border-white/30 text-white hover:bg-white hover:text-inalde-text`}>
            {estado.minimizado ? 'Abrir' : 'Minimizar'}
          </button>
          <button type="button" onClick={() => cambiar({ flotante: false })}
            title="Vuelve a poner las opciones en su sitio, encima de las jornadas"
            className={`${botonBarra} border-white/30 text-white hover:bg-white hover:text-inalde-text`}>
            Anclar
          </button>
        </div>
        {!estado.minimizado && <div className="p-4 overflow-y-auto overscroll-contain">{children(true)}</div>}
      </section>
    </>
  );
}
