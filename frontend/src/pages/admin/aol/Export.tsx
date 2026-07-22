import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';

// AoL — Fase 2: pantalla "Export AACSB" (§11). Muestra el histórico de medidas
// directas (Tabla 5-1), el registro histórico acumulado de conclusiones de ciclo,
// el resumen de la cohorte actual por trait y un formulario para generar el
// reporte Word (.docx) descargable. Solo lectura salvo el formulario.

interface Fila {
  criterio: string;
  lo: string;
  n: number;
  pct_on_standard: number;
  excede: number;
  cumple: number;
  no_cumple: number;
}
interface Data {
  cohorte_id: string;
  etiqueta: string;
  codigo_aol: string;
  // Tablas dinámicas: histórico de medidas directas y conclusiones de ciclo.
  aacsb: Record<string, unknown>[];
  conclusiones: Record<string, unknown>[];
  resumen_actual: Fila[];
}
interface Cohorte { id: string; etiqueta: string; activa: boolean; }

const TABS = [
  { key: 'trabajos', label: 'Trabajos', to: '/admin/aol', activo: false },
  { key: 'dashboard', label: 'Dashboard', to: '/admin/aol/dashboard', activo: false },
  { key: 'export', label: 'Export AACSB', to: '/admin/aol/export', activo: true },
];

