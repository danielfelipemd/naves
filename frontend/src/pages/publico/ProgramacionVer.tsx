import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { VisorArchivo } from '../../components/inalde/VisorArchivo';

// Enlace mágico de la programación para un público (sql/58): asistentes (para
// imprimir), marketing (con post y logo) o publicaciones (con One Pagers). Sin
// sesión: el enlace es el permiso y el servidor solo manda las columnas de su
// público. Muestra la programación solo cuando está publicada.

type Fila =
  | { tipo: 'actividad'; desc: string; hora_inicio: string; hora_fin: string }
  | {
      tipo: 'proyecto'; slot: number; bloque: number; hora_inicio: string; hora_fin: string;
      proyecto_id: string; proyecto: string; autores: string; sector: string;
      resumen?: string | null; linkedin?: string | null;
      tiene_logo?: boolean; tiene_one_pager?: boolean; one_pager_imagen?: boolean;
    };
interface Jornada { numero: number; fecha: string; fecha_legible: string; filas: Fila[] }
interface Datos {
  publico: 'asistentes' | 'marketing' | 'publicaciones'; publico_nombre: string;
  ve: { resumen: boolean; linkedin: boolean; logo: boolean; onePager: boolean };
  nombre: string; cohorte: string; vence_at: string; publicada: boolean; evento_nombre: string; jornadas: Jornada[];
}
const MOTIVO: Record<string, string> = {
  ENLACE_INVALIDO: 'Este enlace no existe o fue reemplazado por uno nuevo.',
  ENLACE_REVOCADO: 'Este enlace fue revocado.',
  ENLACE_VENCIDO: 'Este enlace ya venció.',
};
const legible = (iso: string) => new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

