/**
 * Barra de progreso para subidas de archivos.
 *
 * Un archivo grande en una conexión lenta tarda medio minuto, y hasta ahora el
 * usuario solo veía "Cargando…": sin saber si avanzaba, si se había colgado o
 * si podía irse de la pantalla. Varios cerraban la ventana a medio subir.
 *
 * Muestra el porcentaje real que reporta el navegador (bytes enviados), y
 * cuando el archivo ya está en el servidor cambia el mensaje: en esa fase el
 * navegador ya no informa nada, pero el backend sigue trabajando (lo pasa a
 * Supabase Storage) y la barra no debe quedarse congelada en 100 % sin
 * explicación.
 */

interface Props {
  /** 0-100. Bytes enviados por el navegador. */
  porcentaje: number;
  /** Nombre del archivo, para que se vea cuál de varios está subiendo. */
  nombre?: string;
  /** Tamaño en bytes; con él se avisa que no cierre la ventana en los grandes. */
  bytes?: number;
  /** Segundos que faltan para terminar de enviar, según la velocidad medida
   *  (axios lo calcula en cada evento de progreso). null mientras no se sabe. */
  segundosRestantes?: number | null;
}

/** A partir de aquí la subida dura lo suficiente como para que valga el aviso. */
const BYTES_AVISO = 5 * 1024 * 1024;

/** Antes de este porcentaje la velocidad medida todavía no es fiable. */
const PCT_MIN_ESTIMACION = 3;

/**
 * Una subida que dura más de ~60 s la corta el proxy (medido el 04/11/2026:
 * 24 MB a 250 KB/s fallaron a los 64,5 s). Si todavía faltan más de 45 s de
 * envío, más el guardado posterior, es probable que no termine: se avisa
 * mientras hay tiempo de reaccionar.
 */
const SEGUNDOS_SUBIDA_EN_RIESGO = 45;

function formatoTamano(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = (bytes / (1024 * 1024)).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${mb} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Redondea a escalones amplios para que el texto no salte a cada evento. */
function textoTiempoRestante(segundos: number): string {
  if (segundos < 10) return 'Faltan unos segundos.';
  if (segundos < 50) return `Faltan unos ${Math.ceil(segundos / 10) * 10} segundos.`;
  if (segundos < 90) return 'Falta alrededor de un minuto.';
  return `Faltan unos ${Math.round(segundos / 60)} minutos.`;
}

export function BarraProgreso({ porcentaje, nombre, bytes, segundosRestantes }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(porcentaje)));
  // En 100 % el navegador terminó de enviar, pero el backend todavía guarda el
  // archivo. Sin este cambio de texto, la barra parece trabada al final.
  const procesando = pct >= 100;
  const grande = (bytes ?? 0) >= BYTES_AVISO;
  const restante =
    !procesando && pct >= PCT_MIN_ESTIMACION && segundosRestantes != null && Number.isFinite(segundosRestantes)
      ? Math.max(0, segundosRestantes)
      : null;
  const enRiesgo = restante !== null && restante > SEGUNDOS_SUBIDA_EN_RIESGO;
  const aviso = grande
    ? `Archivo de ${formatoTamano(bytes!)}. No cierres esta ventana mientras sube.`
    : 'No cierres esta ventana mientras sube.';

  return (
    <div className="w-full" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-xs text-inalde-text truncate">
          {procesando ? 'Guardando el archivo…' : 'Subiendo'}
          {nombre && !procesando ? <span className="text-inalde-gray"> · {nombre}</span> : null}
        </span>
        <span className="text-xs font-semibold text-inalde-red tabular-nums shrink-0">
          {procesando ? '' : `${pct} %`}
        </span>
      </div>

      <div
        className="h-2 w-full bg-inalde-gray-light rounded overflow-hidden"
        role="progressbar"
        aria-valuenow={procesando ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progreso de la subida"
      >
        {procesando ? (
          // Sin porcentaje que mostrar: una banda en movimiento comunica
          // "sigue trabajando" mejor que una barra llena e inmóvil.
          <div className="h-full w-1/3 bg-inalde-red animate-[barra-indeterminada_1.2s_ease-in-out_infinite]" />
        ) : (
          <div
            className="h-full bg-inalde-red transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      <p className="mt-1 text-[11px] text-inalde-gray">
        {procesando
          ? 'Ya se envió; lo estamos guardando. No cierres esta ventana.'
          : <>
              {restante !== null && <strong className="font-semibold text-inalde-text">{textoTiempoRestante(restante)} </strong>}
              {aviso}
            </>}
      </p>
      {enRiesgo && (
        <p className="mt-1 text-[11px] text-inalde-red">
          La conexión va lenta y la subida podría no completarse. Si falla, reduce el peso del archivo e inténtalo de nuevo.
        </p>
      )}
    </div>
  );
}
