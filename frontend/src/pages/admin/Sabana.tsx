import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Cohorte { id: string; etiqueta: string; }
interface Profesor { id: string; nombre_completo: string; areas_afinidad: string[]; }
interface Item {
  equipo_id: string; equipo_nombre: string | null;
  proyecto_id: string; proyecto_nombre: string;
  sector: string | null; ciiu: string | null; tipo: string | null;
  estado_seleccion: string;
  resumen: string;
  miembros: Array<{ nombre: string; posicion: number }>;
}
interface Asignacion { equipo_id: string; profesor_id: string; }

export default function Sabana() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [snapshot, setSnapshot] = useState<Item[]>([]);
  const [profesores, setProfesores] = useState<Profesor[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<string, string>>({}); // equipo_id → profesor_id
  const [estadoSabana, setEstadoSabana] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { (async () => {
    setCohortes((await api.get('/admin/cohortes')).data);
    setProfesores((await api.get('/admin/profesores')).data.filter((p: any) => p.activo));
  })(); }, []);

  async function load() {
    if (!cohorte) return;
    setLoading(true); setMsg(null);
    try {
      const { data } = await api.get(`/sabana/${cohorte}`);
      setSnapshot(data?.snapshot ?? []);
      setEstadoSabana(data?.estado ?? null);
    } catch (e: any) {
      if (e?.response?.status === 404) {
        setSnapshot([]); setEstadoSabana(null);
      } else { setMsg({ kind: 'err', text: e.message }); }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [cohorte]);

  async function generar() {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/sabana/${cohorte}/generar`);
      await load();
      setMsg({ kind: 'ok', text: 'Sábana generada con datos actuales.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  async function sugerir() {
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post(`/sabana/${cohorte}/sugerir-asignacion`);
      const sugerencias: Array<{ equipo_id: string; top: Array<{ profesor_id: string; score: number }> }> = data.sugerencias ?? [];
      const newAsign = { ...asignaciones };
      for (const s of sugerencias) {
        if (s.top[0] && s.top[0].score > 0 && !newAsign[s.equipo_id]) {
          newAsign[s.equipo_id] = s.top[0].profesor_id;
        }
      }
      setAsignaciones(newAsign);
      setMsg({ kind: 'ok', text: 'Sugerencias aplicadas a equipos sin asignación previa.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  async function guardarAsignaciones() {
    const list: Asignacion[] = Object.entries(asignaciones)
      .filter(([, pid]) => !!pid)
      .map(([equipo_id, profesor_id]) => ({ equipo_id, profesor_id }));
    if (!list.length) { setMsg({ kind: 'err', text: 'No hay asignaciones para guardar.' }); return; }

    setBusy(true); setMsg(null);
    try {
      await api.post(`/admin/sabanas/${cohorte}/asignar`, { asignaciones: list });
      setMsg({ kind: 'ok', text: `${list.length} asignaciones guardadas.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  async function comunicar() {
    if (!confirm('Marcar la sábana como comunicada y notificar a los equipos? (envío SMTP real pendiente de configuración)')) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/sabanas/${cohorte}/comunicar`);
      setMsg({ kind: 'ok', text: data.nota ?? 'Comunicada.' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally { setBusy(false); }
  }

  // Agrupar por equipo
  const equipos = snapshot.reduce((acc, item) => {
    if (!acc[item.equipo_id]) {
      acc[item.equipo_id] = { id: item.equipo_id, nombre: item.equipo_nombre, miembros: item.miembros, proyectos: [] };
    }
    acc[item.equipo_id].proyectos.push(item);
    return acc;
  }, {} as Record<string, { id: string; nombre: string | null; miembros: any[]; proyectos: Item[] }>);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Sábana de proyectos</h1>
        <p className="text-sm text-inalde-gray mt-2">Vista consolidada de todos los anteproyectos enviados de una cohorte. Asigna profesores y comunica.</p>
      </div>

      <div className="flex gap-3 mb-6 items-end">
        <div className="flex-1 max-w-sm">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
            <option value="">Selecciona…</option>
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
        {cohorte && (
          <>
            <button onClick={generar} disabled={busy} className="btn-inalde-primary !py-2 !px-4 !text-xs">
              {snapshot.length ? 'Regenerar' : 'Generar sábana'}
            </button>
            {snapshot.length > 0 && (
              <>
                <button onClick={sugerir} disabled={busy} className="text-xs font-semibold text-inalde-red hover:text-inalde-red-hover">Sugerir asignaciones</button>
                <button onClick={guardarAsignaciones} disabled={busy} className="text-xs font-semibold text-inalde-blue hover:text-inalde-red">Guardar asignaciones</button>
                <button onClick={comunicar} disabled={busy} className="text-xs font-semibold text-inalde-gold hover:text-inalde-red">Comunicar →</button>
              </>
            )}
          </>
        )}
      </div>

      {estadoSabana && (
        <p className="text-xs text-inalde-gray mb-4">
          Estado de la sábana: <span className="font-semibold uppercase tracking-wider text-inalde-text">{estadoSabana}</span>
        </p>
      )}

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {loading ? <p className="text-inalde-gray">Cargando…</p> :
        Object.keys(equipos).length === 0 ? (
          cohorte && (
            <p className="text-inalde-gray text-sm">
              {snapshot.length === 0 && estadoSabana === null
                ? 'La sábana aún no ha sido generada para esta cohorte. Genera para construirla.'
                : 'No hay anteproyectos enviados en esta cohorte.'}
            </p>
          )
        ) : (
          <div className="space-y-3">
            {Object.values(equipos).map((eq) => (
              <div key={eq.id} className="border border-inalde-gray-light rounded p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <h3 className="font-primary font-bold">{eq.nombre ?? '(equipo sin nombre)'}</h3>
                    <p className="text-xs text-inalde-gray mt-1">
                      {eq.miembros.sort((a, b) => a.posicion - b.posicion).map((m) => m.nombre).join(' · ')}
                    </p>
                    <div className="mt-3 space-y-2">
                      {eq.proyectos.map((p) => (
                        <div key={p.proyecto_id} className="text-sm">
                          <p>
                            <span className={`font-semibold ${p.estado_seleccion === 'definitivo' ? 'text-inalde-red' : p.estado_seleccion === 'archivado' ? 'text-inalde-gray line-through' : ''}`}>
                              {p.proyecto_nombre}
                            </span>
                            {p.sector && <span className="text-xs text-inalde-gray ml-2">[{p.sector}]</span>}
                            {p.ciiu && <span className="font-mono text-xs text-inalde-gold ml-2">CIIU {p.ciiu}</span>}
                          </p>
                          <p className="text-xs text-inalde-gray leading-snug">{p.resumen || <em>(sin resumen)</em>}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="w-56">
                    <label className="block text-xs uppercase tracking-wider text-inalde-gray mb-1">Profesor asignado</label>
                    <select
                      value={asignaciones[eq.id] ?? ''}
                      onChange={(e) => setAsignaciones({ ...asignaciones, [eq.id]: e.target.value })}
                      className="input-inalde !py-1 !text-sm"
                    >
                      <option value="">— Sin asignar —</option>
                      {profesores.map((p) => <option key={p.id} value={p.id}>{p.nombre_completo}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}
