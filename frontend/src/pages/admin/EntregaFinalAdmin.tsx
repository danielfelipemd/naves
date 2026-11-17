// Entrega final de Business Plan cargada por el súper admin, EN NOMBRE del
// equipo (pedido del 16/11/2026).
//
// Antes el admin solo podía subir el PDF del Business Plan, uno por vez. Ahora:
//  1. Escoge TODOS los archivos de una vez (hasta 4).
//  2. En una ventana dice qué es cada uno (Business Plan, One Pager, Logo,
//     Modelo Financiero). Viene una propuesta según el tipo de archivo, pero
//     quien decide es él.
//  3. Se suben en UNA sola petición (POST /admin/equipos/:id/entrega-final).
//
// Igual que la carga administrativa de un documento: no aplica la fecha
// límite, reemplaza lo que haya y queda en la auditoría. Puede cambiar el
// material aunque la programación esté publicada (con aviso), y si la entrega
// queda completa por primera vez, al equipo le llega el correo de entrega.

import { useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { Modal } from '../../components/inalde/Modal';
import { BarraProgreso } from '../../components/inalde/BarraProgreso';
import { confirmar } from '../../components/inalde/Dialogos';
import { FORMATOS, acceptDe, revisarFormato, type ReglaFormato } from '../../lib/formatos';

export type TipoEntrega = 'proyecto-final' | 'one_pager' | 'logo' | 'modelo_financiero';

export const DOCUMENTOS: { tipo: TipoEntrega; nombre: string; regla: ReglaFormato }[] = [
  { tipo: 'proyecto-final', nombre: 'Business Plan', regla: FORMATOS.documentoPdf },
  { tipo: 'one_pager', nombre: 'Resumen · One Pager', regla: FORMATOS.onePager },
  { tipo: 'logo', nombre: 'Logo', regla: FORMATOS.logo },
  { tipo: 'modelo_financiero', nombre: 'Modelo Financiero', regla: FORMATOS.modeloFinanciero },
];
const NOMBRE = Object.fromEntries(DOCUMENTOS.map((d) => [d.tipo, d.nombre])) as Record<TipoEntrega, string>;
const REGLA = Object.fromEntries(DOCUMENTOS.map((d) => [d.tipo, d.regla])) as Record<TipoEntrega, ReglaFormato>;

// Todos los formatos de los cuatro documentos, sin repetir.
const ACCEPT = Array.from(new Set(DOCUMENTOS.flatMap((d) => acceptDe(d.regla).split(',')))).join(',');

interface Fila { file: File; tipo: TipoEntrega | ''; problema: string | null }

const ext = (n: string) => (n.toLowerCase().split('.').pop() ?? '');
const tam = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Una propuesta de qué es cada archivo: por el nombre y, si no dice, por el tipo. Sin repetir documentos. */
function proponer(files: File[]): (TipoEntrega | '')[] {
  const usados = new Set<TipoEntrega>();
  const out: (TipoEntrega | '')[] = files.map(() => '');
  const tomar = (i: number, t: TipoEntrega) => { if (!out[i] && !usados.has(t)) { out[i] = t; usados.add(t); } };
  // 1. El nombre lo dice («logo.png», «one pager.pdf», «modelo financiero.xlsx»).
  files.forEach((f, i) => {
    const n = f.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/logo/.test(n)) tomar(i, 'logo');
    else if (/one[\s_-]*pager|onepager|resumen/.test(n)) tomar(i, 'one_pager');
    else if (/modelo|financ/.test(n) && /^xlsx?$/.test(ext(f.name))) tomar(i, 'modelo_financiero');
    else if (/business|plan|final/.test(n) && ext(f.name) === 'pdf') tomar(i, 'proyecto-final');
  });
  // 2. Por el tipo de archivo: Excel → modelo; PDF → Business Plan y luego One Pager; imagen → logo y luego One Pager.
  files.forEach((f, i) => {
    const e = ext(f.name);
    if (/^xlsx?$/.test(e)) tomar(i, 'modelo_financiero');
    else if (e === 'pdf') { tomar(i, 'proyecto-final'); tomar(i, 'one_pager'); }
    else if (/^(png|jpe?g|webp)$/.test(e)) { tomar(i, 'logo'); tomar(i, 'one_pager'); }
  });
  return out;
}

