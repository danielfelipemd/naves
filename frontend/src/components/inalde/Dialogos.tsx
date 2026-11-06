import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Avisos, confirmaciones y preguntas del sistema, con la identidad de INALDE.
 *
 * Sustituyen a `alert`, `confirm` y `prompt` del navegador: esos cuadros salen
 * con el estilo del sistema operativo, el título lo pone el navegador («La
 * página naves-inalde.com dice…») y no se pueden maquetar. Decisión del dueño
 * (06/11/2026): todos los avisos tienen que ser del propio sistema.
 *
 * Se usan como las funciones del navegador, pero con `await`:
 *
 *   if (!(await confirmar('¿Borrar este panelista?'))) return;
 *   await avisar('Solicitud enviada.');
 *   const motivo = await pedirTexto({ mensaje: '¿Por qué se anula?' });   // null = canceló
 *
 * Son funciones de módulo y no un hook a propósito: así sirven también fuera de
 * un componente (por ejemplo, el bloqueo de pegar texto del anteproyecto).
 * Las pinta <Dialogos />, que se monta UNA vez en App.tsx.
 *
 * Lo único que no se puede sustituir es el aviso al cerrar o recargar la
 * pestaña a mitad de una subida (`beforeunload`): ese lo dibuja el navegador y
 * ninguno permite cambiarlo.
 */

type Tono = 'normal' | 'peligro';

interface Base {
  titulo?: string;
  /** Texto o contenido. Los saltos de línea de un texto se respetan. */
  mensaje: ReactNode;
  /**
   * 'peligro' deja el foco en «Cancelar»: en una acción irreversible, un Enter
   * por inercia no debe confirmarla.
   */
  tono?: Tono;
}

export interface OpcionesConfirmar extends Base {
  aceptar?: string;
  cancelar?: string;
}

export interface OpcionesAvisar extends Base {
  aceptar?: string;
}

export interface OpcionesPedirTexto extends Base {
  etiqueta?: string;
  placeholder?: string;
  aceptar?: string;
  cancelar?: string;
  tipo?: 'text' | 'email';
  multilinea?: boolean;
  /** Longitud mínima del texto (sin espacios a los lados). */
  minimo?: number;
  /** El texto tiene que ser exactamente este (confirmaciones fuertes). */
  exacto?: string;
}

type Pedido =
  | { id: number; clase: 'confirmar'; o: OpcionesConfirmar; resolver: (v: boolean) => void }
  | { id: number; clase: 'avisar'; o: OpcionesAvisar; resolver: (v: undefined) => void }
  | { id: number; clase: 'pedirTexto'; o: OpcionesPedirTexto; resolver: (v: string | null) => void };

// Omit repartido sobre cada variante de la unión (un Omit directo la aplana).
type SinId<T> = T extends unknown ? Omit<T, 'id'> : never;
type PedidoNuevo = SinId<Pedido>;

/** Lo registra <Dialogos /> al montarse. */
let mostrar: ((p: PedidoNuevo) => void) | null = null;

function normalizar<T extends Base>(o: string | T): T {
  return typeof o === 'string' ? ({ mensaje: o } as T) : o;
}

/**
 * Si <Dialogos /> no está montado, el diálogo nunca aparecería y la promesa no
 * se resolvería jamás: el botón que lo pidió quedaría muerto sin ningún error.
 * Antes que eso, se recurre al cuadro del navegador y se deja el fallo en la
 * consola, para que se note y se corrija.
 */
function sinAnfitrion(o: Base): string {
  console.error('[Dialogos] <Dialogos /> no está montado; se usa el cuadro del navegador.');
  return [o.titulo, typeof o.mensaje === 'string' ? o.mensaje : ''].filter(Boolean).join('\n\n');
}

export function confirmar(opciones: string | OpcionesConfirmar): Promise<boolean> {
  const o = normalizar(opciones);
  return new Promise((resolver) => {
    if (!mostrar) { resolver(window.confirm(sinAnfitrion(o))); return; }
    mostrar({ clase: 'confirmar', o, resolver });
  });
}