// Convierte la clave interna (snake_case) en un encabezado legible.
function titulo(k: string) {
  const s = k.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Presenta el valor de una celda de forma segura para tablas dinámicas.
function celda(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Tabla genérica que arma sus columnas a partir de las claves del primer objeto.
function TablaDinamica({ filas, vacio }: { filas: Record<string, unknown>[]; vacio: string }) {
  if (!filas || filas.length === 0) {
    return <p className="text-inalde-gray text-sm">{vacio}</p>;
  }
  const columnas = Object.keys(filas[0]);
  return (
    <div className="overflow-auto max-h-[72vh]">
      <table className="w-full border-collapse bg-white">
        <thead>
          <tr className="bg-inalde-text text-white">
            {columnas.map((c) => (
              <th key={c} className="text-left font-primary font-bold text-[0.68rem] tracking-widest uppercase px-3 py-2.5 whitespace-nowrap">{titulo(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-inalde-gray-light align-top">
              {columnas.map((c) => (
                <td key={c} className="px-3 py-2.5 text-[0.8rem] text-inalde-gray">{celda(f[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AolExport() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);

  // Campos del formulario de generación del reporte Word (todos opcionales).
  const [notaContexto, setNotaContexto] = useState('');
  const [lecturaImpacto, setLecturaImpacto] = useState('');
  const [accionesSiguiente, setAccionesSiguiente] = useState('');
  const [generando, setGenerando] = useState(false);
  const [errorWord, setErrorWord] = useState('');

  useEffect(() => { (async () => {
    try {
      const r = await api.get('/admin/cohortes');
      const activas = (r.data as Cohorte[]).filter((c) => c.activa);
      setCohortes(activas);
      if (activas[0]) setCohorte(activas[0].id);
    } catch { /* noop */ }
  })(); }, []);

  useEffect(() => { if (!cohorte) return; (async () => {
    setLoading(true); setData(null); setErrorWord('');
    try { const r = await api.get(`/aol/export/${cohorte}`); setData(r.data); }
    catch { /* noop */ }
    finally { setLoading(false); }
  })(); }, [cohorte]);

  async function generarWord() {
    if (!cohorte) return;
    setGenerando(true); setErrorWord('');
    try {
      const body = {
        nota_contexto: notaContexto || undefined,
        lectura_impacto: lecturaImpacto || undefined,
        acciones_siguiente: accionesSiguiente || undefined,
      };
      const r = await api.post(`/aol/export/${cohorte}/word`, body, { responseType: 'blob' });
      const u = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = u;
      a.download = 'Reporte_AoL.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(u);
    } catch {
      setErrorWord('No se pudo generar el reporte. Inténtelo de nuevo.');
    } finally {
      setGenerando(false);
    }
  }

  async function descargarExcel() {
    if (!cohorte) return;
    setGenerando(true); setErrorWord('');
    try {
      const r = await api.get(`/aol/export/${cohorte}/excel`, { responseType: 'blob' });
      const u = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = u;
      a.download = 'Reporte_AoL.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(u);
    } catch {
      setErrorWord('No se pudo generar el Excel. Inténtelo de nuevo.');
    } finally {
      setGenerando(false);
    }
  }

  const [msgArchivo, setMsgArchivo] = useState('');
  async function cerrarCiclo() {
    if (!cohorte) return;
    setGenerando(true); setErrorWord(''); setMsgArchivo('');
    try {
      const body = { nota_contexto: notaContexto || undefined, lectura_impacto: lecturaImpacto || undefined, acciones_siguiente: accionesSiguiente || undefined };
      const r = await api.post(`/aol/export/${cohorte}/archivar`, body);
      // Descarga los 3 archivos del paquete (base64 → blob).
      for (const f of r.data.archivos ?? []) {
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const u = URL.createObjectURL(new Blob([bytes]));
        const a = document.createElement('a'); a.href = u; a.download = f.nombre;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u);
      }
      setMsgArchivo('Paquete de cierre descargado (Word + DATOS BRUTOS.xlsx + trazabilidad.json). El registro permanente queda en la base de datos.');
    } catch {
      setErrorWord('No se pudo cerrar el ciclo / archivar el paquete.');
    } finally {
      setGenerando(false);
    }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
        <p className="section-subtitle mb-2">Assurance of Learning</p>
        <h1 className="section-title">Export AACSB</h1>
        <p className="text-sm text-inalde-gray mt-2">Reporte de <strong>medidas directas</strong> del competency goal Entrepreneurship para la acreditación AACSB, con histórico acumulado y closing the loop.</p>
      </div>

      {/* Pestañas del módulo AoL */}
      <div className="flex gap-1 mb-6 border-b border-inalde-gray-light">
        {TABS.map((t) => (
          <Link key={t.key} to={t.to}
            className={`px-4 py-2 text-sm font-primary font-semibold border-b-2 -mb-px ${
              t.activo ? 'border-inalde-red text-inalde-red' : 'border-transparent text-inalde-gray/60 hover:text-inalde-red'
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="max-w-xs flex-1">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte activa</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde">
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
        {data && (
          <span className="text-sm text-inalde-gray">
            Código AoL: <strong className="text-inalde-red">{data.codigo_aol || '—'}</strong>
          </span>
        )}
      </div>

      {loading && <p className="text-inalde-gray text-sm">Cargando…</p>}

      {data && !loading && (
        <div className="space-y-8">
          {/* Tabla 5-1 AACSB — histórico de medidas directas */}
          <section className="card-inalde">
            <h2 className="font-primary font-bold text-lg text-inalde-text mb-1">Tabla 5-1 AACSB</h2>
            <p className="text-[12px] text-inalde-gray mb-4">Histórico de medidas directas del competency goal.</p>
            <TablaDinamica filas={data.aacsb} vacio="Sin medidas directas registradas." />
          </section>

          {/* Registro histórico acumulado — conclusiones de ciclo */}
          <section className="card-inalde">
            <h2 className="font-primary font-bold text-lg text-inalde-text mb-1">Registro histórico acumulado</h2>
            <p className="text-[12px] text-inalde-gray mb-4">Conclusiones de ciclo por año y cohorte (closing the loop).</p>
            <TablaDinamica filas={data.conclusiones} vacio="Sin conclusiones de ciclo registradas." />
          </section>

          {/* Resumen de la cohorte actual — por trait */}
          <section className="card-inalde">
            <h2 className="font-primary font-bold text-lg text-inalde-text mb-1">Resumen de la cohorte actual</h2>
            <p className="text-[12px] text-inalde-gray mb-4">Resultados por trait de las mediciones firmadas de esta cohorte.</p>
            {data.resumen_actual.length === 0 ? (
              <p className="text-inalde-gray text-sm">Sin mediciones firmadas aún.</p>
            ) : (
              <div className="overflow-auto max-h-[72vh]">
                <table className="w-full border-collapse bg-white">
                  <thead>
                    <tr className="bg-inalde-text text-white">
                      {['Criterio', 'LO', 'n', '% on standard', 'Excede', 'Cumple', 'No cumple'].map((h, i) => (
                        <th key={i} className="text-left font-primary font-bold text-[0.68rem] tracking-widest uppercase px-3 py-2.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.resumen_actual.map((f, i) => (
                      <tr key={i} className="border-b border-inalde-gray-light align-top">
                        <td className="px-3 py-2.5 font-primary font-bold text-sm text-inalde-text">{f.criterio}</td>
                        <td className="px-3 py-2.5 text-[0.8rem] text-inalde-gray">{f.lo}</td>
                        <td className="px-3 py-2.5 text-[0.8rem] text-inalde-gray">{f.n}</td>
                        <td className="px-3 py-2.5 text-[0.8rem] font-semibold text-inalde-text">{f.pct_on_standard}%</td>
                        <td className="px-3 py-2.5 text-[0.8rem] text-green-700">{f.excede}</td>
                        <td className="px-3 py-2.5 text-[0.8rem] text-inalde-gray">{f.cumple}</td>
                        <td className="px-3 py-2.5 text-[0.8rem] text-inalde-red">{f.no_cumple}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Generar reporte Word */}
          <section className="card-inalde">
            <h2 className="font-primary font-bold text-lg text-inalde-text mb-1">Generar reporte Word</h2>
            <p className="text-[12px] text-inalde-gray mb-4">Complete los campos narrativos (opcionales) y descargue el reporte en formato .docx.</p>

            <div className="space-y-4 max-w-3xl">
              <div>
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Nota de contexto del período (profesor)</label>
                <textarea value={notaContexto} onChange={(e) => setNotaContexto(e.target.value)} rows={3} className="input-inalde" placeholder="Contexto del período académico medido…" />
              </div>
              <div>
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Lectura de impacto / closing the loop</label>
                <textarea value={lecturaImpacto} onChange={(e) => setLecturaImpacto(e.target.value)} rows={3} className="input-inalde" placeholder="Interpretación de los resultados y acciones de mejora aplicadas…" />
              </div>
              <div>
                <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Acciones para el siguiente ciclo (profesor)</label>
                <textarea value={accionesSiguiente} onChange={(e) => setAccionesSiguiente(e.target.value)} rows={3} className="input-inalde" placeholder="Acciones planificadas para el próximo ciclo de medición…" />
              </div>
            </div>

            {errorWord && <p className="text-inalde-red text-sm mt-4">{errorWord}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={generarWord} disabled={generando} className="btn-inalde-primary disabled:opacity-60 disabled:cursor-not-allowed">
                {generando ? 'Generando…' : 'Descargar reporte Word'}
              </button>
              <button type="button" onClick={descargarExcel} disabled={generando}
                className="font-primary font-bold text-xs uppercase tracking-wider border-2 border-inalde-blue text-inalde-blue px-4 py-2 rounded hover:bg-inalde-blue hover:text-white disabled:opacity-60 disabled:cursor-not-allowed">
                Descargar Excel
              </button>
              <button type="button" onClick={cerrarCiclo} disabled={generando}
                className="font-primary font-bold text-xs uppercase tracking-wider border-2 border-inalde-gold text-inalde-gold px-4 py-2 rounded hover:bg-inalde-gold hover:text-white disabled:opacity-60 disabled:cursor-not-allowed">
                Cerrar ciclo y archivar
              </button>
            </div>
            {msgArchivo && <p className="text-inalde-blue text-sm mt-3">{msgArchivo}</p>}

            <p className="text-[11px] text-inalde-gray mt-4">
              «Cerrar ciclo y archivar» descarga el paquete de cierre (Word + datos brutos + trazabilidad) para tus registros. El archivo permanente del ciclo vive en la base de datos.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
