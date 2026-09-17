import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

// Mi acta — el participante firma la suya desde su sesión.
//
// A diferencia de profesores y jurados, aquí no hay enlace por correo: ya tiene
// login. Su firma es la PRIMERA de la cadena, así que mientras no la ponga el
// acta no avanza a firmas internas.
//
// La pantalla NO está siempre disponible: se habilita cuando su sustentación ya
// terminó, según el cronograma. Eso lo decide el backend (el acta sigue en
// 'faltan_datos' hasta entonces); aquí solo se explica por qué todavía no.

type Modo = 'trazo' | 'texto' | 'archivo';

interface FirmaCadena { rol: string; nombre: string | null; estado: string }
interface MiActaData {
  existe: boolean;
  acta_id?: number;
  estado?: string;
  modalidad?: string;
  nombre_proyecto?: string | null;
  fecha_sustentacion?: string | null;
  nota?: string | null;
  ya_firme?: boolean;
  firmada_en?: string | null;
  puede_firmar?: boolean;
  motivo?: string | null;
  cadena?: FirmaCadena[];
}

const ROL_LEGIBLE: Record<string, string> = {
  participante: 'Tú',
  profesor: 'Profesor NAVES',
  director_proyecto: 'Director del proyecto',
  jurado: 'Jurado',
  director_mba: 'Director de Cohorte',
};

