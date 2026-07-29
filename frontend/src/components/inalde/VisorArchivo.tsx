import { useEffect } from 'react';

/**
 * Visor de archivos en ventana emergente.
 *
 * Muestra el archivo (logo, one pager, PDF…) encima de la pantalla actual, sin
 * navegar ni abrir otra pestaña: al cerrar, el usuario queda exactamente donde
 * estaba, con su scroll y sus filtros intactos.
 *
 * La URL que llega es la del proxy (`/api/archivos/stream?t=…`), que por
 * defecto fuerza la descarga. Para poder verlo incrustado se le agrega `&v=1`,
 * que hace que el backend lo sirva `inline`. El botón "Descargar" usa la URL
 * original, así que sigue disparando el diálogo de guardar.
 */
export function VisorArchivo({ url, titulo, onClose }: {
  url: string;
  titulo: string;
  onClose: () => void;
}) {
  // Cerrar con Escape y bloquear el scroll del fondo mientras está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflowPrevio;
    };
  }, [onClose]);

  const urlVer = `${url}${url.includes('?') ? '&' : '?'}v=1`;
  // El token del proxy lleva el mime en su payload. Leerlo evita mandar las
  // imágenes al visor de documentos del navegador, que las muestra crudas.
  const esImagen = (() => {
    try {
      const t = new URL(url, window.location.origin).searchParams.get('t') ?? '';
      const payload = JSON.parse(atob(t.split('.')[1]));
      return String(payload?.m ?? '').startsWith('image/');
    } catch { return false; }
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog" aria-modal="true" aria-label={titulo}
      onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="border-b-[3px] border-inalde-red px-5 py-3 flex items-center justify-between gap-4">
          <h2 className="font-primary font-bold text-base text-inalde-text truncate">{titulo}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <a href={url} download
              className="font-primary font-bold text-[0.65rem] tracking-wider uppercase border border-inalde-red text-inalde-red px-3 py-1.5 rounded-[3px] hover:bg-inalde-red hover:text-white transition-colors">
              <span aria-hidden="true">⬇ </span>Descargar
            </a>
            <button onClick={onClose} aria-label="Cerrar"
              className="font-primary font-bold text-[0.65rem] tracking-wider uppercase border border-inalde-gray-light text-inalde-gray px-3 py-1.5 rounded-[3px] hover:border-inalde-text hover:text-inalde-text transition-colors">
              ✕ Cerrar
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-[60vh] bg-inalde-gray-bg overflow-auto flex items-center justify-center">
          {esImagen ? (
            <img src={urlVer} alt={titulo} className="max-w-full max-h-[80vh] object-contain" />
          ) : (
            <iframe src={urlVer} title={titulo} className="w-full h-full min-h-[60vh] border-0 bg-white" />
          )}
        </div>

        <p className="px-5 py-2 text-[11px] text-inalde-gray border-t border-inalde-gray-light">
          Si el archivo no se ve aquí, usa <strong>Descargar</strong>. Al cerrar vuelves a la misma pantalla.
        </p>
      </div>
    </div>
  );
}
