import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { formatBackendError } from '../../../lib/errors';

// Impresión de actas por lotes. La asistente del programa imprime y archiva en
// papel: necesita saber qué está listo para imprimir YA y, de lo que falta, a
// quién hay que perseguir. Las de Business Plan se cierran rápido; las de Caso
// dependen de varios directores, así que no se hace esperar al lote rápido.

interface ActaLista { id: number; participante: string; modalidad: string; completa_en: string | null; }
interface ActaPend extends ActaLista { faltan: Array<{ rol: string; nombre: string | null }>; }
interface Data {
  listas: { total: number; por_modalidad: Array<{ modalidad: string; total: number }>; actas: ActaLista[] };
  pendientes: { total: number; esperando: Array<{ quien: string; actas: number }>; actas: ActaPend[] };
}
interface Cohorte { id: string; etiqueta: string; activa: boolean; }

const MODALIDAD: Record<string, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Lotes() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState('');
  const [bajando, setBajando] = useState('');

  useEffect(() => { (async () => {
    try {
      const r = await api.get('/admin/cohortes');
      const activas = (r.data as Cohorte[]).filter((c) => c.activa);
      setCohortes(activas);
      if (activas[0]) setCohorte(activas[0].id);
    } catch { /* el selector queda vacío; el error se ve al cargar */ }
  })(); }, []);

  const cargar = useCallback(async () => {
    if (!cohorte) return;
    setCargando(true); setErr('');
    try { setData((await api.get(`/actas/lotes/${cohorte}`)).data as Data); }
    catch (e) { setErr(formatBackendError(e)); setData(null); }
    finally { setCargando(false); }
  }, [cohorte]);
  useEffect(() => { cargar(); }, [cargar]);

  async function descargar(modalidad?: string) {
    setBajando(modalidad ?? 'todas'); setErr('');
    try {
      const r = await api.get(`/actas/lotes/${cohorte}/pdf`, {
        params: modalidad ? { modalidad } : undefined,
        responseType: 'blob',
        timeout: 0, // un lote grande tarda; el tope de 15 s lo cortaría
      });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `actas-${cohorte}${modalidad ? `-${modalidad}` : ''}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(formatBackendError(e));
    } finally { setBajando(''); }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Actas de entrega de trabajo de grado</p>
        <h1 className="section-title">Impresión por lotes</h1>
        <p className="text-inalde-gray text-sm mt-2">
          Descarga en un solo PDF las actas que ya tienen todas las firmas, listas para imprimir y archivar.
        </p>
      </div>

      <div className="mb-6 max-w-[320px]">
        <label className="block text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Cohorte</label>
        <select className="input-inalde !py-2 !text-sm" value={cohorte} onChange={(e) => setCohorte(e.target.value)}>
          {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
        </select>
      </div>

      {err && <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm">{err}</div>}
      {cargando && <p className="text-inalde-gray text-sm">Cargando…</p>}

      {data && (
        <>
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Listas para imprimir */}
            <div className="card-inalde p-5 border-l-4 border-l-green-600">
              <div className="flex items-baseline gap-3 mb-1">
                <span className="font-primary font-extrabold text-3xl text-green-700">{data.listas.total}</span>
                <span className="text-xs uppercase tracking-wider font-semibold text-inalde-gray">
                  listas para imprimir
                </span>
              </div>
              <p className="text-xs text-inalde-gray mb-4">Con todas las firmas completas.</p>

              {data.listas.total === 0 ? (
                <p className="text-sm text-inalde-gray italic">Todavía no hay actas con todas las firmas.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button type="button" className="btn-inalde-primary !py-2 !px-4 !text-xs"
                      onClick={() => descargar()} disabled={!!bajando}>
                      {bajando === 'todas' ? 'Preparando…' : `↓ Descargar las ${data.listas.total}`}
                    </button>
                    {/* Por modalidad: en papel se archivan separadas. */}
                    {data.listas.por_modalidad.length > 1 && data.listas.por_modalidad.map((m) => (
                      <button key={m.modalidad} type="button" className="btn-inalde-secondary !py-2 !px-4 !text-xs"
                        onClick={() => descargar(m.modalidad)} disabled={!!bajando}>
                        {bajando === m.modalidad ? 'Preparando…' : `↓ ${MODALIDAD[m.modalidad] ?? m.modalidad} (${m.total})`}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-[220px] overflow-auto divide-y divide-inalde-gray-light">
                    {data.listas.actas.map((a) => (
                      <div key={a.id} className="py-1.5 flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate">{a.participante}</span>
                        <span className="text-inalde-gray whitespace-nowrap">{fmt(a.completa_en)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Pendientes: a quién se espera */}
            <div className="card-inalde p-5 border-l-4 border-l-inalde-gold">
              <div className="flex items-baseline gap-3 mb-1">
                <span className="font-primary font-extrabold text-3xl text-inalde-gold">{data.pendientes.total}</span>
                <span className="text-xs uppercase tracking-wider font-semibold text-inalde-gray">
                  esperando firmas
                </span>
              </div>
              <p className="text-xs text-inalde-gray mb-4">No se pueden imprimir todavía.</p>

              {data.pendientes.total === 0 ? (
                <p className="text-sm text-inalde-gray italic">No queda nada pendiente.</p>
              ) : (
                <div className="space-y-2">
                  {data.pendientes.esperando.map((e, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 border-b border-inalde-gray-light pb-1.5">
                      <span className="text-sm text-inalde-text truncate">{e.quien}</span>
                      <span className="text-xs font-semibold text-inalde-gold whitespace-nowrap">
                        {e.actas} acta{e.actas === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <Link to="/admin/actas" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel de actas</Link>
    </>
  );
}