function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function MiActa() {
  const [data, setData] = useState<MiActaData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [modo, setModo] = useState<Modo>('trazo');
  const [texto, setTexto] = useState('');
  const [imagen, setImagen] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState(false);
  const [leyo, setLeyo] = useState(false);
  // El PDF va protegido por sesión: un <iframe src="/api/..."> no manda el JWT,
  // así que se descarga con axios y se muestra como blob.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [abriendoPdf, setAbriendoPdf] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const hayTrazo = useRef(false);

  async function cargar() {
    setCargando(true);
    try {
      const r = await api.get<MiActaData>('/actas/mi-acta');
      setData(r.data);
      setErrorCarga('');
    } catch (e) {
      setErrorCarga(formatBackendError(e));
    } finally { setCargando(false); }
  }
  useEffect(() => { void cargar(); }, []);

  // Liberar el blob al salir: si no, el navegador lo retiene hasta recargar.
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function verMiActa() {
    if (pdfUrl) {                       // ya está abierto → cerrar
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
      return;
    }
    setAbriendoPdf(true); setError('');
    try {
      // timeout: 0 — generar el PDF puede pasar del tope global de 15 s.
      const r = await api.get('/actas/mi-acta/pdf', { responseType: 'blob', timeout: 0 });
      setPdfUrl(URL.createObjectURL(r.data as Blob));
      setLeyo(true);
    } catch (e) {
      setError('No pudimos abrir tu acta. Inténtalo de nuevo.');
    } finally { setAbriendoPdf(false); }
  }

  // --- Lienzo de trazo ---------------------------------------------------
  function posicion(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    // El lienzo se dibuja a mayor resolución que su tamaño en pantalla: sin
    // escalar, el trazo aparecería desplazado del dedo.
    return { x: (p.clientX - r.left) * (c.width / r.width), y: (p.clientY - r.top) * (c.height / r.height) };
  }
  function empezar(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = posicion(e);
    ctx.beginPath(); ctx.moveTo(x, y);
    dibujando.current = true;
  }
  function mover(e: React.MouseEvent | React.TouchEvent) {
    if (!dibujando.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = posicion(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    hayTrazo.current = true;
  }
  function terminar() { dibujando.current = false; }
  function limpiarTrazo() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    hayTrazo.current = false;
  }

  /** El nombre escrito se convierte en imagen: el acta siempre lleva un trazo. */
  function textoAImagen(t: string): string {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'italic 54px Georgia, serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, 20, 80);
    return c.toDataURL('image/png');
  }

  function archivoAImagen(f: File) {
    if (f.size > 400_000) { setError('La imagen pesa demasiado. Usa una más liviana (máximo 400 KB).'); return; }
    const fr = new FileReader();
    fr.onload = () => setImagen(String(fr.result));
    // Sin onerror, un fallo de lectura dejaba la firma vacía sin decir nada.
    fr.onerror = () => setError('No pudimos leer la imagen. Inténtalo con otro archivo.');
    fr.readAsDataURL(f);
  }

  async function firmar() {
    setError('');
    let img: string | null = null;
    if (modo === 'trazo') {
      if (!hayTrazo.current) { setError('Dibuja tu firma en el recuadro.'); return; }
      img = canvasRef.current!.toDataURL('image/png');
    } else if (modo === 'texto') {
      if (!texto.trim()) { setError('Escribe tu nombre.'); return; }
      img = textoAImagen(texto.trim());
    } else {
      if (!imagen) { setError('Adjunta la imagen de tu firma.'); return; }
      img = imagen;
    }

    if (!confirm('Vas a firmar tu acta de entrega de trabajo de grado. Esta firma tiene validez legal y no se puede deshacer. ¿Continuar?')) return;

    setEnviando(true);
    try {
      await api.post('/actas/mi-acta/firmar', { imagen: img });
      setExito(true);
      await cargar();
    } catch (e: any) {
      const code = e?.response?.data?.error;
      setError(
        code === 'YA_FIRMADA' ? 'Ya habías firmado tu acta.'
        : code === 'AUN_NO' ? 'Tu acta se habilita cuando termine tu sustentación.'
        : code === 'ANULADA' ? 'Esta acta fue anulada. Habla con la coordinación del programa.'
        : code === 'FIRMA_DEMASIADO_GRANDE' ? 'La firma pesa demasiado. Usa una imagen más liviana.'
        // El guardado falló: NO se firmó, así que puede reintentar.
        : code === 'FIRMA_NO_GUARDADA' ? (e?.response?.data?.mensaje ?? 'No pudimos registrar tu firma. Inténtalo de nuevo en unos minutos.')
        : formatBackendError(e),
      );
    } finally { setEnviando(false); }
  }

  const Marco = ({ children }: { children: React.ReactNode }) => (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Trabajo de grado</p>
        <h1 className="section-title">Mi acta</h1>
      </div>
      {children}
    </>
  );

  if (cargando) return <Marco><p className="text-inalde-gray text-sm">Cargando tu acta…</p></Marco>;
  if (errorCarga) {
    return (
      <Marco>
        <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm">
          {errorCarga}{' '}
          <button onClick={() => { void cargar(); }} className="underline font-semibold">Reintentar</button>
        </div>
      </Marco>
    );
  }

  // Todavía no hay acta, o la sustentación no ha ocurrido.
  if (!data?.existe || data.motivo === 'AUN_NO') {
    return (
      <Marco>
        <div className="card-inalde p-6">
          <p className="font-primary font-bold text-lg text-inalde-text mb-2">Tu acta aún no está disponible</p>
          <p className="text-sm text-inalde-gray">
            El acta de entrega se habilita <strong>cuando termina tu sustentación</strong>, según el
            cronograma de presentaciones. Cuando eso ocurra, podrás leerla y firmarla aquí mismo.
          </p>
          {data?.fecha_sustentacion && (
            <p className="text-sm text-inalde-text mt-3">
              Tu sustentación: <strong>{fmtFecha(data.fecha_sustentacion)}</strong>
            </p>
          )}
        </div>
      </Marco>
    );
  }

  if (data.motivo === 'ANULADA') {
    return (
      <Marco>
        <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-4 text-sm">
          <strong>Tu acta fue anulada.</strong> Habla con la coordinación del programa para saber
          cómo continuar.
        </div>
      </Marco>
    );
  }

  const cadena = data.cadena ?? [];

  return (
    <Marco>
      {(exito || data.ya_firme) && (
        <div className="rounded border-l-4 border-green-600 bg-green-50 px-4 py-3 text-sm mb-6">
          <strong>Ya firmaste tu acta.</strong>{' '}
          {data.firmada_en && `El ${fmtFecha(data.firmada_en)}.`}{' '}
          Ahora pasa a las firmas de tu profesor y del Director de Cohorte.
        </div>
      )}

      {/* Datos del acta */}
      <div className="card-inalde p-5 mb-6">
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Proyecto</p>
            <p className="text-inalde-text">{data.nombre_proyecto || '—'}</p>
          </div>
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Sustentación</p>
            <p className="text-inalde-text">{fmtFecha(data.fecha_sustentacion)}</p>
          </div>
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Resultado</p>
            <p className="text-inalde-text">{data.nota === 'aceptado' ? 'Aceptado' : data.nota === 'rechazado' ? 'No aceptado' : '—'}</p>
          </div>
        </div>
      </div>

      {/* Leer antes de firmar */}
      <div className="card-inalde p-5 mb-6">
        <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-3">1 · Lee tu acta</h2>
        <p className="text-sm text-inalde-gray mb-4">
          Nadie debería firmar un documento sin leerlo. Ábrela y revisa que tus datos estén bien.
        </p>
        <button type="button" className="btn-inalde-secondary" onClick={() => { void verMiActa(); }} disabled={abriendoPdf}>
          {abriendoPdf ? 'Abriendo…' : pdfUrl ? 'Ocultar el acta' : '📄 Ver mi acta'}
        </button>
        {pdfUrl && (
          <div className="mt-4">
            <object data={`${pdfUrl}#toolbar=1&view=FitH`} type="application/pdf"
              className="w-full h-[70vh] border border-inalde-gray-light rounded" aria-label="Mi acta">
              {/* Los navegadores móviles no incrustan PDF: se ofrece aparte. */}
              <div className="p-6 text-center">
                <p className="text-sm text-inalde-gray mb-3">Tu navegador no puede mostrar el acta aquí.</p>
                <a className="btn-inalde-secondary" href={pdfUrl} target="_blank" rel="noopener noreferrer">
                  Abrir el acta en otra pestaña →
                </a>
              </div>
            </object>
          </div>
        )}
      </div>

      {/* Firmar */}
      {data.puede_firmar && !exito && (
        <div className="card-inalde p-5 mb-6">
          <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-3">2 · Firma</h2>

          {!leyo && (
            <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm mb-4">
              Abre y revisa tu acta antes de firmarla.
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-4">
            {([['trazo', 'Dibujar'], ['texto', 'Escribir mi nombre'], ['archivo', 'Adjuntar imagen']] as const).map(([m, et]) => (
              <button key={m} type="button" onClick={() => { setModo(m); setError(''); }}
                className={`px-3 py-1.5 rounded text-xs uppercase tracking-wider font-semibold transition ${
                  modo === m ? 'bg-inalde-red text-white' : 'bg-inalde-gray-bg text-inalde-gray hover:text-inalde-text'
                }`}>{et}</button>
            ))}
          </div>

          {modo === 'trazo' && (
            <div>
              <canvas
                ref={canvasRef} width={900} height={240}
                className="w-full h-40 border-2 border-dashed border-inalde-gray-light rounded bg-white touch-none cursor-crosshair"
                onMouseDown={empezar} onMouseMove={mover} onMouseUp={terminar} onMouseLeave={terminar}
                onTouchStart={empezar} onTouchMove={mover} onTouchEnd={terminar}
              />
              <button type="button" onClick={limpiarTrazo} className="btn-inalde-ghost mt-2">Borrar y repetir</button>
            </div>
          )}

          {modo === 'texto' && (
            <div>
              <input className="input-inalde" value={texto} onChange={(e) => setTexto(e.target.value)}
                placeholder="Escribe tu nombre completo" />
              {texto.trim() && (
                <p className="mt-3 text-3xl text-inalde-text" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
                  {texto}
                </p>
              )}
            </div>
          )}

          {modo === 'archivo' && (
            <div>
              <input type="file" accept="image/*" className="text-sm"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) archivoAImagen(f); }} />
              {imagen && <img src={imagen} alt="Tu firma" className="mt-3 max-h-32 border border-inalde-gray-light rounded" />}
            </div>
          )}

          {error && (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mt-4">{error}</div>
          )}

          <p className="text-xs text-inalde-gray mt-4">
            Tu firma queda sellada con fecha, hora y un código de verificación, conforme a la
            Ley 527 de 1999 y el Decreto 2364 de 2012.
          </p>

          <button type="button" className="btn-inalde-primary mt-4" onClick={() => { void firmar(); }} disabled={enviando}>
            {enviando ? 'Firmando…' : 'Firmar mi acta'}
          </button>
        </div>
      )}

      {/* Avance de la cadena */}
      {cadena.length > 0 && (
        <div className="card-inalde p-5">
          <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-3">Firmas del acta</h2>
          <ul className="flex flex-col gap-2">
            {cadena.map((f, i) => (
              <li key={`${f.rol}-${i}`} className="flex items-center justify-between text-sm border-b border-inalde-gray-light pb-2 last:border-b-0">
                <span className="text-inalde-text">
                  {ROL_LEGIBLE[f.rol] ?? f.rol}
                  {f.nombre && f.rol !== 'participante' && <span className="text-inalde-gray"> · {f.nombre}</span>}
                </span>
                <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                  f.estado === 'firmada' ? 'bg-green-100 text-green-800' : 'bg-inalde-gray-bg text-inalde-gray'
                }`}>
                  {f.estado === 'firmada' ? '✓ Firmada' : 'Pendiente'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Marco>
  );
}
