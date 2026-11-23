import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatBackendError } from '../../../lib/errors';

// A quién le llega sola la copia en PDF de cada acta cuando queda con todas sus
// firmas, por modalidad. Es configuración general (no depende de la cohorte).
// Una modalidad sin correos no manda copia.

type Modalidad = 'caso' | 'business_plan' | 'proyecto_investigacion';
type Copias = Record<Modalidad, string[]>;

const FILAS: Array<[Modalidad, string]> = [
  ['caso', 'Caso'],
  ['business_plan', 'Business Plan'],
  ['proyecto_investigacion', 'Proyecto de Investigación'],
];

export default function CopiasFirmadas() {
  const [copias, setCopias] = useState<Copias | null>(null);
  const [nuevo, setNuevo] = useState<Record<Modalidad, string>>({ caso: '', business_plan: '', proyecto_investigacion: '' });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    api.get('/actas/config/copias')
      .then((r) => setCopias(r.data as Copias))
      .catch((e) => setMsg({ ok: false, texto: formatBackendError(e) }));
  }, []);

  const guardar = async (siguiente: Copias) => {
    setGuardando(true); setMsg(null);
    try {
      const r = await api.put('/actas/config/copias', siguiente);
      setCopias(r.data as Copias);
      setMsg({ ok: true, texto: 'Guardado.' });
      return true;
    } catch (e) {
      setMsg({ ok: false, texto: formatBackendError(e) });
      return false;
    } finally { setGuardando(false); }
  };

  const agregar = async (m: Modalidad) => {
    if (!copias) return;
    const correo = nuevo[m].trim();
    if (!correo) return;
    if (await guardar({ ...copias, [m]: [...copias[m], correo] })) setNuevo((n) => ({ ...n, [m]: '' }));
  };

  const quitar = (m: Modalidad, correo: string) => {
    if (!copias) return;
    void guardar({ ...copias, [m]: copias[m].filter((c) => c !== correo) });
  };

  return (
    <section className="card-inalde p-5">
      <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-1">Copia de actas firmadas</h2>
      <p className="text-xs text-inalde-gray mb-4">
        Cuando un acta queda con <strong>todas sus firmas</strong>, el sistema manda sola una copia en PDF a
        estos correos. Vale para todas las cohortes. Si una modalidad no tiene correos, no se manda copia.
      </p>

      {msg && (
        <div className={`mb-3 rounded border-l-4 px-3 py-2 text-xs ${msg.ok ? 'border-green-600 bg-green-50 text-green-800' : 'border-inalde-red bg-red-50'}`}>
          {msg.texto}
        </div>
      )}

      {!copias ? <p className="text-xs text-inalde-gray">Cargando…</p> : (
        <div className="grid md:grid-cols-3 gap-4">
          {FILAS.map(([m, etiqueta]) => (
            <div key={m}>
              <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-2">{etiqueta}</p>
              {copias[m].length === 0 && <p className="text-xs text-inalde-gray italic mb-2">Sin copia</p>}
              <ul className="space-y-1 mb-2">
                {copias[m].map((c) => (
                  <li key={c} className="flex items-center justify-between gap-2 text-sm bg-inalde-gray-light/40 rounded px-2 py-1">
                    <span className="truncate">{c}</span>
                    <button type="button" className="text-inalde-red text-xs shrink-0" disabled={guardando}
                      onClick={() => quitar(m, c)} aria-label={`Quitar ${c}`}>Quitar</button>
                  </li>
                ))}
              </ul>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void agregar(m); }}>
                <input type="email" className="input-inalde !py-1.5 !text-sm flex-1 min-w-0" placeholder="correo@inalde.edu.co"
                  value={nuevo[m]} onChange={(e) => setNuevo((n) => ({ ...n, [m]: e.target.value }))} />
                <button type="submit" className="btn-inalde-secondary !px-3 !py-1.5 text-xs" disabled={guardando || !nuevo[m].trim()}>Agregar</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
