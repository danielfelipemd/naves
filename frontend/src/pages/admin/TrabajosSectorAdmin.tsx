import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Administración de la vista de trabajos por sector (Comentario 13):
//  - fija/borra la clave de acceso público de la cohorte,
//  - marca proyectos como confidenciales,
//  - previsualiza la vista y muestra el enlace público para compartir.

interface Cohorte { id: string; etiqueta: string; activa: boolean; }
interface Item { proyecto_id: string; proyecto: string; autores: string; sector: string; confidencial: boolean; logo_url: string | null; one_pager_url: string | null; }
interface Grupo { sector: string; proyectos: Item[]; }
interface Data { cohorte_id: string; etiqueta: string; clave_configurada: boolean; sectores: Grupo[]; }

export default function TrabajosSectorAdmin() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [clave, setClave] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { (async () => {
    try {
      const r = await api.get('/admin/cohortes');
      const activas = (r.data as Cohorte[]).filter((c) => c.activa);
      setCohortes(activas);
      if (activas[0]) setCohorte(activas[0].id);
    } catch { /* noop */ }
  })(); }, []);

  async function cargar(id: string) {
    if (!id) return;
    setLoading(true); setData(null);
    try { const r = await api.get(`/trabajos-sector/admin/${id}`); setData(r.data); }
    catch { setMsg('No se pudo cargar la cohorte.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (cohorte) cargar(cohorte); /* eslint-disable-next-line */ }, [cohorte]);

  async function guardarClave() {
    setMsg(null);
    try {
      const r = await api.post(`/trabajos-sector/admin/${cohorte}/clave`, { clave });
      setClave('');
      setMsg(r.data.clave_configurada ? 'Clave actualizada.' : 'Vista cerrada (sin clave).');
      cargar(cohorte);
    } catch { setMsg('No se pudo guardar la clave.'); }
  }

  async function toggleConfidencial(p: Item) {
    try {
      await api.post(`/trabajos-sector/admin/proyecto/${p.proyecto_id}/confidencial`, { confidencial: !p.confidencial });
      cargar(cohorte);
    } catch { setMsg('No se pudo cambiar la confidencialidad.'); }
  }

  const enlacePublico = `${window.location.origin}/trabajos/${cohorte}`;

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
        <p className="section-subtitle mb-2">Administración</p>
        <h1 className="section-title">Trabajos por sector (vista pública)</h1>
        <p className="text-sm text-inalde-gray mt-2">Organiza los trabajos definitivos por sector, protégelos con una clave y marca los confidenciales.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div className="flex-1 max-w-xs">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte activa</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde">
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
      </div>

      {/* Clave de acceso + enlace */}
      <div className="bg-inalde-gray-bg/50 rounded-lg p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${data?.clave_configurada ? 'bg-green-100 text-green-800' : 'bg-inalde-gray-bg text-inalde-gray'}`}>
            {data?.clave_configurada ? '● Vista abierta con clave' : '○ Vista cerrada'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 max-w-xs">
            <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Nueva clave</label>
            <input type="text" value={clave} onChange={(e) => setClave(e.target.value)} placeholder={data?.clave_configurada ? 'Escribe para cambiarla' : 'Define una clave'} className="input-inalde" />
          </div>
          <button onClick={guardarClave} disabled={!clave} className="btn-inalde-primary !py-2 !text-xs disabled:opacity-40 disabled:cursor-not-allowed">Guardar clave</button>
          {data?.clave_configurada && (
            <button onClick={() => { setClave(''); api.post(`/trabajos-sector/admin/${cohorte}/clave`, { clave: '' }).then(() => { setMsg('Vista cerrada.'); cargar(cohorte); }); }}
              className="text-xs text-inalde-gray hover:text-inalde-red underline">Cerrar vista (quitar clave)</button>
          )}
        </div>
        {data?.clave_configurada && (
          <p className="text-xs text-inalde-gray mt-3">Enlace para compartir: <a href={enlacePublico} target="_blank" rel="noreferrer" className="text-inalde-red font-semibold hover:underline break-all">{enlacePublico}</a></p>
        )}
        {msg && <p className="text-xs text-inalde-blue mt-2">{msg}</p>}
      </div>

      {loading && <p className="text-inalde-gray text-sm">Cargando…</p>}

      {data && data.sectores.map((g) => (
        <section key={g.sector} className="mb-6">
          <h2 className="font-primary font-extrabold text-sm uppercase tracking-widest text-white bg-inalde-text rounded px-3 py-2 mb-3">
            {g.sector} <span className="text-white/60 font-semibold">· {g.proyectos.length}</span>
          </h2>
          <div className="divide-y divide-inalde-gray-light border border-inalde-gray-light rounded">
            {g.proyectos.map((p) => (
              <div key={p.proyecto_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-primary font-bold text-sm text-inalde-text truncate">{p.proyecto}</p>
                  <p className="text-xs text-inalde-gray truncate">{p.autores}</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-inalde-gray shrink-0 cursor-pointer">
                  <input type="checkbox" checked={p.confidencial} onChange={() => toggleConfidencial(p)} className="accent-inalde-red" />
                  Confidencial 🔒
                </label>
              </div>
            ))}
          </div>
        </section>
      ))}

      {data && data.sectores.length === 0 && !loading && (
        <p className="text-inalde-gray text-sm">Esta cohorte aún no tiene trabajos definitivos entregados.</p>
      )}
    </>
  );
}
