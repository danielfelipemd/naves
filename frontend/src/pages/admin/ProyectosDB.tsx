import { useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; activa: boolean; }
interface Dia { fecha: string; legible: string; }
interface Proyecto {
  equipo_id: string; proyecto_id: string | null; proyecto: string; autores: string; sector: string;
  fecha: string | null; fecha_legible: string | null; jornada: number | null; slot: number | null;
  hora_inicio: string | null; hora_fin: string | null;
  resumen: string | null; linkedin: string | null; one_pager_url: string | null; logo_url: string | null;
  contenido_aprobado: boolean;
}

export default function ProyectosDB() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [dias, setDias] = useState<Dia[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [evento, setEvento] = useState('NAVES');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [dia, setDia] = useState('all');
  const [copied, setCopied] = useState('');

  useEffect(() => { (async () => {
    setCohortes(((await api.get('/admin/cohortes')).data as Cohorte[]).filter((c) => c.activa));
  })(); }, []);

  useEffect(() => { (async () => {
    if (!cohorte) { setProyectos([]); setDias([]); return; }
    setLoading(true); setErr(''); setDia('all');
    try {
      const { data } = await api.get(`/proyectos-db/admin/${cohorte}`);
      setProyectos(data.proyectos ?? []); setDias(data.dias ?? []); setEvento(data.evento ?? 'NAVES');
    } catch (e: any) { setErr(formatBackendError(e)); }
    finally { setLoading(false); }
  })(); }, [cohorte]);

  const filtrados = useMemo(() => proyectos.filter((p) => {
    const okDia = dia === 'all' || p.fecha === dia;
    const t = `${p.proyecto} ${p.autores} ${p.sector}`.toLowerCase();
    return okDia && (!q || t.includes(q.toLowerCase()));
  }), [proyectos, dia, q]);

  async function copiar(id: string, texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopied(id); setTimeout(() => setCopied(''), 2000); } catch { /* noop */ }
  }

  const conHorario = proyectos.filter((p) => p.fecha).length;

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Base de datos de proyectos</h1>
        <p className="text-sm text-inalde-gray mt-2">Vista interna de los proyectos de la cohorte: horario de presentación, sector, autores, resumen y post de LinkedIn listos para copiar, y descarga a Excel.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
            <option value="">Selecciona…</option>
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
        {cohorte && proyectos.length > 0 && (
          <button onClick={() => downloadFile(`/proyectos-db/admin/${cohorte}/excel`, `${evento.replace(/[^\w-]/g, '_')}_BaseDatos.xlsx`)} className="btn-inalde-secondary !py-2 !px-4 !text-xs">↓ Descargar Excel</button>
        )}
      </div>

      {err && <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-4">{err}</div>}

      {!cohorte ? null : loading ? <p className="text-inalde-gray">Cargando…</p> : proyectos.length === 0 ? (
        <p className="text-inalde-gray text-sm">Esta cohorte no tiene proyectos.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por proyecto, autor o sector…" className="input-inalde !py-2 flex-1 min-w-[220px]" />
            {dias.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <button onClick={() => setDia('all')} className={`px-3 py-1.5 rounded text-xs font-semibold ${dia === 'all' ? 'bg-inalde-text text-white' : 'bg-inalde-gray-bg text-inalde-gray'}`}>Todos</button>
                {dias.map((d) => (
                  <button key={d.fecha} onClick={() => setDia(d.fecha)} className={`px-3 py-1.5 rounded text-xs font-semibold capitalize ${dia === d.fecha ? 'bg-inalde-text text-white' : 'bg-inalde-gray-bg text-inalde-gray'}`}>{d.legible.replace(/ de \d{4}$/, '')}</button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-inalde-gray mb-3">Mostrando {filtrados.length} de {proyectos.length} proyectos · {conHorario} con horario asignado.</p>

          <div className="space-y-3">
            {filtrados.map((p) => (
              <div key={p.equipo_id} className="border border-inalde-gray-light rounded-lg p-4">
                <div className="flex flex-wrap items-start gap-3">
                  {p.slot != null && (
                    <div className="text-center shrink-0">
                      <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-inalde-text text-white text-sm font-bold">{p.slot}</div>
                      <div className="text-[10px] text-inalde-gray mt-1 font-mono">{p.hora_inicio}</div>
                    </div>
                  )}
                  <div className="flex-1 min-w-[200px]">
                    <h3 className="font-primary font-bold text-inalde-text">{p.proyecto}</h3>
                    <p className="text-xs text-inalde-gray">{p.autores || '—'}</p>
                    <div className="flex flex-wrap gap-2 mt-1 text-[11px]">
                      {p.sector && <span className="px-2 py-0.5 rounded bg-inalde-gold/15 text-inalde-text">{p.sector}</span>}
                      {p.fecha_legible ? (
                        <span className="text-inalde-gray capitalize">🗓 {p.fecha_legible.replace(/ de \d{4}$/, '')} · Jornada {p.jornada} · {p.hora_inicio}–{p.hora_fin}</span>
                      ) : (
                        <span className="text-inalde-gray italic">Sin horario asignado</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {p.one_pager_url && <a href={p.one_pager_url} target="_blank" rel="noreferrer" className="text-xs text-inalde-red font-semibold hover:underline">Ver One Pager →</a>}
                    {p.linkedin && (
                      <button onClick={() => copiar(p.equipo_id, p.linkedin!)} className={`text-xs font-semibold px-2 py-1 rounded ${copied === p.equipo_id ? 'bg-green-100 text-green-700' : 'bg-inalde-gray-bg text-inalde-gray hover:text-inalde-text'}`}>{copied === p.equipo_id ? '✓ Copiado' : 'Copiar LinkedIn'}</button>
                    )}
                  </div>
                </div>
                {p.resumen && <p className="text-sm text-inalde-gray mt-2 border-t border-inalde-gray-light/60 pt-2">{p.resumen}</p>}
                {!p.resumen && !p.linkedin && <p className="text-[11px] text-inalde-gray/70 italic mt-2 border-t border-inalde-gray-light/60 pt-2">Sin contenido de comunicaciones aún — se generará en el módulo de contenido con IA.</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
