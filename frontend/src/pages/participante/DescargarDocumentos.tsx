import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

/**
 * Descargar Documentos — acceso rápido a todo lo descargable del equipo.
 *
 * Reúne en una sola pantalla los documentos que hoy están repartidos en el
 * trabajo de grado: anteproyecto, avance, proyecto final y el material del
 * proyecto definitivo. El backend arma el inventario según la modalidad del
 * equipo y marca lo que todavía no se ha cargado, así la pantalla también
 * funciona como recordatorio de lo que falta.
 */

type Doc = {
  clave: string;
  titulo: string;
  descripcion: string;
  disponible: boolean;
  url: string | null;
  mime?: string | null;
  size_bytes?: number | null;
  subido_at?: string | null;
  nota?: string;
};

type Respuesta = {
  en_equipo: boolean;
  equipo?: string | null;
  modalidad?: string | null;
  estado?: string | null;
  documentos: Doc[];
};

const ICONO: Record<string, string> = {
  anteproyecto: '📄',
  anteproyecto_pdf: '📄',
  avance: '📑',
  'proyecto-final': '📘',
  one_pager: '🗂️',
  logo: '🖼️',
  modelo_financiero: '📊',
};

const ETIQUETA_MODALIDAD: Record<string, string> = {
  business_plan: 'Business Plan NAVES',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

function formatoTamano(bytes?: number | null): string | null {
  if (!bytes) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatoFecha(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function DescargarDocumentos() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/anteproyectos/mis-documentos');
        setData(r.data);
      } catch (e: any) {
        setError(formatBackendError(e));
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  async function descargar(doc: Doc) {
    if (!doc.url || !doc.disponible) return;
    setError(null);
    setBajando(doc.clave);
    try {
      // El PDF del anteproyecto se genera al vuelo y llega como binario; los
      // archivos subidos llegan como un enlace firmado de corta duración.
      const esPdfGenerado = doc.url.endsWith('.pdf');
      let href: string;

      if (esPdfGenerado) {
        const r = await api.get(doc.url, { responseType: 'blob' });
        href = URL.createObjectURL(r.data as Blob);
      } else {
        const { data: d } = await api.get(doc.url);
        if (!d?.url) {
          setError('No fue posible obtener el archivo. Inténtalo de nuevo.');
          return;
        }
        href = new URL(d.url, window.location.origin).href;
      }

      // Mismo mecanismo que en el trabajo de grado: un <a download> programático
      // abre el diálogo de guardado sin abrir pestañas nuevas.
      const a = document.createElement('a');
      a.href = href;
      a.download = esPdfGenerado ? `${doc.titulo}.pdf` : '';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (esPdfGenerado) URL.revokeObjectURL(href);
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally {
      setBajando(null);
    }
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[900px] mx-auto">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Trabajo de grado</p>
            <h1 className="section-title">Descargar Documentos</h1>
            {data?.equipo && (
              <p className="text-inalde-gray text-sm mt-3">
                Equipo <strong className="text-inalde-text">{data.equipo}</strong>
                {data.modalidad ? ` · ${ETIQUETA_MODALIDAD[data.modalidad] ?? data.modalidad}` : ''}
              </p>
            )}
          </div>

          {error && (
            <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm">{error}</div>
          )}

          {cargando ? (
            <p className="text-inalde-gray text-sm">Cargando tus documentos…</p>
          ) : !data?.en_equipo ? (
            <div className="card-inalde p-8">
              <p className="text-inalde-text font-semibold mb-1">Todavía no perteneces a un equipo</p>
              <p className="text-inalde-gray text-sm">
                Cuando formes tu equipo y carguen documentos, aparecerán aquí para descargar.
              </p>
            </div>
          ) : data.documentos.length === 0 ? (
            <div className="card-inalde p-8">
              <p className="text-inalde-gray text-sm">Tu equipo todavía no tiene documentos.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.documentos.map((doc) => {
                const tam = formatoTamano(doc.size_bytes);
                const fecha = formatoFecha(doc.subido_at);
                return (
                  <div
                    key={doc.clave}
                    className={`card-inalde flex items-center gap-5 p-6 ${doc.disponible ? '' : 'opacity-60'}`}
                  >
                    <div className="text-4xl shrink-0">{ICONO[doc.clave] ?? '📄'}</div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-primary font-bold text-lg mb-1">{doc.titulo}</h2>
                      <p className="text-inalde-gray text-sm">{doc.descripcion}</p>
                      {doc.nota && <p className="text-inalde-gray text-xs italic mt-1">{doc.nota}</p>}
                      {(tam || fecha) && (
                        <p className="text-inalde-gray text-xs mt-1">
                          {[fecha && `Cargado el ${fecha}`, tam].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {doc.disponible ? (
                      <button
                        onClick={() => descargar(doc)}
                        disabled={bajando === doc.clave}
                        className="text-sm font-semibold text-inalde-red hover:text-inalde-red-hover whitespace-nowrap disabled:opacity-50"
                      >
                        {bajando === doc.clave ? 'Preparando…' : 'Descargar ↓'}
                      </button>
                    ) : (
                      <span className="text-xs text-inalde-gray italic whitespace-nowrap">Sin cargar</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-8">
            <Link to="/" className="text-sm font-semibold text-inalde-red hover:text-inalde-red-hover">
              ← Volver al tablero
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
