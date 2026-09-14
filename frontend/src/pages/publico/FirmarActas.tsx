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
  director_mba: 'Director MBA',
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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const hayTrazo = useRef(false);

  useEffect(() => { (async () => {
    try {
      const r = await api.get(`/actas/firmar/${encodeURIComponent(token)}`);
      setData(r.data as Data);
      setTexto((r.data as Data).firmante?.nombre ?? '');
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
  return (
    <Marco>
      <p className="section-subtitle mb-1">Acta de Entrega de Trabajo de Grado</p>
      <h1 className="section-title mb-1">Firma de actas</h1>
      <p className="text-inalde-gray text-sm mb-6">
        <strong className="text-inalde-text">{d.firmante.nombre}</strong>
        {' · '}{ROL_LABEL[d.firmante.rol] ?? d.firmante.rol}
      </p>

      <div className="card-inalde p-5 mb-6">
        <p className="text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-3">
          Vas a firmar {d.actas.length} acta{d.actas.length === 1 ? '' : 's'}
        </p>
        <div className="max-h-[260px] overflow-auto divide-y divide-inalde-gray-light">
          {d.actas.map((a) => (
            <div key={a.id} className="py-2 flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-inalde-text truncate">{a.participante}</p>
                <p className="text-xs text-inalde-gray truncate">
                  {a.proyecto || '—'} · {MODALIDAD[a.modalidad] ?? a.modalidad}
                </p>
              </div>
              <span className="text-xs text-inalde-gray whitespace-nowrap">{fmtFecha(a.fecha_sustentacion)}</span>
            </div>
          ))}
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

      <button onClick={firmar} disabled={enviando} className="btn-inalde-primary disabled:opacity-50">
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
      <div className="max-w-[760px] mx-auto">
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
