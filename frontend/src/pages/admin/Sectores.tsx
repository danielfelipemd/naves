import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { confirmar, pedirTexto } from '../../components/inalde/Dialogos';
import { invalidarSectores } from '../../lib/sectores';

// Catálogo de sectores (sql/53). El súper admin agrega, renombra, ordena y
// oculta sectores sin pedirlo a desarrollo. Ocultar no borra: los proyectos
// que ya lo tienen lo conservan, solo deja de ofrecerse en las listas.
interface Sector { id: number; nombre: string; orden: number; activo: boolean; proyectos: number; }

export default function Sectores() {
  const [sectores, setSectores] = useState<Sector[]>([]);
  const [fuera, setFuera] = useState<Array<{ nombre: string; proyectos: number }>>([]);
  const [nuevo, setNuevo] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/sectores/admin');
      setSectores(data.sectores ?? []); setFuera(data.fuera_de_catalogo ?? []);
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setCargando(false); }
  }
  useEffect(() => { load(); }, []);

  async function hacer(fn: () => Promise<string | void>) {
    setOcupado(true); setMsg(null);
    try {
      const texto = await fn();
      invalidarSectores();
      if (texto) setMsg({ kind: 'ok', text: texto });
      await load();
    } catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    finally { setOcupado(false); }
  }

  function agregar() {
    const nombre = nuevo.trim();
    if (nombre.length < 2) return;
    hacer(async () => {
      await api.post('/sectores/admin', { nombre });
      setNuevo('');
      return `Sector «${nombre}» agregado. Ya aparece en las listas de sectores.`;
    });
  }

  async function renombrar(s: Sector) {
    const nombre = (await pedirTexto({
      titulo: 'Cambiar nombre del sector',
      mensaje: `Nombre actual: «${s.nombre}».${s.proyectos ? `\n\nLos ${s.proyectos} proyecto(s) que tienen este sector pasarán al nombre nuevo.` : ''}`,
      etiqueta: 'Nombre nuevo',
      placeholder: s.nombre,
      aceptar: 'Guardar',
      minimo: 2,
    }))?.trim();
    if (!nombre || nombre === s.nombre) return;
    hacer(async () => {
      const { data } = await api.patch(`/sectores/admin/${s.id}`, { nombre });
      return `«${s.nombre}» ahora se llama «${nombre}».${data.proyectos_actualizados ? ` Se actualizaron ${data.proyectos_actualizados} proyecto(s).` : ''}`;
    });
  }

  async function ocultar(s: Sector) {
    if (s.activo && !(await confirmar({
      titulo: 'Ocultar sector',
      mensaje: `«${s.nombre}» dejará de aparecer en las listas para escoger sector.`
        + (s.proyectos ? `\n\nLos ${s.proyectos} proyecto(s) que ya lo tienen lo conservan; conviene cambiarles el sector en la Base de datos de proyectos.` : '')
        + '\n\nPuedes volver a mostrarlo cuando quieras.',
      aceptar: 'Ocultar',
    }))) return;
    hacer(async () => {
      await api.patch(`/sectores/admin/${s.id}`, { activo: !s.activo });
      return s.activo ? `«${s.nombre}» quedó oculto.` : `«${s.nombre}» vuelve a aparecer en las listas.`;
    });
  }

  function mover(s: Sector, dir: -1 | 1) {
    hacer(async () => { await api.post(`/sectores/admin/${s.id}/mover`, { dir }); });
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Sectores</h1>
        <p className="text-sm text-inalde-gray mt-2">
          La lista de sectores que se ofrece al escoger el sector de un proyecto (anteproyecto y base de datos de proyectos).
          El orden de aquí es el orden de la lista. Ocultar un sector no lo borra de los proyectos que ya lo tienen.
        </p>
      </div>

      {msg && <div className={`rounded border-l-4 px-4 py-3 text-sm mb-5 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>{msg.text}</div>}

      <div className="flex flex-wrap gap-2 items-end mb-6">
        <div className="flex-1 min-w-[220px]">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Nuevo sector</label>
          <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} maxLength={100}
            onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
            placeholder="Ej.: Industrial" className="input-inalde !py-2 w-full" />
        </div>
        <button onClick={agregar} disabled={ocupado || nuevo.trim().length < 2} className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-50">+ Agregar</button>
      </div>

      {cargando ? <p className="text-inalde-gray">Cargando…</p> : (
        <div className="border border-inalde-gray-light rounded-lg overflow-hidden">
          {sectores.map((s, i) => (
            <div key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-inalde-gray-light last:border-b-0 ${s.activo ? '' : 'bg-inalde-gray-bg/60'}`}>
              <div className="flex flex-col">
                <button onClick={() => mover(s, -1)} disabled={ocupado || i === 0} aria-label={`Subir ${s.nombre}`} className="text-inalde-gray disabled:opacity-30 leading-none px-1">▲</button>
                <button onClick={() => mover(s, 1)} disabled={ocupado || i === sectores.length - 1} aria-label={`Bajar ${s.nombre}`} className="text-inalde-gray disabled:opacity-30 leading-none px-1">▼</button>
              </div>
              <div className="flex-1 min-w-[180px]">
                <span className={`font-semibold ${s.activo ? 'text-inalde-text' : 'text-inalde-gray line-through'}`}>{s.nombre}</span>
                {!s.activo && <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-inalde-gray-light text-inalde-gray">Oculto</span>}
                <span className="block text-xs text-inalde-gray">{s.proyectos ? `${s.proyectos} proyecto(s)` : 'Sin proyectos'}</span>
              </div>
              <button onClick={() => renombrar(s)} disabled={ocupado} className="text-xs font-semibold text-inalde-blue hover:underline disabled:opacity-50">✏️ Cambiar nombre</button>
              <button onClick={() => ocultar(s)} disabled={ocupado} className="text-xs font-semibold text-inalde-red hover:underline disabled:opacity-50">{s.activo ? 'Ocultar' : 'Mostrar'}</button>
            </div>
          ))}
        </div>
      )}

      {fuera.length > 0 && (
        <div className="rounded border-l-4 border-inalde-gold bg-inalde-gold/10 px-4 py-3 text-sm mt-6">
          <p className="font-semibold text-inalde-text mb-1">Sectores de proyectos que no están en esta lista</p>
          <p className="text-inalde-gray mb-2">Son datos viejos. Cámbiales el sector en la Base de datos de proyectos, o agrégalos aquí con el mismo nombre si deben seguir existiendo.</p>
          <ul className="list-disc pl-5">
            {fuera.map((f) => <li key={f.nombre}>«{f.nombre}» · {f.proyectos} proyecto(s)</li>)}
          </ul>
        </div>
      )}
    </>
  );
}
