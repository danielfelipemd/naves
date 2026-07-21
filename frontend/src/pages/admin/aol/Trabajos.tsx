import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';

// AoL — Fase 2: pantalla "Trabajos por calificar" (§6). Lista los Business Plan
// definitivos de la cohorte con estado de entrega (4 archivos), análisis IA y AoL.

interface Entrega { bp: boolean; one_pager: boolean; logo: boolean; modelo: boolean; }
interface Trabajo {
  proyecto_id: string;
  proyecto: string;
  integrantes: string;
  entrega: Entrega;
  completa: boolean;
  estado_analisis: 'sin_entrega' | 'en_cola' | 'sugerencia' | 'revisar';
  estado_aol: 'pendiente' | 'calificado';
}
interface Data { cohorte_id: string; etiqueta: string; por_calificar: number; trabajos: Trabajo[]; }
interface Cohorte { id: string; etiqueta: string; activa: boolean; }

const TABS = [
  { to: '/admin/aol', label: 'Trabajos', activo: true },
  { to: '/admin/aol/dashboard', label: 'Dashboard', activo: false },
  { to: '/admin/aol/export', label: 'Export AACSB', activo: false },
];

function chipEntrega(ok: boolean, label: string) {
  return (
    <span className={`inline-block text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded mr-1 mb-1 ${
      ok ? 'bg-green-100 text-green-800' : 'bg-inalde-gray-bg text-inalde-gray line-through'
    }`}>{label}</span>
  );
}

export default function AolTrabajos() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { (async () => {
    try {
      const r = await api.get('/admin/cohortes');
      const activas = (r.data as Cohorte[]).filter((c) => c.activa);
      setCohortes(activas);
      if (activas[0]) setCohorte(activas[0].id);
    } catch { /* noop */ }
  })(); }, []);

  useEffect(() => { if (!cohorte) return; (async () => {
    setLoading(true); setData(null);
    try { const r = await api.get('/aol/trabajos', { params: { cohorte_id: cohorte } }); setData(r.data); }
    catch { /* noop */ }
    finally { setLoading(false); }
  })(); }, [cohorte]);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
        <p className="section-subtitle mb-2">Assurance of Learning</p>
        <h1 className="section-title">Trabajos por calificar</h1>
        <p className="text-sm text-inalde-gray mt-2">Medición del <strong>competency goal Entrepreneurship</strong> (direct measure) sobre los Business Plan definitivos de la cohorte.</p>
      </div>

      {/* Pestañas del módulo (las siguientes llegan en su fase) */}
      <div className="flex gap-1 mb-6 border-b border-inalde-gray-light">
        {TABS.map((t) => (
          <Link key={t.to} to={t.to}
            className={`px-4 py-2 text-sm font-primary font-semibold border-b-2 -mb-px ${
              t.activo ? 'border-inalde-red text-inalde-red' : 'border-transparent text-inalde-gray/60 hover:text-inalde-gray'
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
            <strong className="text-inalde-red text-lg">{data.por_calificar}</strong> por calificar · {data.trabajos.length} trabajos
          </span>
        )}
      </div>

      {loading && <p className="text-inalde-gray text-sm">Cargando…</p>}
      {data && data.trabajos.length === 0 && !loading && (
        <p className="text-inalde-gray text-sm">Esta cohorte aún no tiene Business Plan definitivos entregados.</p>
      )}

      {data && data.trabajos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse bg-white">
            <thead>
              <tr className="bg-inalde-text text-white">
                {['Proyecto', 'Integrantes', 'Entrega', 'Análisis IA', 'AoL', ''].map((h, i) => (
                  <th key={i} className="text-left font-primary font-bold text-[0.68rem] tracking-widest uppercase px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.trabajos.map((t) => (
                <tr key={t.proyecto_id} className="border-b border-inalde-gray-light align-top">
                  <td className="px-3 py-3 font-primary font-bold text-sm text-inalde-text">{t.proyecto}</td>
                  <td className="px-3 py-3 text-[0.8rem] text-inalde-gray max-w-[240px]">{t.integrantes || '—'}</td>
                  <td className="px-3 py-3">
                    {chipEntrega(t.entrega.bp, 'BP')}
                    {chipEntrega(t.entrega.one_pager, 'One-pager')}
                    {chipEntrega(t.entrega.logo, 'Logo')}
                    {chipEntrega(t.entrega.modelo, 'Modelo $')}
                  </td>
                  <td className="px-3 py-3">
                    {t.estado_analisis === 'revisar' ? (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-inalde-red">⚠ Revisar</span>
                    ) : t.estado_analisis === 'sugerencia' ? (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-inalde-blue">Sugerencia lista</span>
                    ) : t.estado_analisis === 'en_cola' ? (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gold">En cola</span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider text-inalde-gray">Falta entrega</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {t.estado_aol === 'calificado' ? (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-green-700">✓ Calificado</span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider text-inalde-gray">Pendiente</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <Link to={`/admin/aol/calificar/${t.proyecto_id}`} className="text-[10px] uppercase tracking-wider font-semibold text-inalde-red hover:text-inalde-red-hover">
                      {t.estado_aol === 'calificado' ? 'Ver →' : 'Calificar →'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-inalde-gray mt-3">
            El análisis IA se dispara automáticamente al completarse la entrega (los 4 archivos). La calificación y la firma llegan en la siguiente fase del módulo.
          </p>
        </div>
      )}
    </>
  );
}
