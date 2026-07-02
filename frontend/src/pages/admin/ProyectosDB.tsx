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
  tiene_one_pager: boolean; tiene_logo: boolean;
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
  const [iaOn, setIaOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');            // proyecto_id generándose
  const [bulk, setBulk] = useState('');            // mensaje de generación masiva
  const [bulkLoad, setBulkLoad] = useState(false);
  const [editId, setEditId] = useState('');        // proyecto_id en edición
  const [edR, setEdR] = useState('');
  const [edL, setEdL] = useState('');

  useEffect(() => { (async () => {
    setCohortes(((await api.get('/admin/cohortes')).data as Cohorte[]).filter((c) => c.activa));
    try { setIaOn((await api.get('/proyectos-db/admin/estado-ia')).data.configurada); } catch { setIaOn(false); }
  })(); }, []);

  async function load() {
    if (!cohorte) { setProyectos([]); setDias([]); return; }
    setLoading(true); setErr('');
    try {
      const { data } = await api.get(`/proyectos-db/admin/${cohorte}`);
      setProyectos(data.proyectos ?? []); setDias(data.dias ?? []); setEvento(data.evento ?? 'NAVES');
    } catch (e: any) { setErr(formatBackendError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { setDia('all'); setEditId(''); setBulk(''); load(); }, [cohorte]);

  const filtrados = useMemo(() => proyectos.filter((p) => {
    const okDia = dia === 'all' || p.fecha === dia;
    const t = `${p.proyecto} ${p.autores} ${p.sector}`.toLowerCase();
    return okDia && (!q || t.includes(q.toLowerCase()));
  }), [proyectos, dia, q]);

  async function copiar(id: string, texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopied(id); setTimeout(() => setCopied(''), 2000); } catch { /* noop */ }
  }

  async function generar(p: Proyecto, force = false) {
    if (!p.proyecto_id) return;
    setBusy(p.proyecto_id); setErr('');
    try {
      await api.post(`/proyectos-db/admin/proyecto/${p.proyecto_id}/generar-contenido`, { force });
      await load();
    } catch (e: any) { setErr(errorLegible(e)); }
    finally { setBusy(''); }
  }

  async function generarTodo() {
    setBulkLoad(true); setBulk(''); setErr('');
    try {
      const { data } = await api.post(`/proyectos-db/admin/${cohorte}/generar-todo`, {});
      setBulk(`Generados ${data.generados}, saltados ${data.saltados}${data.sin_fuente ? `, sin material ${data.sin_fuente}` : ''}${data.errores ? `, errores ${data.errores}` : ''} (de ${data.total}).`);
      await load();
    } catch (e: any) { setErr(errorLegible(e)); }
    finally { setBulkLoad(false); }
  }

  function abrirEdicion(p: Proyecto) { setEditId(p.proyecto_id ?? ''); setEdR(p.resumen ?? ''); setEdL(p.linkedin ?? ''); }
  async function guardar(p: Proyecto, aprobado: boolean) {
    if (!p.proyecto_id) return;
    setBusy(p.proyecto_id); setErr('');
    try {
      await api.put(`/proyectos-db/admin/proyecto/${p.proyecto_id}/contenido`, { resumen: edR, linkedin: edL, aprobado });
      setEditId(''); await load();
    } catch (e: any) { setErr(errorLegible(e)); }
    finally { setBusy(''); }
  }

  async function subirAsset(p: Proyecto, tipo: 'logo' | 'one_pager', file: File) {
    if (!p.proyecto_id) return;
    setBusy(p.proyecto_id + tipo); setErr('');
    try {
      const fd = new FormData(); fd.append('archivo', file); fd.append('tipo', tipo);
      await api.post(`/proyectos-db/admin/proyecto/${p.proyecto_id}/asset`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } catch (e: any) { setErr(errorLegible(e)); }
    finally { setBusy(''); }
  }
  async function quitarAsset(p: Proyecto, tipo: 'logo' | 'one_pager') {
    if (!p.proyecto_id || !confirm('¿Quitar este archivo?')) return;
    setBusy(p.proyecto_id + tipo); setErr('');
    try { await api.delete(`/proyectos-db/admin/proyecto/${p.proyecto_id}/asset?tipo=${tipo}`); await load(); }
    catch (e: any) { setErr(errorLegible(e)); }
    finally { setBusy(''); }
  }

  const conHorario = proyectos.filter((p) => p.fecha).length;
  const conContenido = proyectos.filter((p) => p.resumen).length;
  const aprobados = proyectos.filter((p) => p.contenido_aprobado).length;

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Base de datos de proyectos</h1>
        <p className="text-sm text-inalde-gray mt-2">Vista interna de los proyectos de la cohorte. Genera con IA el resumen y el post de LinkedIn de cada proyecto (leyendo su información real), revísalos y apruébalos. Exporta a Excel.</p>
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
          <>
            <button onClick={() => downloadFile(`/proyectos-db/admin/${cohorte}/excel`, `${evento.replace(/[^\w-]/g, '_')}_BaseDatos.xlsx`)} className="btn-inalde-secondary !py-2 !px-4 !text-xs">↓ Descargar Excel</button>
            <button onClick={generarTodo} disabled={bulkLoad || iaOn === false} title={iaOn === false ? 'IA no configurada en el servidor' : ''} className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-50">{bulkLoad ? 'Generando…' : '✨ Generar contenido faltante con IA'}</button>
          </>
        )}
      </div>

      {iaOn === false && <div className="rounded border-l-4 border-inalde-gold bg-inalde-gold/10 px-4 py-3 text-sm mb-4">La generación con IA está deshabilitada: falta configurar <code>ANTHROPIC_API_KEY</code> en el servidor. El resto de la página funciona normalmente.</div>}
      {bulk && <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm mb-4">{bulk}</div>}
      {err && <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-4">{err}</div>}

      {!cohorte ? null : loading ? <p className="text-inalde-gray">Cargando…</p> : proyectos.length === 0 ? (
        <p className="text-inalde-gray text-sm">Esta cohorte no tiene proyectos.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center mb-3">
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
          <p className="text-xs text-inalde-gray mb-3">Mostrando {filtrados.length} de {proyectos.length} · {conHorario} con horario · {conContenido} con contenido · {aprobados} aprobados.</p>

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
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-primary font-bold text-inalde-text">{p.proyecto}</h3>
                      {p.contenido_aprobado && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">✓ Aprobado</span>}
                      {p.resumen && !p.contenido_aprobado && <span className="text-[10px] px-2 py-0.5 rounded-full bg-inalde-gold/20 text-inalde-text font-semibold">Borrador IA</span>}
                    </div>
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
                  <div className="flex flex-col gap-1.5 shrink-0 items-end">
                    {p.one_pager_url && <a href={p.one_pager_url} target="_blank" rel="noreferrer" className="text-xs text-inalde-red font-semibold hover:underline">Ver One Pager →</a>}
                    {p.linkedin && (
                      <button onClick={() => copiar(p.equipo_id, p.linkedin!)} className={`text-xs font-semibold px-2 py-1 rounded ${copied === p.equipo_id ? 'bg-green-100 text-green-700' : 'bg-inalde-gray-bg text-inalde-gray hover:text-inalde-text'}`}>{copied === p.equipo_id ? '✓ Copiado' : 'Copiar LinkedIn'}</button>
                    )}
                    {p.proyecto_id && iaOn !== false && (
                      <div className="flex gap-1.5">
                        {!p.resumen ? (
                          <button onClick={() => generar(p)} disabled={busy === p.proyecto_id} className="text-xs font-semibold px-2 py-1 rounded bg-inalde-red text-white disabled:opacity-50">{busy === p.proyecto_id ? 'Generando…' : '✨ Generar IA'}</button>
                        ) : editId !== p.proyecto_id && (
                          <>
                            <button onClick={() => generar(p, true)} disabled={busy === p.proyecto_id} className="text-xs px-2 py-1 rounded bg-inalde-gray-bg text-inalde-gray disabled:opacity-50" title="Volver a generar con IA">{busy === p.proyecto_id ? '…' : '↻ Regenerar'}</button>
                            <button onClick={() => abrirEdicion(p)} className="text-xs px-2 py-1 rounded bg-inalde-gray-bg text-inalde-gray">Editar</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Archivos: logo + one pager (Módulo F) */}
                {p.proyecto_id && (
                  <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-inalde-gray-light/60">
                    {p.logo_url ? (
                      <img src={p.logo_url} alt="logo" className="h-8 w-8 rounded object-contain bg-white border border-inalde-gray-light" />
                    ) : <span className="text-[11px] text-inalde-gray/70">Sin logo</span>}
                    <label className="text-[11px] font-semibold text-inalde-red cursor-pointer hover:underline">
                      {busy === p.proyecto_id + 'logo' ? 'Subiendo…' : (p.tiene_logo ? 'Cambiar logo' : 'Subir logo')}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirAsset(p, 'logo', f); e.target.value = ''; }} />
                    </label>
                    {p.tiene_logo && <button onClick={() => quitarAsset(p, 'logo')} className="text-[11px] text-inalde-gray hover:text-inalde-red">quitar</button>}
                    <span className="text-inalde-gray-light">·</span>
                    <label className="text-[11px] font-semibold text-inalde-red cursor-pointer hover:underline">
                      {busy === p.proyecto_id + 'one_pager' ? 'Subiendo…' : (p.tiene_one_pager ? 'Cambiar One Pager' : 'Subir One Pager')}
                      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirAsset(p, 'one_pager', f); e.target.value = ''; }} />
                    </label>
                    {p.tiene_one_pager && <button onClick={() => quitarAsset(p, 'one_pager')} className="text-[11px] text-inalde-gray hover:text-inalde-red">quitar</button>}
                  </div>
                )}

                {/* Editor / contenido */}
                {editId === p.proyecto_id ? (
                  <div className="mt-3 border-t border-inalde-gray-light/60 pt-3 space-y-2">
                    <div>
                      <label className="block text-[10px] uppercase text-inalde-gray mb-1">Resumen</label>
                      <textarea value={edR} onChange={(e) => setEdR(e.target.value)} rows={2} className="input-inalde !py-2 w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase text-inalde-gray mb-1">Post LinkedIn</label>
                      <textarea value={edL} onChange={(e) => setEdL(e.target.value)} rows={6} className="input-inalde !py-2 w-full text-sm font-mono" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => guardar(p, true)} disabled={busy === p.proyecto_id} className="btn-inalde-primary !py-1.5 !px-3 !text-xs disabled:opacity-50">Guardar y aprobar</button>
                      <button onClick={() => guardar(p, false)} disabled={busy === p.proyecto_id} className="btn-inalde-secondary !py-1.5 !px-3 !text-xs disabled:opacity-50">Guardar como borrador</button>
                      <button onClick={() => setEditId('')} className="text-xs text-inalde-gray px-2">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {p.resumen && <p className="text-sm text-inalde-gray mt-2 border-t border-inalde-gray-light/60 pt-2">{p.resumen}</p>}
                    {!p.resumen && <p className="text-[11px] text-inalde-gray/70 italic mt-2 border-t border-inalde-gray-light/60 pt-2">Sin contenido de comunicaciones aún{iaOn !== false ? ' — usa “✨ Generar IA”.' : '.'}</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function errorLegible(e: any): string {
  const code = e?.response?.data?.error;
  if (code === 'SIN_FUENTE') return 'El proyecto no tiene información suficiente (canvas) para generar contenido sin inventar.';
  if (code === 'IA_NO_CONFIGURADA') return 'La IA no está configurada en el servidor (falta ANTHROPIC_API_KEY).';
  return formatBackendError(e);
}