export function EntregaFinalAdmin(props: {
  equipoId: string | null;
  estado: Record<TipoEntrega, boolean>;
  tieneDefinitivo: boolean;
  programacionPublicada: boolean;
  /** El equipo no tiene ningún proyecto: al subir material se crea uno con
   *  este nombre (editable) y queda como definitivo. null = ya tiene proyecto. */
  nombreProyectoNuevo?: string | null;
  onListo: (mensaje: { kind: 'ok' | 'err'; text: string }) => void;
}) {
  const { equipoId, estado, tieneDefinitivo, programacionPublicada, nombreProyectoNuevo, onListo } = props;
  const creaProyecto = nombreProyectoNuevo != null;
  const [nombreProyecto, setNombreProyecto] = useState(nombreProyectoNuevo ?? '');
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revisar(f: File, tipo: TipoEntrega | ''): Promise<string | null> {
    if (!tipo) return null;
    if (tipo !== 'proyecto-final' && !tieneDefinitivo) return 'El equipo tiene varios proyectos y aún no se eligió el definitivo: este documento se puede cargar cuando se elija.';
    return revisarFormato(f, REGLA[tipo]);
  }

  async function elegir(lista: FileList | null) {
    const files = Array.from(lista ?? []);
    if (!files.length) return;
    setError(null);
    if (files.length > 4) { setError('Son cuatro documentos: escoge como máximo 4 archivos.'); return; }
    const tipos = proponer(files);
    setFilas(await Promise.all(files.map(async (file, i) => ({ file, tipo: tipos[i], problema: await revisar(file, tipos[i]) }))));
  }

  async function cambiar(i: number, tipo: TipoEntrega | '') {
    if (!filas) return;
    const problema = await revisar(filas[i].file, tipo);
    setFilas((fs) => fs && fs.map((x, k) => (k === i ? { ...x, tipo, problema } : x)));
  }

  const asignadas = (filas ?? []).filter((f) => f.tipo);
  const repetidos = new Set(asignadas.map((f) => f.tipo).filter((t, i, a) => a.indexOf(t) !== i));
  const material = asignadas.some((f) => f.tipo !== 'proyecto-final');
  const pideNombre = creaProyecto && material;
  const listo = !!filas && asignadas.length > 0 && !repetidos.size && asignadas.every((f) => !f.problema)
    && (!pideNombre || !!nombreProyecto.trim());
  const faltanTrasCarga = DOCUMENTOS.filter((d) => !estado[d.tipo] && !asignadas.some((f) => f.tipo === d.tipo));

  async function subir() {
    if (!filas || !listo || !equipoId) return;
    const reemplaza = asignadas.filter((f) => estado[f.tipo as TipoEntrega]).map((f) => NOMBRE[f.tipo as TipoEntrega]);
    const avisos = [
      `Vas a cargar en nombre del equipo: ${asignadas.map((f) => NOMBRE[f.tipo as TipoEntrega]).join(', ')}. No aplica la fecha límite y queda en la auditoría.`,
      pideNombre ? `El equipo no tiene proyecto: se crea «${nombreProyecto.trim()}» y queda como su proyecto definitivo.` : '',
      reemplaza.length ? `Ya hay archivo cargado de: ${reemplaza.join(', ')}. Se reemplazará y el anterior se perderá.` : '',
      programacionPublicada && material ? 'La programación de presentaciones ya se publicó: el material (One Pager, Logo, Modelo Financiero) que cambies es el que verán las áreas desde ahora.' : '',
      faltanTrasCarga.length ? `Después de esta carga todavía faltará: ${faltanTrasCarga.map((d) => d.nombre).join(', ')}.` : 'Con esta carga la entrega queda completa: si no lo estaba, el equipo recibe el correo de entrega.',
    ].filter(Boolean).join('\n\n');
    if (!(await confirmar({
      titulo: reemplaza.length ? 'Reemplazar documentos' : 'Cargar en nombre del equipo',
      mensaje: avisos,
      aceptar: reemplaza.length ? 'Reemplazar y subir' : 'Subir',
      tono: reemplaza.length || (programacionPublicada && material) ? 'peligro' : 'normal',
    }))) return;

    const fd = new FormData();
    for (const f of asignadas) fd.append('files', f.file);
    fd.append('tipos', JSON.stringify(asignadas.map((f) => f.tipo)));
    if (pideNombre) fd.append('nombre_proyecto', nombreProyecto.trim());
    const total = asignadas.reduce((n, f) => n + f.file.size, 0);
    setProgreso(0); setError(null);
    try {
      const r = await api.post(`/admin/equipos/${equipoId}/entrega-final`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        onUploadProgress: (ev) => {
          const t = ev.total ?? total;
          setProgreso(t ? Math.round((ev.loaded * 100) / t) : 100);
        },
      });
      const d = r.data ?? {};
      setFilas(null);
      onListo({
        kind: 'ok',
        text: `Listo: ${(d.resultados ?? []).map((x: any) => `${NOMBRE[x.tipo as TipoEntrega]}${x.reemplazo ? ' (reemplazado)' : ''}`).join(', ')}. Queda registrado en la auditoría.`
          + (d.correo_entrega ? '\nLa entrega quedó completa: el equipo recibe el correo de entrega.' : d.completa ? '' : `\nFalta: ${faltanTrasCarga.map((x) => x.nombre).join(', ') || '—'}.`),
      });
    } catch (e: any) {
      const d = e?.response?.data;
      // Carga parcial: lo que subió quedó; se dice qué falló.
      if (d?.error === 'CARGA_PARCIAL') { setFilas(null); onListo({ kind: 'err', text: d.mensaje }); }
      else setError(formatBackendError(e));
    } finally {
      setProgreso(null);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-inalde-gray-light">
      <label className="inline-block text-[11px] font-semibold text-inalde-blue hover:underline cursor-pointer">
        ↑ Subir documentos por el equipo (varios a la vez)
        <input type="file" multiple accept={ACCEPT} className="hidden"
          onChange={(e) => { void elegir(e.target.files); e.target.value = ''; }} />
      </label>
      <p className="text-[10px] text-inalde-gray mt-1 italic">
        Escoge los archivos (hasta 4) y luego dices qué documento es cada uno. Carga administrativa: no aplica la fecha límite del cronograma y queda en la auditoría.
      </p>
      {error && !filas && <p className="text-xs text-inalde-red mt-2">{error}</p>}

      <Modal open={!!filas} onClose={() => { if (progreso === null) setFilas(null); }}
        subtitle="Entrega final · carga por el equipo" title="¿Qué documento es cada archivo?" size="lg"
        footer={progreso !== null ? undefined : (
          <>
            <button className="btn-inalde-secondary !py-2 !px-4 !text-xs" onClick={() => setFilas(null)}>Cancelar</button>
            <button className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-50" disabled={!listo} onClick={() => void subir()}>
              Subir {asignadas.length || ''} {asignadas.length === 1 ? 'documento' : 'documentos'}
            </button>
          </>
        )}>
        {progreso !== null ? (
          <div className="py-4"><p className="text-sm mb-3">Subiendo…</p><BarraProgreso porcentaje={progreso} /></div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-inalde-gray">
                  <th className="pb-2 pr-3">Archivo</th><th className="pb-2">Es el documento…</th>
                </tr>
              </thead>
              <tbody>
                {(filas ?? []).map((f, i) => (
                  <tr key={i} className="border-t border-inalde-gray-light align-top">
                    <td className="py-3 pr-3 break-all">
                      {f.file.name}<span className="block text-[10px] text-inalde-gray">{tam(f.file.size)}</span>
                    </td>
                    <td className="py-3 min-w-[14rem]">
                      <select className="input-inalde !py-1.5 !text-sm w-full" value={f.tipo}
                        onChange={(e) => void cambiar(i, e.target.value as TipoEntrega | '')}>
                        <option value="">— No subir este archivo —</option>
                        {DOCUMENTOS.map((d) => (
                          <option key={d.tipo} value={d.tipo}>{d.nombre}{estado[d.tipo] ? ' (reemplaza el actual)' : ''}</option>
                        ))}
                      </select>
                      {f.tipo && repetidos.has(f.tipo) && <p className="text-xs text-inalde-red mt-1">Otro archivo ya quedó como {NOMBRE[f.tipo]}. Cada documento lleva un solo archivo.</p>}
                      {f.problema && <p className="text-xs text-inalde-red mt-1">{f.problema}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pideNombre && (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-inalde-text mb-1">Nombre del proyecto</label>
                <input className="input-inalde !py-1.5 !text-sm w-full" value={nombreProyecto} maxLength={200}
                  onChange={(e) => setNombreProyecto(e.target.value)} placeholder="Nombre del proyecto del equipo" />
                <p className="text-[11px] text-inalde-gray mt-1">
                  El equipo no tiene ningún proyecto. Al subir se crea con este nombre y queda como su proyecto definitivo (ahí se guardan el One Pager, el Logo y el Modelo Financiero).
                </p>
              </div>
            )}
            {programacionPublicada && (
              <p className="text-xs mt-4 border-l-4 border-inalde-gold bg-yellow-50 px-3 py-2">
                La programación de presentaciones ya está publicada. El equipo ya no puede cambiar su material; como súper admin sí puedes, y quedará en la auditoría.
              </p>
            )}
            {faltanTrasCarga.length > 0 && (
              <p className="text-xs text-inalde-gray mt-3">Después de esta carga faltará: {faltanTrasCarga.map((d) => d.nombre).join(', ')}.</p>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
