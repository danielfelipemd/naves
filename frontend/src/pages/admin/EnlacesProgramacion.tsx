import { useEffect, useState } from 'react';
import { confirmar } from '../../components/inalde/Dialogos';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

// Enlaces mágicos de la programación por público (sql/58). El super admin los
// genera aquí y los envía él (WhatsApp, correo…): el sistema no manda nada.
// Cada enlace es personal, dura como máximo 10 días y se puede revocar.

type Publico = 'asistentes' | 'marketing' | 'publicaciones';
interface Enlace { id: string; publico: Publico; nombre: string; vence_at: string; estado: 'vigente' | 'vencido' | 'revocado'; ultimo_uso_at: string | null; url: string | null }

const PUBLICOS: Array<{ clave: Publico; nombre: string; ve: string }> = [
  { clave: 'asistentes', nombre: 'Asistentes de programa', ve: 'La tabla para imprimir y pegar en carteleras: horario, proyecto, autores, sector y resumen. Sin post, logo ni One Pager.' },
  { clave: 'marketing', nombre: 'Marketing y comunicaciones', ve: 'Todo: resumen, post de LinkedIn y logo de cada proyecto, más un ZIP con todos los logos. Sin One Pager.' },
  { clave: 'publicaciones', nombre: 'Publicaciones', ve: 'La programación con el One Pager de cada proyecto, más un ZIP con todos (una carpeta por proyecto).' },
];
const DIA = 86400000;
function aLocal(ms: number) {
  const d = new Date(ms); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function legibleCorto(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function EnlacesProgramacion({ cohorte, publicada }: { cohorte: string; publicada: boolean }) {
  const [enlaces, setEnlaces] = useState<Enlace[] | null>(null);
  const [form, setForm] = useState<{ publico: Publico; nombre: string; vence: string } | null>(null);
  const [nuevo, setNuevo] = useState<Enlace | null>(null);
  const [aviso, setAviso] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function cargar() {
    try { setEnlaces((await api.get(`/programacion-enlaces/admin/${cohorte}`)).data.enlaces); }
    catch (e: any) { setEnlaces([]); setAviso({ kind: 'err', text: formatBackendError(e) }); }
  }
  useEffect(() => { setNuevo(null); setForm(null); setAviso(null); cargar(); }, [cohorte]);

  async function copiar(e: Enlace, silencioso = false) {
    if (!e.url) return false;
    try { await navigator.clipboard.writeText(e.url); if (!silencioso) setAviso({ kind: 'ok', text: `Enlace de ${e.nombre} copiado.` }); return true; }
    catch { if (!silencioso) setAviso({ kind: 'err', text: 'El navegador no permitió copiar. Selecciona el enlace y cópialo a mano.' }); return false; }
  }
  async function crear() {
    if (!form) return;
    if (form.nombre.trim().length < 2) { setAviso({ kind: 'err', text: 'Escribe para quién es el enlace.' }); return; }
    const vence = new Date(form.vence).getTime();
    if (!form.vence || vence <= Date.now()) { setAviso({ kind: 'err', text: 'Elige una fecha de vencimiento futura.' }); return; }
    if (vence > Date.now() + 10 * DIA + 60_000) { setAviso({ kind: 'err', text: 'Un enlace dura como máximo 10 días.' }); return; }
    setBusy(true); setAviso(null);
    try {
      const { data } = await api.post(`/programacion-enlaces/admin/${cohorte}`, { publico: form.publico, nombre: form.nombre.trim(), vence_at: new Date(form.vence).toISOString() });
      setForm(null); setNuevo(data.enlace); await cargar();
      const copiado = await copiar(data.enlace, true);
      setAviso({ kind: 'ok', text: `Enlace de ${data.enlace.nombre} creado${copiado ? ' y copiado' : ''}. Envíaselo por el medio que prefieras.` });
    } catch (e: any) { setAviso({ kind: 'err', text: formatBackendError(e) }); }
    finally { setBusy(false); }
  }
  async function revocar(e: Enlace) {
    if (!(await confirmar({ titulo: 'Revocar el enlace', mensaje: `El enlace de ${e.nombre} deja de abrir al instante. ¿Continuar?`, aceptar: 'Revocar', tono: 'peligro' }))) return;
    setBusy(true);
    try { await api.delete(`/programacion-enlaces/admin/enlace/${e.id}`); if (nuevo?.id === e.id) setNuevo(null); await cargar(); setAviso({ kind: 'ok', text: `Enlace de ${e.nombre} revocado: ya no abre.` }); }
    catch (err: any) { setAviso({ kind: 'err', text: formatBackendError(err) }); }
    finally { setBusy(false); }
  }

  const ESTILO = { vigente: 'bg-green-100 text-green-800', vencido: 'bg-red-100 text-inalde-red', revocado: 'bg-inalde-gray-bg text-inalde-gray' } as const;
  const TEXTO = { vigente: 'Activo', vencido: 'Vencido', revocado: 'Revocado' } as const;
  return (
    <section className="rounded-lg border-2 border-inalde-text bg-white p-4 sm:p-5 mb-5">
      <h2 className="font-primary font-bold text-inalde-text">Enlaces de la programación por público</h2>
      <p className="text-xs text-inalde-gray mt-1 mb-3">
        Cada enlace es personal, abre solo lo de su público y dura como máximo 10 días; se puede abrir las veces que haga falta en ese plazo.
        El sistema no lo envía: al crearlo queda copiado y se lo mandas por el medio que prefieras.
      </p>
      {!publicada && (
        <p className="text-xs border-l-4 border-inalde-gold bg-amber-50 px-3 py-2 mb-3">
          La programación aún no está publicada: los enlaces abren, pero muestran la tabla solo cuando la publiques (igual que la Programación Interna).
        </p>
      )}
      {aviso && <p role="status" className={`text-xs mb-3 ${aviso.kind === 'ok' ? 'text-green-700' : 'text-inalde-red'}`}>{aviso.text}</p>}
      {nuevo?.url && (
        <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-3 py-2 mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-inalde-text">Enlace de <strong>{nuevo.nombre}</strong>:</span>
          <input readOnly value={nuevo.url} onFocus={(ev) => ev.currentTarget.select()} aria-label="Enlace recién creado" className="input-inalde !py-1 !text-xs font-mono flex-1 min-w-[240px]" />
          <button onClick={() => copiar(nuevo)} className="btn-inalde-secondary !py-1 !px-3 !text-xs">Copiar</button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {PUBLICOS.map((p) => {
          const suyos = (enlaces ?? []).filter((e) => e.publico === p.clave);
          const abierto = form?.publico === p.clave;
          return (
            <div key={p.clave} className="border border-inalde-gray-light rounded p-3 flex flex-col">
              <h3 className="font-primary font-semibold text-sm text-inalde-text">{p.nombre}</h3>
              <p className="text-[11px] text-inalde-gray mt-0.5 mb-2">{p.ve}</p>
              {suyos.length > 0 && (
                <ul className="divide-y divide-inalde-gray-light border border-inalde-gray-light rounded mb-2">
                  {suyos.map((e) => (
                    <li key={e.id} className="px-2 py-1.5 text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-inalde-text">{e.nombre}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${ESTILO[e.estado]}`}>{TEXTO[e.estado]}</span>
                      <span className="text-[10px] text-inalde-gray w-full">{e.estado === 'vencido' ? 'venció' : 'vence'} {legibleCorto(e.vence_at)}{e.ultimo_uso_at ? ` · abierto ${legibleCorto(e.ultimo_uso_at)}` : ' · sin abrir'}</span>
                      {e.estado === 'vigente' && (
                        <span className="flex gap-1.5">
                          <button onClick={() => copiar(e)} aria-label={`Copiar el enlace de ${e.nombre}`} className="text-[11px] border border-inalde-gray-light rounded px-2 py-0.5">Copiar</button>
                          <button onClick={() => revocar(e)} disabled={busy} className="text-[11px] text-inalde-gray hover:text-inalde-red px-1">Revocar</button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {abierto ? (
                <div className="space-y-2 mt-auto">
                  <label className="block text-[11px] text-inalde-gray"><span className="block uppercase tracking-wider font-semibold mb-0.5">Para quién</span>
                    <input value={form!.nombre} onChange={(ev) => setForm({ ...form!, nombre: ev.target.value })} placeholder="Nombre de la persona" className="input-inalde !py-1.5 !text-sm" /></label>
                  <label className="block text-[11px] text-inalde-gray"><span className="block uppercase tracking-wider font-semibold mb-0.5">Funciona hasta (máx. 10 días)</span>
                    <input type="datetime-local" value={form!.vence} max={aLocal(Date.now() + 10 * DIA)} onChange={(ev) => setForm({ ...form!, vence: ev.target.value })} className="input-inalde !py-1.5 !text-sm" /></label>
                  <div className="flex gap-2">
                    <button onClick={crear} disabled={busy} className="btn-inalde-primary !py-1.5 !px-3 !text-xs disabled:opacity-50">Crear enlace</button>
                    <button onClick={() => setForm(null)} disabled={busy} className="btn-inalde-secondary !py-1.5 !px-3 !text-xs">Cancelar</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setNuevo(null); setForm({ publico: p.clave, nombre: '', vence: aLocal(Date.now() + 10 * DIA - 60_000) }); }}
                  className="btn-inalde-secondary !py-1.5 !px-3 !text-xs mt-auto self-start">+ Crear enlace</button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
