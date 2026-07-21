import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { formatBackendError } from '../../../lib/errors';

// Actas de Grado — firma en lote (dentro de /admin, sin Header propio). Cada
// firmante firma TODAS sus actas de una sola vez ("un solo acto"). El proveedor
// de firma puede estar en modo simulación (stub).

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';

interface ActaLote { id: string; participante: string; modalidad: Modalidad; estado: string; }
interface FirmanteLote { rol: string; nombre: string; actas: ActaLote[]; }
interface Data { proveedor: { nombre: string; es_stub: boolean }; firmantes: FirmanteLote[]; }
interface Cohorte { id: string; etiqueta: string; activa: boolean; }

const MODALIDAD: Record<Modalidad, { corto: string; pill: string }> = {
  business_plan: { corto: 'BP', pill: 'bg-inalde-text text-white' },
  caso: { corto: 'Caso', pill: 'bg-inalde-blue text-white' },
  proyecto_investigacion: { corto: 'PI', pill: 'bg-purple-700 text-white' },
};

export default function FirmaLote() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [firmandoKey, setFirmandoKey] = useState('');

  useEffect(() => { (async () => {
    try {
      const r = await api.get('/admin/cohortes');
      const activas = (r.data as Cohorte[]).filter((c) => c.activa);
      setCohortes(activas);
      if (activas[0]) setCohorte(activas[0].id);
    } catch { /* noop */ }
  })(); }, []);

  const cargar = useCallback(async () => {
    if (!cohorte) return;
    setLoading(true); setErr(''); setData(null);
    try {
      const r = await api.get(`/actas/lote/${cohorte}`);
      setData(r.data as Data);
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setLoading(false);
    }
  }, [cohorte]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function firmar(f: FirmanteLote) {
    const key = `${f.rol}::${f.nombre}`;
    setFirmandoKey(key); setErr(''); setOkMsg('');
    try {
      await api.post(`/actas/lote/${cohorte}/firmar`, { rol: f.rol, nombre: f.nombre });
      setOkMsg(`${f.nombre} firmó sus actas.`);
      await cargar();
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setFirmandoKey('');
    }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
        <p className="section-subtitle mb-2">Actas de grado · Firma en lote</p>
        <h1 className="section-title">Firma en lote de actas</h1>
        <p className="text-sm text-inalde-gray mt-2">Cada firmante firma todas sus actas pendientes de una sola vez, en un solo acto.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="max-w-xs flex-1">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte activa</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde">
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
        <Link to="/admin/actas" className="btn-inalde-ghost">← Volver al panel</Link>
      </div>

      {err && <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">{err}</div>}
      {okMsg && <div className="mb-6 rounded border-l-4 border-green-600 bg-green-50 px-4 py-3 text-sm text-green-800">{okMsg}</div>}

      {loading && <p className="text-inalde-gray text-sm">Cargando…</p>}

      {data && (
        <>
          {data.proveedor.es_stub && (
            <div className="mb-6 rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm text-inalde-text">
              <strong>Proveedor de firma no configurado</strong> — flujo en modo simulación. Las firmas se registran en el sistema pero no se envían a un proveedor real ({data.proveedor.nombre}).
            </div>
          )}

          {data.firmantes.length === 0 ? (
            <p className="text-inalde-gray text-sm">No hay firmantes con actas pendientes en esta cohorte.</p>
          ) : (
            <div className="grid gap-5">
              {data.firmantes.map((f) => {
                const key = `${f.rol}::${f.nombre}`;
                const n = f.actas.length;
                return (
                  <div key={key} className="card-inalde p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                      <div>
                        <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">{f.rol}</p>
                        <p className="font-primary font-bold text-lg text-inalde-text">{f.nombre}</p>
                      </div>
                      <span className="text-sm text-inalde-gray"><strong className="text-inalde-red text-lg">{n}</strong> acta{n === 1 ? '' : 's'} pendiente{n === 1 ? '' : 's'}</span>
                    </div>

                    <ul className="flex flex-col gap-1 mb-5">
                      {f.actas.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 text-sm text-inalde-text border-b border-inalde-gray-light last:border-b-0 py-1.5">
                          <span className={`text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${MODALIDAD[a.modalidad].pill}`}>{MODALIDAD[a.modalidad].corto}</span>
                          <span className="flex-1">{a.participante}</span>
                          <span className="text-[10px] uppercase tracking-wider text-inalde-gray">{a.estado}</span>
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      className="btn-inalde-primary w-full text-base py-4"
                      onClick={() => firmar(f)}
                      disabled={firmandoKey === key || n === 0}
                    >
                      {firmandoKey === key ? 'Firmando…' : `FIRMAR LAS ${n} ACTA${n === 1 ? '' : 'S'} — UN SOLO ACTO`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="mt-10 pt-6 border-t border-inalde-gray-light">
        <Link to="/admin/actas" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel</Link>
      </div>
    </>
  );
}
