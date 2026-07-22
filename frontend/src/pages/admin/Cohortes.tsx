import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Hito {
  posicion: number;
  nombre: string;
  fecha: string | null;
}

interface Cohorte {
  id: string;
  etiqueta: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_limite_formacion_equipos: string | null;
  fecha_limite_entrega_anteproyecto: string | null;
  fecha_reunion_1: string | null;
  fecha_limite_seleccion_definitivo: string | null;
  fecha_limite_proyecto_final: string | null;
  fecha_limite_avance: string | null;
  activa: boolean;
  participantes_count: number;
  equipos_count: number;
  hitos: Hito[];
}

const fechaFields = [
  ['fecha_limite_formacion_equipos',     'Cierre formación de equipos'],
  ['fecha_limite_entrega_anteproyecto',  'Cierre entrega anteproyecto'],
  ['fecha_reunion_1',                    'Reunión 1'],
  ['fecha_limite_seleccion_definitivo',  'Cierre selección definitivo'],
  ['fecha_limite_proyecto_final',        'Cierre entrega proyecto de grado'],
  ['fecha_limite_avance',                'Entrega intermedia — avance (Caso / Proy. Investigación)'],
] as const;

function toLocal(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function toIso(local: string) {
  return local ? new Date(local).toISOString() : null;
}

/**
 * Orden FS/INT alternado por año.
 * Primero todas las del año más antiguo: FS antes que INT. Luego siguiente año, etc.
 * IDs con formato: "{tipo}-{aa}-{aa}" donde tipo ∈ {fs, int}.
 */
function sortCohortes(arr: Cohorte[]): Cohorte[] {
  return [...arr].sort((a, b) => {
    const parseId = (id: string) => {
      const m = id.toLowerCase().match(/^(fs|int|mba_fs|mba_int)-(\d{2})-(\d{2})/);
      if (!m) return { tipo: 'zzz', anio: 9999, original: id };
      const tipoNorm = m[1].endsWith('fs') ? 'fs' : 'int';
      return { tipo: tipoNorm, anio: parseInt(m[2], 10), original: id };
    };
    const pa = parseId(a.id);
    const pb = parseId(b.id);
    if (pa.anio !== pb.anio) return pa.anio - pb.anio;
    if (pa.tipo !== pb.tipo) return pa.tipo === 'fs' ? -1 : 1;
    return pa.original.localeCompare(pb.original);
  });
}

export default function Cohortes() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Cohorte>>({});
  const [hitosDraft, setHitosDraft] = useState<Hito[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  // Acordeon: ids de cohortes con detalle expandido. Por defecto todas
  // contraidas (solo se ve el encabezado). Click en la fila -> toggle.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const ordenadas = useMemo(() => sortCohortes(cohortes), [cohortes]);

  async function load() {
    setLoading(true);
    try { setCohortes((await api.get('/admin/cohortes')).data); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function startEdit(c: Cohorte) {
    setEditing(c.id);
    setDraft({ ...c });
    setHitosDraft(c.hitos ?? []);
    setMsg(null);
    // Asegura que el contenido este visible al entrar a editar
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(c.id);
      return next;
    });
  }

  function updateHito(posicion: number, fecha: string) {
    setHitosDraft((prev) => prev.map((h) => h.posicion === posicion ? { ...h, fecha: fecha || null } : h));
  }

  async function save() {
    if (!editing) return;
    try {
      const payload: Record<string, any> = { activa: draft.activa };
      for (const [k] of fechaFields) {
        const v = (draft as any)[k];
        payload[k] = v ? new Date(v).toISOString() : null;
      }
      payload.hitos = hitosDraft.map((h) => ({ posicion: h.posicion, fecha: h.fecha || null }));
      await api.put(`/admin/cohortes/${editing}`, payload);
      setMsg({ kind: 'ok', text: `Cohorte ${editing} actualizada.` });
      setEditing(null);
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    }
  }

  async function toggleActiva(c: Cohorte) {
    setMsg(null);
    try {
      await api.put(`/admin/cohortes/${c.id}`, { activa: !c.activa });
      setMsg({ kind: 'ok', text: `Cohorte ${c.id} ${!c.activa ? 'activada' : 'desactivada'}.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    }
  }

  async function descargarPlantilla(cohorteId: string) {
    setMsg(null);
    try {
      const resp = await api.get(`/admin/cohortes/${cohorteId}/plantilla`, { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plantilla-cohorte-${cohorteId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    }
  }

  async function cargarExcel(cohorteId: string, file: File) {
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/admin/cohortes/${cohorteId}/cargar-excel`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const op = r.data?.operativas_actualizadas ?? 0;
      const hi = r.data?.hitos_actualizados ?? 0;
      setMsg({ kind: 'ok', text: `Excel cargado: ${op} fechas operativas y ${hi} hitos actualizados.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    }
  }

  async function eliminar(c: Cohorte) {
    if (c.participantes_count > 0 || c.equipos_count > 0) {
      setMsg({ kind: 'err', text: `No se puede borrar "${c.etiqueta}": tiene ${c.participantes_count} participante(s) y ${c.equipos_count} equipo(s). Bórralos primero.` });
      return;
    }
    if (!confirm(`¿Borrar la cohorte "${c.etiqueta}" (${c.id})? Esta acción es irreversible.`)) return;
    setMsg(null);
    try {
      await api.delete(`/admin/cohortes/${c.id}`);
      setMsg({ kind: 'ok', text: `Cohorte ${c.id} eliminada.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Cohortes y fechas del Scheduler</h1>
        <p className="text-sm text-inalde-gray mt-2">
          Configura las fechas límite operativas y el cronograma de 13 hitos por cohorte.
        </p>
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <div className="space-y-4">
          {ordenadas.map((c) => {
            const isOpen = expanded.has(c.id) || editing === c.id;
            return (
            <div key={c.id} className="border border-inalde-gray-light rounded">
              <div
                role="button"
                tabIndex={0}
                onClick={() => editing === c.id ? undefined : toggleExpand(c.id)}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && editing !== c.id) { e.preventDefault(); toggleExpand(c.id); } }}
                className={`flex items-center justify-between p-4 bg-inalde-gray-bg ${editing === c.id ? '' : 'cursor-pointer hover:bg-inalde-gray-bg/70'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    aria-hidden
                    className={`inline-block text-inalde-gray transition-transform select-none ${isOpen ? 'rotate-90' : ''}`}>
                    ▶
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-primary font-bold text-inalde-text">{c.etiqueta}</h2>
                    <p className="text-xs text-inalde-gray mt-1">
                      {c.id} · {c.participantes_count} participantes · {c.equipos_count} equipos
                      {' · '}<span className={c.activa ? 'text-inalde-blue' : 'text-inalde-gray'}>{c.activa ? 'activa' : 'inactiva'}</span>
                    </p>
                  </div>
                </div>
                {editing === c.id ? (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setEditing(null)} className="text-sm text-inalde-gray hover:text-inalde-text">Cancelar</button>
                    <button onClick={save} className="btn-inalde-primary !py-2 !px-4 !text-xs">Guardar</button>
                  </div>
                ) : (
                  // Grid de 3 columnas de ancho fijo para que las acciones de
                  // todas las cohortes queden alineadas verticalmente, sin
                  // importar el largo del label (Desactivar vs Activar) ni si
                  // 'Borrar' aplica o no. El slot de Borrar se reserva con
                  // `invisible` cuando la cohorte no es borrable.
                  <div
                    className="grid grid-cols-[110px_90px_60px] gap-3 items-center justify-items-center"
                    onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => toggleActiva(c)}
                      title={c.activa ? 'Desactivar cohorte (no recibe más participantes)' : 'Reactivar cohorte'}
                      className={`w-full text-xs font-semibold px-3 py-1.5 rounded border transition ${c.activa
                        ? 'border-inalde-gray-light text-inalde-gray hover:border-inalde-gray hover:text-inalde-text'
                        : 'border-inalde-blue text-inalde-blue hover:bg-inalde-blue/10'}`}>
                      {c.activa ? 'Desactivar' : 'Activar'}
                    </button>
                    <button onClick={() => startEdit(c)} className="text-sm font-semibold text-inalde-red hover:text-inalde-red-hover">Editar →</button>
                    <button
                      onClick={() => eliminar(c)}
                      disabled={c.participantes_count > 0 || c.equipos_count > 0}
                      title={c.participantes_count > 0 || c.equipos_count > 0 ? 'No se puede borrar: la cohorte tiene participantes o equipos.' : 'Borrar cohorte (solo si está vacía)'}
                      className={`text-xs font-semibold transition ${c.participantes_count === 0 && c.equipos_count === 0
                        ? 'text-inalde-gray hover:text-inalde-red cursor-pointer'
                        : 'invisible'}`}>
                      Borrar
                    </button>
                  </div>
                )}
              </div>

              {isOpen && editing === c.id && (
                <div className="p-4 space-y-5 border-t border-inalde-gray-light">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!draft.activa} onChange={(e) => setDraft({ ...draft, activa: e.target.checked })} />
                    Cohorte activa
                  </label>

                  {/* === Carga por Excel ============================== */}
                  <div className="rounded border border-dashed border-inalde-gold/60 bg-amber-50/40 p-4">
                    <p className="font-primary font-bold text-xs tracking-wider uppercase text-inalde-text mb-2">
                      Carga rápida por Excel
                    </p>
                    <p className="text-sm text-inalde-gray mb-3">
                      Descarga la plantilla con las fechas actuales, edítala y súbela. Lo que dejes
                      vacío en la columna «Nueva fecha» no se modifica.
                    </p>
                    <div className="flex flex-wrap gap-3 items-center">
                      <button
                        onClick={() => descargarPlantilla(c.id)}
                        className="text-xs font-semibold px-4 py-2 rounded border-2 border-inalde-gold text-inalde-text hover:bg-inalde-gold/10 transition">
                        Descargar plantilla →
                      </button>
                      <label className="text-xs font-semibold px-4 py-2 rounded bg-inalde-gold text-white hover:opacity-90 transition cursor-pointer inline-block">
                        Cargar Excel
                        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) cargarExcel(c.id, f);
                            e.target.value = '';
                          }} />
                      </label>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-primary font-bold text-xs tracking-wider uppercase text-inalde-text mb-3">
                      Fechas operativas (Business Plan)
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {fechaFields.map(([k, label]) => (
                        <div key={k}>
                          <label className="block font-primary font-semibold text-[11px] tracking-wider uppercase text-inalde-gray mb-1">{label}</label>
                          <input type="datetime-local"
                            value={toLocal((draft as any)[k] ?? null)}
                            onChange={(e) => setDraft({ ...draft, [k]: toIso(e.target.value) } as any)}
                            className="input-inalde !py-2" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-primary font-bold text-xs tracking-wider uppercase text-inalde-text mb-3">
                      Cronograma — 13 hitos
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {hitosDraft.map((h) => (
                        <div key={h.posicion}>
                          <label className="block font-primary font-semibold text-[11px] tracking-wider uppercase text-inalde-gray mb-1">
                            {h.posicion}. {h.nombre}
                          </label>
                          <input type="date"
                            value={h.fecha ?? ''}
                            onChange={(e) => updateHito(h.posicion, e.target.value)}
                            className="input-inalde !py-2" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {isOpen && editing !== c.id && (
                <div className="p-4 space-y-4 text-xs border-t border-inalde-gray-light">
                  <div className="grid sm:grid-cols-2 gap-2">
                    {fechaFields.map(([k, label]) => {
                      const v = (c as any)[k];
                      return (
                        <div key={k} className="flex justify-between border-b border-inalde-gray-light/50 py-1">
                          <span className="text-inalde-gray">{label}</span>
                          <span className="text-inalde-text">{v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : <span className="text-inalde-gray italic">no definida</span>}</span>
                        </div>
                      );
                    })}
                  </div>

                  {c.hitos && c.hitos.length > 0 && (
                    <div>
                      <p className="font-primary font-bold text-[11px] tracking-wider uppercase text-inalde-text mb-2">Cronograma</p>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {c.hitos.map((h) => (
                          <div key={h.posicion} className="flex justify-between border-b border-inalde-gray-light/50 py-1">
                            <span className="text-inalde-gray">{h.posicion}. {h.nombre}</span>
                            <span className="text-inalde-text">
                              {h.fecha
                                ? new Date(h.fecha + 'T00:00:00').toLocaleDateString('es-CO', { dateStyle: 'medium' })
                                : <span className="text-inalde-gray italic">—</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </>
  );
}