export default function ProgramacionVer() {
  const { token = '' } = useParams();
  const base = `/api/programacion-enlaces/v/${token}`;
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [visor, setVisor] = useState<{ url: string; descarga: string; titulo: string; imagen: boolean } | null>(null);

  useEffect(() => {
    api.get(`/programacion-enlaces/v/${token}`, { timeout: 30000 })
      .then((r) => setDatos(r.data))
      .catch((e) => {
        const codigo = e?.response?.data?.error as string | undefined;
        setError(MOTIVO[codigo ?? ''] ?? 'No pudimos cargar la programación. Revise su conexión y recargue la página.');
      });
  }, [token]);

  async function copiar(id: string, texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(id); setTimeout(() => setCopiado((c) => (c === id ? null : c)), 2000); }
    catch { /* sin portapapeles: el texto está a la vista para copiarlo a mano */ }
  }

  // Las columnas salen de lo que ve el público (el servidor ya no manda el resto).
  function columnas(d: Datos) {
    const cols = ['Inicio', 'Fin', 'Slot', 'Bloque', 'Proyecto', 'Autores', 'Sector'];
    if (d.ve.resumen) cols.push('Resumen');
    if (d.ve.linkedin) cols.push('Post LinkedIn');
    if (d.ve.logo) cols.push('Logo');
    if (d.ve.onePager) cols.push('One Pager');
    return cols;
  }

  function renderFila(d: Datos, f: Fila, i: number, ncols: number) {
    if (f.tipo === 'actividad') {
      return (
        <tr key={`a${i}`} className="bg-inalde-gray-bg">
          <td className="px-2 py-1.5 font-mono text-xs font-semibold">{f.hora_inicio}</td>
          <td className="px-2 py-1.5 font-mono text-xs font-semibold">{f.hora_fin}</td>
          <td colSpan={ncols - 2} className="px-2 py-1.5 text-xs font-semibold border-l-4 border-inalde-red">{f.desc}</td>
        </tr>
      );
    }
    return (
      <tr key={f.proyecto_id} className="border-b border-inalde-gray-light align-top bg-[#FFF8E1]/60 print:bg-transparent">
        <td className="px-2 py-2 font-mono text-xs">{f.hora_inicio}</td>
        <td className="px-2 py-2 font-mono text-xs">{f.hora_fin}</td>
        <td className="px-2 py-2 text-center font-bold text-inalde-red">{f.slot}</td>
        <td className="px-2 py-2 text-xs whitespace-nowrap">Bloque {f.bloque}</td>
        <td className="px-2 py-2 font-primary font-bold text-sm text-inalde-text">{f.proyecto}</td>
        <td className="px-2 py-2 text-xs text-inalde-gray">{f.autores}</td>
        <td className="px-2 py-2 text-xs">{f.sector}</td>
        {d.ve.resumen && <td className="px-2 py-2 text-xs leading-relaxed min-w-[220px]">{f.resumen || <span className="italic text-inalde-gray">Sin resumen</span>}</td>}
        {d.ve.linkedin && (
          <td className="px-2 py-2 text-xs leading-relaxed min-w-[260px]">
            {f.linkedin ? (
              <>
                <div className="whitespace-pre-line mb-1.5">{f.linkedin}</div>
                <button onClick={() => copiar(f.proyecto_id, f.linkedin!)} className="print:hidden font-primary font-bold text-[0.63rem] tracking-wider uppercase border border-inalde-gray-light px-2 py-1 hover:bg-inalde-text hover:text-white">
                  {copiado === f.proyecto_id ? '✓ Copiado' : 'Copiar'}
                </button>
              </>
            ) : <span className="italic text-inalde-gray">Sin post</span>}
          </td>
        )}
        {d.ve.logo && (
          <td className="px-2 py-2 text-xs">
            {f.tiene_logo ? (
              <>
                <img src={`${base}/archivo/${f.proyecto_id}/miniatura`} alt={`Logo de ${f.proyecto}`} loading="lazy" className="w-16 h-12 object-contain border border-inalde-gray-light rounded bg-white" />
                <a href={`${base}/archivo/${f.proyecto_id}/logo?descargar=1`} className="print:hidden block mt-1 text-inalde-blue underline whitespace-nowrap">Descargar</a>
              </>
            ) : <span className="italic text-inalde-gray">—</span>}
          </td>
        )}
        {d.ve.onePager && (
          <td className="px-2 py-2 text-xs">
            {f.tiene_one_pager ? (
              <button onClick={() => setVisor({ url: `${base}/archivo/${f.proyecto_id}/one-pager`, descarga: `${base}/archivo/${f.proyecto_id}/one-pager?descargar=1`, titulo: `One Pager · ${f.proyecto}`, imagen: !!f.one_pager_imagen })}
                aria-label={`Ver el One Pager de ${f.proyecto}`}
                className="font-primary font-bold text-[0.65rem] tracking-wider uppercase border border-inalde-red text-inalde-red px-2 py-1 rounded-[3px] hover:bg-inalde-red hover:text-white whitespace-nowrap">Ver / bajar</button>
            ) : <span className="italic text-inalde-gray">—</span>}
          </td>
        )}
      </tr>
    );
  }

  function renderContenido() {
    if (error) {
      return (
        <div role="alert" className="max-w-[680px] bg-white rounded-lg shadow-inalde-card p-6 border-l-4 border-inalde-red">
          <h1 className="font-primary font-bold text-lg mb-1">No pudimos abrir la programación</h1>
          <p className="text-sm text-inalde-gray">{error}</p>
          <p className="text-sm text-inalde-gray mt-2">Pídale un enlace nuevo a la dirección del programa.</p>
        </div>
      );
    }
    if (!datos) return <p className="text-inalde-gray">Cargando la programación…</p>;
    if (!datos.publicada) {
      return (
        <div role="status" className="max-w-[680px] bg-white rounded-lg shadow-inalde-card p-6 border-l-4 border-inalde-gold">
          <h1 className="font-primary font-bold text-lg mb-1">La programación todavía no está publicada</h1>
          <p className="text-sm text-inalde-gray">Este enlace ya funciona: en cuanto la dirección del programa publique la programación, la verá aquí. Vuelva a abrirlo más tarde.</p>
        </div>
      );
    }
    const cols = columnas(datos);
    return (
      <>
        <div className="print:hidden flex flex-wrap gap-2 mb-5">
          <a href={`${base}/excel`} className="btn-inalde-primary !py-2 !px-4 !text-xs">⬇ Descargar Excel</a>
          <button onClick={() => window.print()} className="btn-inalde-secondary !py-2 !px-4 !text-xs">🖨 Imprimir</button>
          {datos.ve.logo && <a href={`${base}/zip`} className="btn-inalde-secondary !py-2 !px-4 !text-xs">⬇ Todos los logos (ZIP)</a>}
          {datos.ve.onePager && <a href={`${base}/zip`} className="btn-inalde-secondary !py-2 !px-4 !text-xs">⬇ Todos los One Pager (ZIP)</a>}
        </div>
        {datos.jornadas.map((j) => (
          <section key={j.numero} className="mb-8 break-inside-avoid-page">
            <h2 className="font-primary font-extrabold text-inalde-text text-lg mb-2">
              Jornada {j.numero} <span className="font-normal text-inalde-gray">· <span className="inline-block first-letter:uppercase">{j.fecha_legible}</span></span>
            </h2>
            <div className="overflow-x-auto bg-white rounded-lg border border-inalde-gray-light print:overflow-visible print:border-0">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-inalde-text text-white">
                    {cols.map((c) => <th key={c} scope="col" className="px-2 py-2 font-primary font-bold text-[0.65rem] tracking-wider uppercase whitespace-nowrap">{c}</th>)}
                  </tr>
                </thead>
                <tbody>{j.filas.map((f, i) => renderFila(datos, f, i, cols.length))}</tbody>
              </table>
            </div>
          </section>
        ))}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-inalde-gray-bg/40 print:bg-white">
      {/* Al imprimir: carta horizontal y solo la tabla (para las carteleras). */}
      <style>{'@page { size: letter landscape; margin: 10mm; } @media print { header.no-imprimir { display: none; } }'}</style>
      <header className="no-imprimir bg-inalde-text text-white py-5 px-4">
        <div className="w-full flex flex-wrap items-end gap-x-6 gap-y-1">
          <div>
            <p className="text-[11px] uppercase tracking-[2px] text-white/60">Programación · NAVES{datos ? ` · ${datos.publico_nombre}` : ''}</p>
            <p className="text-lg font-primary font-bold">INALDE Business School — Executive MBA</p>
          </div>
          {datos && (
            <p className="text-sm text-white/70 sm:ml-auto">
              {datos.evento_nombre ? `${datos.evento_nombre} · ` : ''}{datos.cohorte} · enlace de {datos.nombre} · funciona hasta el {legible(datos.vence_at)}
            </p>
          )}
        </div>
      </header>
      <main className="w-full px-4 py-8 print:p-0">
        {datos?.publicada && <h1 className="hidden print:block font-primary font-bold text-base mb-2">{datos.evento_nombre || 'NAVES'} — Programación · {datos.cohorte}</h1>}
        {renderContenido()}
      </main>
      {visor && <VisorArchivo url={visor.url} urlDescarga={visor.descarga} imagen={visor.imagen} titulo={visor.titulo} onClose={() => setVisor(null)} />}
    </div>
  );
}
