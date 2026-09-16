import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';

// Firma de actas PÚBLICA (sin sesión). El enlace solo sirve para firmar las
// actas que trae asignadas: no da acceso a ninguna otra parte del sistema.
// Tres formas de firmar, porque quien firma lo hace dos veces al año y desde
// cualquier dispositivo: trazo con el dedo/ratón, nombre escrito, o imagen.

interface ActaItem {
  id: number;
  participante: string;
  proyecto: string | null;
  modalidad: string;
  fecha_sustentacion: string | null;
  nota: string | null;
}
interface Data {
  firmante: { nombre: string; rol: string };
  requiere_verificacion: boolean;
  expira_en: string;
  actas: ActaItem[];
}

const ROL_LABEL: Record<string, string> = {
  profesor: 'Profesor NAVES',
  director_proyecto: 'Director del proyecto',
  jurado: 'Jurado',
  director_mba: 'Director de Cohorte',
};

const MODALIDAD: Record<string, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

type Modo = 'trazo' | 'texto' | 'imagen';

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function FirmarActas() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [modo, setModo] = useState<Modo>('trazo');
  const [texto, setTexto] = useState('');
  const [imagen, setImagen] = useState<string | null>(null);
  const [verificacion, setVerificacion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState<number | null>(null);

  // Acta que se está leyendo. Nadie firma a ciegas: el documento se abre en
  // el visor y el botón de firmar espera a que se hayan revisado todas.
  const [abierta, setAbierta] = useState<number | null>(null);
  const [leidas, setLeidas] = useState<Set<number>>(new Set());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const hayTrazo = useRef(false);

  useEffect(() => { (async () => {
    try {
      const r = await api.get(`/actas/firmar/${encodeURIComponent(token)}`);
      const d = r.data as Data;
      setData(d);
      setTexto(d.firmante?.nombre ?? '');
      // Se abre la primera de entrada: el documento es lo primero que debe ver.
      if (d.actas?.length) { setAbierta(d.actas[0].id); setLeidas(new Set([d.actas[0].id])); }
    } catch (e: any) {
      const code = e?.response?.data?.error;
      setErrorCarga(
        code === 'YA_FIRMADO' ? 'Estas actas ya fueron firmadas con este enlace. No hace falta que hagas nada más.'
        : code === 'ENLACE_VENCIDO' ? 'Este enlace venció. Solicita uno nuevo a la asistente del programa.'
        : code === 'ENLACE_REVOCADO' ? 'Este enlace fue anulado. Solicita uno nuevo a la asistente del programa.'
        : code === 'ENLACE_BLOQUEADO' ? 'El enlace se bloqueó por varios intentos fallidos. Contacta a la asistente del programa.'
        : 'Este enlace no es válido. Verifica que lo copiaste completo.',
      );
    } finally { setCargando(false); }
  })(); }, [token]);

  function abrir(id: number) {
    setAbierta(id);
    setLeidas((prev) => new Set(prev).add(id));
  }

  // --- Lienzo de trazo ---------------------------------------------------
  function posicion(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    // El lienzo se dibuja a mayor resolución que su tamaño en pantalla, por eso
    // se escala: si no, el trazo aparece desplazado del dedo.
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

  /** Convierte el nombre escrito en una imagen, para que el acta siempre lleve un trazo. */
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
    if (f.size > 400_000) { setError('La imagen pesa demasiado. Usa uno más liviano (máximo 400 KB).'); return; }
    const fr = new FileReader();
    fr.onload = () => setImagen(String(fr.result));
    fr.readAsDataURL(f);
  }

  async function firmar() {
    setError('');
    let img: string | null = null;
    if (modo === 'trazo') {
      if (!hayTrazo.current) { setError('Dibuja tu firma en el recuadro antes de continuar.'); return; }
      img = canvasRef.current!.toDataURL('image/png');
    } else if (modo === 'texto') {
      if (!texto.trim()) { setError('Escribe tu nombre para generar la firma.'); return; }
      img = textoAImagen(texto.trim());
    } else {
      if (!imagen) { setError('Adjunta la imagen de tu firma.'); return; }
      img = imagen;
    }
    if (data?.requiere_verificacion && !verificacion.trim()) {
      setError('Escribe los últimos dígitos de tu documento para confirmar tu identidad.');
      return;
    }
    // Revisar cada acta es recomendable, no obligatorio: quien ya conoce el
    // contenido no tiene por qué abrir veintidós documentos para firmarlos.
    // Se avisa una vez y decide el firmante.
    const sinLeer = (data?.actas.length ?? 0) - leidas.size;
    if (sinLeer > 0 && !confirm(
      `Vas a firmar ${data?.actas.length} actas y has abierto ${leidas.size}. `
      + `Tu firma vale para todas. ¿Continuar?`,
    )) return;

    setEnviando(true);
    try {
      const r = await api.post(`/actas/firmar/${encodeURIComponent(token)}`, {
        imagen: img,
        verificacion: verificacion.trim() || undefined,
      });
      setExito((r.data as any)?.firmadas ?? data?.actas.length ?? 0);
    } catch (e: any) {
      const code = e?.response?.data?.error;
      setError(
        code === 'VERIFICACION_INCORRECTA' ? 'Los dígitos no coinciden. Revisa e inténtalo de nuevo.'
        : code === 'YA_FIRMADO' ? 'Estas actas ya fueron firmadas.'
        // El guardado falló: el enlace sigue activo a propósito para que el
        // firmante pueda reintentar. El backend explica cuántas quedaron.
        : code === 'FIRMA_NO_GUARDADA' ? (e?.response?.data?.mensaje ?? 'No pudimos registrar tu firma. Tu enlace sigue activo: vuelve a intentarlo en unos minutos.')
        : code === 'FIRMA_DEMASIADO_GRANDE' ? 'La firma pesa demasiado. Usa una imagen más liviana.'
        : e?.response?.data?.mensaje ?? 'No pudimos registrar tu firma. Inténtalo de nuevo.',
      );
    } finally { setEnviando(false); }
  }

  // --- Pantallas ---------------------------------------------------------
  if (cargando) {
    return <Marco><p className="text-inalde-gray text-sm">Cargando tus actas…</p></Marco>;
  }
  if (errorCarga) {
    return <Marco><div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm">{errorCarga}</div></Marco>;
  }
  if (exito !== null) {
    return (
      <Marco>
        <div className="text-center py-6">
          <div className="text-5xl mb-3">✓</div>
          <h2 className="font-primary font-bold text-xl mb-2">Firma registrada</h2>
          <p className="text-inalde-gray text-sm">
            Firmaste {exito} acta{exito === 1 ? '' : 's'}. Ya puedes cerrar esta ventana.
          </p>
          <p className="text-inalde-gray text-xs mt-4">
            Tu firma quedó sellada con la fecha y hora de hoy. No hace falta que hagas nada más.
          </p>
        </div>
      </Marco>
    );
  }

  const d = data!;
  const faltanPorLeer = d.actas.length - leidas.size;
  return (
    <Marco>
      <p className="section-subtitle mb-1">Acta de Entrega de Trabajo de Grado</p>
      <h1 className="section-title mb-1">Firma de actas</h1>
      <p className="text-inalde-gray text-sm mb-6">
        <strong className="text-inalde-text">{d.firmante.nombre}</strong>
        {' · '}{ROL_LABEL[d.firmante.rol] ?? d.firmante.rol}
      </p>

      {/* Documento + índice. El acta abierta ocupa el espacio principal: lo que
          se firma debe poder leerse, no solo contarse en una lista. */}
      <div className="grid lg:grid-cols-[1fr_300px] gap-5 mb-6">
        <div className="border border-inalde-gray-light rounded overflow-hidden bg-inalde-gray-bg">
          {abierta ? (
            <object
              data={`/api/actas/firmar/${encodeURIComponent(token)}/acta/${abierta}/pdf#toolbar=1&view=FitH`}
              type="application/pdf"
              className="w-full h-[560px]"
              aria-label="Acta en revisión"
            >
              {/* Los navegadores móviles no incrustan PDF: se ofrece abrirlo aparte. */}
              <div className="p-6 text-center">
                <p className="text-sm text-inalde-gray mb-3">Tu navegador no puede mostrar el acta aquí.</p>
                <a className="btn-inalde-secondary" target="_blank" rel="noopener noreferrer"
                  href={`/api/actas/firmar/${encodeURIComponent(token)}/acta/${abierta}/pdf`}>
                  Abrir el acta en otra pestaña →
                </a>
              </div>
            </object>
          ) : (
            <div className="h-[560px] flex items-center justify-center text-sm text-inalde-gray">
              Selecciona un acta para leerla.
            </div>
          )}
        </div>

        <div className="border border-inalde-gray-light rounded overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-inalde-gray-light bg-inalde-gray-bg/60">
            <p className="text-xs uppercase tracking-wider font-semibold text-inalde-gray">
              {d.actas.length} acta{d.actas.length === 1 ? '' : 's'} por firmar
            </p>
            <p className="text-[11px] text-inalde-gray mt-0.5">
              Revisadas {leidas.size} de {d.actas.length}
            </p>
          </div>
          <div className="overflow-auto max-h-[500px] divide-y divide-inalde-gray-light">
            {d.actas.map((a) => {
              const activa = abierta === a.id;
              const vista = leidas.has(a.id);
              return (
                <button key={a.id} type="button" onClick={() => abrir(a.id)}
                  className={`w-full text-left px-4 py-3 transition ${activa ? 'bg-inalde-red/5 border-l-[3px] border-inalde-red' : 'hover:bg-inalde-gray-bg/60 border-l-[3px] border-transparent'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm truncate ${activa ? 'font-semibold text-inalde-text' : 'text-inalde-text'}`}>
                      {a.participante}
                    </p>
                    <span className={`text-[11px] shrink-0 ${vista ? 'text-green-700' : 'text-inalde-gray/60'}`}>
                      {vista ? '✓ leída' : 'sin leer'}
                    </span>
                  </div>
                  <p className="text-[11px] text-inalde-gray truncate">
                    {a.proyecto || '—'} · {MODALIDAD[a.modalidad] ?? a.modalidad}
                  </p>
                  <p className="text-[11px] text-inalde-gray/80">{fmtFecha(a.fecha_sustentacion)}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-2">Tu firma</p>
      <div className="flex gap-2 mb-3">
        {([['trazo', 'Dibujar'], ['texto', 'Escribir'], ['imagen', 'Adjuntar']] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => { setModo(m); setError(''); }}
            className={`text-xs font-semibold px-3 py-1.5 rounded border transition ${
              modo === m ? 'bg-inalde-red text-white border-inalde-red' : 'border-inalde-gray-light text-inalde-gray hover:border-inalde-red'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {modo === 'trazo' && (
        <div className="mb-4">
          <canvas
            ref={canvasRef}
            width={900} height={260}
            onMouseDown={empezar} onMouseMove={mover} onMouseUp={terminar} onMouseLeave={terminar}
            onTouchStart={empezar} onTouchMove={mover} onTouchEnd={terminar}
            className="w-full h-[130px] border-2 border-dashed border-inalde-gray-light rounded bg-white touch-none cursor-crosshair"
          />
          <button type="button" onClick={limpiarTrazo} className="mt-1 text-xs text-inalde-gray hover:text-inalde-red">
            Borrar y volver a empezar
          </button>
        </div>
      )}

      {modo === 'texto' && (
        <div className="mb-4">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} className="input-inalde" placeholder="Tu nombre" />
          <p className="mt-2 text-2xl italic text-inalde-text" style={{ fontFamily: 'Georgia, serif' }}>{texto || '—'}</p>
        </div>
      )}

      {modo === 'imagen' && (
        <div className="mb-4">
          <input type="file" accept="image/png,image/jpeg" className="text-sm"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) archivoAImagen(f); }} />
          {imagen && <img src={imagen} alt="Firma" className="mt-2 max-h-[110px] border border-inalde-gray-light rounded bg-white p-2" />}
        </div>
      )}

      {d.requiere_verificacion && (
        <div className="mb-4">
          <label className="block text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-1">
            Últimos dígitos de tu documento
          </label>
          <input value={verificacion} onChange={(e) => setVerificacion(e.target.value)}
            className="input-inalde max-w-[200px]" inputMode="numeric" placeholder="••••" />
          <p className="text-[11px] text-inalde-gray mt-1">Confirma que eres tú quien firma.</p>
        </div>
      )}

      {error && <div className="mb-4 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm">{error}</div>}

      {faltanPorLeer > 0 && (
        <div className="mb-4 rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm">
          Has revisado {leidas.size} de {d.actas.length} actas. Puedes abrir las que quieras desde la lista,
          o firmarlas todas de una vez si ya conoces su contenido.
        </div>
      )}

      <button onClick={firmar} disabled={enviando}
        className="btn-inalde-primary disabled:opacity-50 disabled:cursor-not-allowed">
        {enviando ? 'Registrando tu firma…' : `Firmar ${d.actas.length} acta${d.actas.length === 1 ? '' : 's'} →`}
      </button>

      <p className="text-[11px] text-inalde-gray mt-4 leading-relaxed">
        Al firmar, el sistema registra la fecha, la hora y un código único de verificación.
        Firma electrónica conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012.
      </p>
    </Marco>
  );
}

/** Marco con la identidad INALDE, sin el encabezado del sistema: quien abre este
 *  enlace no tiene sesión y no debe ver la navegación interna. */
function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-inalde-gray-bg py-10 px-4">
      <div className="max-w-[1100px] mx-auto">
        <div className="bg-white rounded-lg shadow-inalde-card overflow-hidden">
          <div className="border-b-[3px] border-inalde-red px-6 sm:px-10 py-4">
            <p className="font-primary font-extrabold text-sm tracking-widest uppercase text-inalde-text">INALDE Business School</p>
            <p className="text-[11px] uppercase tracking-wider text-inalde-gray mt-0.5">Trabajo de grado · MBA</p>
          </div>
          <div className="px-6 sm:px-10 py-8">{children}</div>
        </div>
      </div>
    </main>
  );
}
