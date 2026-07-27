import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Selector visual de RANGO de fechas (estilo reserva de vuelos/hoteles): dos
 * meses a la vista, se hace clic en el día de inicio y luego en el de fin, con
 * el rango resaltado. Reemplaza los dos <input type="date"> nativos, que además
 * abrían el calendario en el año equivocado cuando el campo estaba vacío.
 *
 * Trabaja siempre con cadenas 'YYYY-MM-DD' (nunca con Date) para no arrastrar
 * corrimientos de zona horaria: el día que se ve es el día que se guarda.
 */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function iso(y: number, m: number, d: number) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function diasDelMes(y: number, m: number) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
/** Día de la semana con lunes = 0. */
function primerDiaSemana(y: number, m: number) { return (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; }
function sumaMes(y: number, m: number, delta: number) {
  const t = y * 12 + m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}
function bonito(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const [y, m, d] = v.split('-');
  return `${d}/${m}/${y}`;
}

interface Props {
  inicio: string;
  fin: string;
  onChange: (inicio: string, fin: string) => void;
  /** Mes que se muestra al abrir cuando no hay ninguna fecha elegida ('YYYY-MM-DD'). */
  anclaPorDefecto?: string;
  disabled?: boolean;
  /** Texto de error a mostrar debajo (cronología inválida, etc.). */
  error?: string | null;
  idBase: string;
}

export function RangoFechas({ inicio, fin, onChange, anclaPorDefecto, disabled, error, idBase }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const cajaRef = useRef<HTMLDivElement>(null);

  // Mes de arranque: la fecha ya elegida, si no el ancla del contexto (fecha de
  // la cohorte / hito anterior) y, como último recurso, enero del año del
  // programa. Nunca "hoy": el cronograma es del año siguiente.
  const ancla = useMemo(() => {
    const base = inicio || fin || anclaPorDefecto || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(base)) {
      const [y, m] = base.split('-').map(Number);
      return { y, m: m - 1 };
    }
    return { y: new Date().getUTCFullYear() + 1, m: 0 };
  }, [inicio, fin, anclaPorDefecto]);

  const [vista, setVista] = useState(ancla);
  useEffect(() => { if (abierto) setVista(ancla); }, [abierto, ancla]);

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!abierto) return;
    function fuera(e: MouseEvent) {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierto(false);
    }
    function tecla(e: KeyboardEvent) { if (e.key === 'Escape') setAbierto(false); }
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  function elegir(dia: string) {
    // Primer clic (o rango ya completo) → nuevo inicio. Segundo clic → fin.
    if (!inicio || (inicio && fin)) { onChange(dia, ''); setHover(null); return; }
    if (dia < inicio) { onChange(dia, ''); return; }
    onChange(inicio, dia);
    setAbierto(false);
  }

  function Mes({ y, m }: { y: number; m: number }) {
    const total = diasDelMes(y, m);
    const offset = primerDiaSemana(y, m);
    const celdas: Array<number | null> = [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: total }, (_, i) => i + 1),
    ];
    const finPreview = fin || (inicio && hover && hover > inicio ? hover : '');
    return (
      <div className="w-[248px]">
        <p className="text-center font-primary font-bold text-sm text-inalde-text mb-2">
          {MESES[m]} de {y}
        </p>
        <div className="grid grid-cols-7 gap-y-1">
          {DIAS.map((d, i) => (
            <span key={`${d}-${i}`} className="text-[10px] uppercase text-inalde-gray text-center">{d}</span>
          ))}
          {celdas.map((d, i) => {
            if (d === null) return <span key={`v-${i}`} />;
            const val = iso(y, m, d);
            const esInicio = !!inicio && val === inicio;
            const esFin = !!fin && val === fin;
            const dentro = !!inicio && !!finPreview && val > inicio && val < finPreview;
            return (
              <button
                key={val}
                type="button"
                onClick={() => elegir(val)}
                onMouseEnter={() => setHover(val)}
                className={`h-8 text-xs rounded transition
                  ${esInicio || esFin
                    ? 'bg-inalde-red text-white font-bold'
                    : dentro
                      ? 'bg-inalde-red/10 text-inalde-text'
                      : 'hover:bg-inalde-gray-bg text-inalde-text'}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const segundo = sumaMes(vista.y, vista.m, 1);
  const resumen = inicio || fin
    ? `${bonito(inicio) || 'dd/mm/aaaa'} → ${bonito(fin) || 'dd/mm/aaaa'}`
    : 'Elegir fechas';

  return (
    <div className="relative" ref={cajaRef}>
      <button
        type="button"
        id={idBase}
        disabled={disabled}
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${idBase}-err` : undefined}
        className={`input-inalde text-left flex items-center justify-between gap-2 disabled:opacity-60 disabled:cursor-not-allowed
          ${error ? '!border-inalde-red' : ''} ${!inicio && !fin ? 'text-inalde-gray' : ''}`}
      >
        <span className="truncate">{resumen}</span>
        <span aria-hidden="true" className="text-inalde-gray">📅</span>
      </button>

      {abierto && !disabled && (
        <div
          role="dialog"
          aria-label="Selecciona el rango de fechas del hito"
          className="absolute z-40 mt-2 bg-white rounded-lg shadow-xl border border-inalde-gray-light p-4 left-0"
          onMouseLeave={() => setHover(null)}
        >
          <div className="flex items-center justify-between mb-3">
            <button type="button" aria-label="Mes anterior"
              onClick={() => setVista(sumaMes(vista.y, vista.m, -1))}
              className="w-8 h-8 rounded hover:bg-inalde-gray-bg text-inalde-text">←</button>
            <p className="text-[11px] uppercase tracking-wider text-inalde-gray">
              {!inicio || fin ? 'Elige la fecha de inicio' : 'Ahora elige la fecha de fin'}
            </p>
            <button type="button" aria-label="Mes siguiente"
              onClick={() => setVista(sumaMes(vista.y, vista.m, 1))}
              className="w-8 h-8 rounded hover:bg-inalde-gray-bg text-inalde-text">→</button>
          </div>

          <div className="flex gap-5">
            <Mes y={vista.y} m={vista.m} />
            <div className="hidden sm:block"><Mes y={segundo.y} m={segundo.m} /></div>
          </div>

          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-inalde-gray-light">
            <button type="button" onClick={() => { onChange('', ''); setHover(null); }}
              className="text-xs text-inalde-gray hover:text-inalde-red">Limpiar</button>
            <button type="button" onClick={() => setAbierto(false)}
              className="text-xs font-semibold text-inalde-red hover:underline">Listo</button>
          </div>
        </div>
      )}

      {error && <p id={`${idBase}-err`} className="text-[11px] text-inalde-red mt-1">{error}</p>}
    </div>
  );
}