export function avisar(opciones: string | OpcionesAvisar): Promise<void> {
  const o = normalizar(opciones);
  return new Promise((resolver) => {
    if (!mostrar) { window.alert(sinAnfitrion(o)); resolver(); return; }
    mostrar({ clase: 'avisar', o, resolver: () => resolver() });
  });
}

/** Devuelve el texto escrito (sin espacios a los lados) o null si se canceló. */
export function pedirTexto(opciones: OpcionesPedirTexto): Promise<string | null> {
  return new Promise((resolver) => {
    if (!mostrar) {
      const v = window.prompt(sinAnfitrion(opciones));
      resolver(v === null ? null : v.trim());
      return;
    }
    mostrar({ clase: 'pedirTexto', o: opciones, resolver });
  });
}

/**
 * Entrega la respuesta a quien pidió el diálogo. Cancelar vale `false` en una
 * confirmación y `null` en una pregunta; un aviso no tiene respuesta.
 */
function responder(p: Pedido, aceptado: boolean, texto = '') {
  if (p.clase === 'confirmar') p.resolver(aceptado);
  else if (p.clase === 'pedirTexto') p.resolver(aceptado ? texto : null);
  else p.resolver(undefined);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Dialogos() {
  // La cola vive en una ref (es la fuente de verdad) y el estado solo fuerza el
  // repintado: así encolar no depende de un actualizador de estado, que en
  // StrictMode se ejecuta dos veces.
  const cola = useRef<Pedido[]>([]);
  const siguienteId = useRef(1);
  const [, repintar] = useState(0);

  useEffect(() => {
    mostrar = (nuevo) => {
      // Un doble clic en «Borrar» o pegar texto tres veces seguidas no debe
      // apilar tres diálogos iguales: el repetido se descarta como cancelado.
      const repetido = typeof nuevo.o.mensaje === 'string' && cola.current.some(
        (p) => p.clase === nuevo.clase && p.o.mensaje === nuevo.o.mensaje,
      );
      const pedido = { ...nuevo, id: siguienteId.current++ } as Pedido;
      if (repetido) { responder(pedido, false); return; }
      cola.current.push(pedido);
      repintar((n) => n + 1);
    };
    return () => { mostrar = null; };
  }, []);

  const actual = cola.current[0];
  if (!actual) return null;

  function cerrar(aceptado: boolean, texto?: string) {
    const p = cola.current.shift();
    repintar((n) => n + 1);
    if (p) responder(p, aceptado, texto);
  }

  // key: cada pedido monta su propio diálogo, con el campo de texto vacío.
  return <Dialogo key={actual.id} pedido={actual} onCerrar={cerrar} />;
}

const TITULOS: Record<Pedido['clase'], string> = {
  confirmar: '¿Confirmas?',
  avisar: 'Aviso',
  pedirTexto: 'Falta un dato',
};

function Dialogo({ pedido, onCerrar }: {
  pedido: Pedido;
  onCerrar: (aceptado: boolean, texto?: string) => void;
}) {
  const { o } = pedido;
  const pt = pedido.clase === 'pedirTexto' ? pedido.o : null;
  const [texto, setTexto] = useState('');
  const tituloId = useId();
  const mensajeId = useId();
  const campoId = useId();
  const cajaRef = useRef<HTMLDivElement>(null);
  const aceptarRef = useRef<HTMLButtonElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const campoRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const limpio = texto.trim();
  let habilitado = true;
  if (pt) {
    if (pt.exacto !== undefined) habilitado = limpio === pt.exacto;
    else if (pt.minimo !== undefined) habilitado = limpio.length >= pt.minimo;
    else habilitado = limpio.length > 0;
    if (habilitado && pt.tipo === 'email') habilitado = EMAIL_RE.test(limpio);
  }

  const cancelar = () => onCerrar(false);
  const aceptar = () => { if (habilitado) onCerrar(true, limpio); };

  // Foco al abrir y devolución del foco al cerrar, como hace el navegador.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    if (pedido.clase === 'pedirTexto') campoRef.current?.focus();
    else if (o.tono === 'peligro' && pedido.clase === 'confirmar') cancelarRef.current?.focus();
    else aceptarRef.current?.focus();
    return () => { previo?.focus?.(); };
    // Solo al montar: cada pedido monta su propio diálogo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape y Tab se atienden en la fase de CAPTURA de window y no siguen: si el
  // diálogo sale sobre un <Modal> abierto, el Escape del Modal (escucha en
  // document) cerraría también el modal de debajo.
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        cancelar();
        return;
      }
      if (e.key === 'Tab' && cajaRef.current) {
        // El foco no sale del diálogo mientras está abierto.
        const enfocables = Array.from(cajaRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, textarea',
        ));
        if (!enfocables.length) return;
        const primero = enfocables[0];
        const ultimo = enfocables[enfocables.length - 1];
        const dentro = cajaRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === primero || !dentro)) {
          e.preventDefault(); ultimo.focus();
        } else if (!e.shiftKey && (document.activeElement === ultimo || !dentro)) {
          e.preventDefault(); primero.focus();
        }
      }
    }
    window.addEventListener('keydown', alTeclear, true);
    return () => window.removeEventListener('keydown', alTeclear, true);
  });

  const titulo = o.titulo ?? TITULOS[pedido.clase];
  const esAviso = pedido.clase === 'avisar';
  const textoAceptar = pedido.o.aceptar ?? (esAviso ? 'Entendido' : 'Aceptar');
  const textoCancelar = (esAviso ? undefined : pedido.o.cancelar) ?? 'Cancelar';

  return (
    // z-[60]: por encima de la cabecera y de cualquier <Modal> (los dos usan z-50).
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center overflow-y-auto py-10 px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancelar(); }}
    >
      <div
        ref={cajaRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={mensajeId}
        className="bg-white rounded-lg shadow-xl w-full max-w-md animate-in fade-in zoom-in-95"
      >
        <form onSubmit={(e) => { e.preventDefault(); aceptar(); }}>
          <header className="px-6 pt-6 pb-4 border-b-[3px] border-inalde-red">
            <h2 id={tituloId} className="font-primary font-bold text-xl text-inalde-text">{titulo}</h2>
          </header>

          <div className="px-6 py-5">
            <div id={mensajeId} className="text-sm text-inalde-text whitespace-pre-line">{o.mensaje}</div>

            {pt && (
              <div className="mt-4">
                {pt.etiqueta && (
                  <label htmlFor={campoId} className="block text-xs font-semibold text-inalde-gray mb-1">
                    {pt.etiqueta}
                  </label>
                )}
                {pt.multilinea ? (
                  <textarea
                    id={campoId} ref={campoRef} rows={4} value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder={pt.placeholder} className="input-inalde resize-none"
                  />
                ) : (
                  <input
                    id={campoId} ref={campoRef} value={texto}
                    type={pt.tipo === 'email' ? 'email' : 'text'}
                    autoComplete={pt.tipo === 'email' ? 'email' : 'off'}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder={pt.placeholder} className="input-inalde"
                  />
                )}
                {pt.minimo !== undefined && (
                  <p className={`text-xs mt-1 ${limpio.length >= pt.minimo ? 'text-inalde-gray' : 'text-inalde-red'}`}>
                    {limpio.length} de {pt.minimo} caracteres como mínimo
                  </p>
                )}
              </div>
            )}
          </div>

          <footer className="px-6 py-4 border-t border-inalde-gray-light flex justify-end items-center gap-2 bg-inalde-gray-bg/50 rounded-b-lg">
            {!esAviso && (
              <button
                type="button" ref={cancelarRef} onClick={cancelar}
                className="text-sm text-inalde-gray hover:text-inalde-text px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-inalde-gray/30"
              >
                {textoCancelar}
              </button>
            )}
            <button type="submit" ref={aceptarRef} disabled={!habilitado} className="btn-inalde-primary !py-2 !px-4 !text-xs">
              {textoAceptar}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
