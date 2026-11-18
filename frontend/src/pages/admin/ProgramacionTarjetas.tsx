// Vista de la programación para celular y tableta: una tarjeta por proyecto.
//
// La tabla de cada jornada tiene 8 columnas y cabe entera solo desde 1280 px.
// Por debajo se medía (18/11/2026): a 1024 px quedaban 354 px escondidos a la
// derecha (Post LinkedIn, Archivos y las flechas), a 768 px 610 y en un
// celular de 390 px 956: solo se veían Slot y Proyecto. Encoger columnas no lo
// arregla, así que bajo 1280 px cada proyecto se apila en una tarjeta con los
// mismos datos y las mismas acciones que su fila.
//
// No tiene estado ni lógica propia: recibe las filas ya calculadas
// (`filasDe(j)`) y los mismos manejadores que usa la tabla, así que mover,
// quitar, fijar el día o copiar el post hacen exactamente lo mismo en las dos
// vistas. Los tipos son los mínimos que usa la tarjeta; los de Programacion.tsx
// encajan por estructura.

interface SlotTarjeta {
  slot: number; proyecto_id: string; proyecto: string; autores: string; sector: string;
  jornada_fija: number | null; hora_inicio: string; hora_fin: string;
  resumen: string | null; linkedin: string | null; one_pager_url: string | null; logo_url: string | null;
}
interface ActividadTarjeta { tipo: string; desc: string; hora_inicio: string; hora_fin: string; }
type FilaTarjeta = { kind: 'proyecto'; idx: number; s: SlotTarjeta } | { kind: 'actividad'; a: ActividadTarjeta };

interface Props {
  j: { numero: number; hora_inicio: string | null; almuerzo: boolean; slots: unknown[] };
  filas: FilaTarjeta[];
  jornadas: { id: string; numero: number }[];
  publicada: boolean;
  copiado: string | null;
  colorSector: (sector: string) => string;
  onCopiar: (proyectoId: string, texto: string) => void;
  onVer: (url: string, titulo: string) => void;
  onFijar: (proyectoId: string, jornada: number | null) => void;
  onMover: (idx: number, dir: -1 | 1) => void;
  onQuitar: (proyectoId: string) => void;
  className?: string;
}

// Rótulo de cada bloque de la tarjeta: hace de título de columna.
const rotulo = 'block font-primary font-bold text-[0.62rem] tracking-widest uppercase text-inalde-gray mb-1';
// Botones de ↑ ↓ ✕: en la tabla son de ~20 px; aquí se tocan con el dedo.
const botonAccion = 'w-9 h-9 inline-flex items-center justify-center rounded border border-inalde-gray-light text-inalde-gray disabled:opacity-30';

export function TarjetasJornada({ j, filas, jornadas, publicada, copiado, colorSector, onCopiar, onVer, onFijar, onMover, onQuitar, className = '' }: Props) {
  const total = j.slots.length;
  return (
    <div className={className}>
      <ol aria-label={`Programación de la jornada ${j.numero}`} className="divide-y divide-inalde-gray-light">
        {filas.map((f) => f.kind === 'actividad' ? (
          <li key={`act-${f.a.tipo}-${f.a.hora_inicio}`} className="bg-inalde-gray-bg border-l-4 border-inalde-red px-3 py-2.5 font-primary font-extrabold text-[0.85rem] text-inalde-text">
            <span aria-hidden="true">🕐 </span>{f.a.hora_inicio} – {f.a.hora_fin} hrs. — {f.a.desc}
          </li>
        ) : (
          <li key={f.s.proyecto_id} className="bg-white px-3 py-3 sm:px-4">
            {/* Cabecera. Desde 640 px: número y hora a la izquierda, proyecto en
                medio y acciones a la derecha, como los extremos de la fila. En
                celular número, hora y acciones van en una línea arriba y el
                proyecto debajo a todo lo ancho: en tres columnas el nombre
                quedaba en ~110 px y se partía a mitad de palabra
                («Apivoltaic-os»), con los autores en siete líneas. */}
            <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[4.5rem_1fr_auto] gap-x-3 gap-y-2 items-start">
              <div className="order-1 flex items-baseline gap-2 self-center sm:self-start sm:block sm:text-center">
                <strong className="font-primary text-lg leading-none text-inalde-text sm:block">{f.s.slot}</strong>
                <span className="text-[0.7rem] text-inalde-gray font-mono sm:block sm:mt-1">{f.s.hora_inicio}–{f.s.hora_fin}</span>
              </div>
              <div className="order-3 col-span-2 sm:order-2 sm:col-span-1 min-w-0">
                <p className="font-primary font-bold text-[0.95rem] leading-snug text-inalde-text break-words">{f.s.proyecto}</p>
                {/* Autores vacío = el equipo se quedó sin miembros; se dice, igual que en la tabla. */}
                <p className="mt-0.5 text-[0.78rem] text-inalde-gray">
                  {f.s.autores || <span className="italic" title="Este equipo no tiene participantes registrados. Revísalo en Equipos.">Sin autores</span>}
                </p>
                {f.s.sector && (
                  <span className="inline-block mt-1.5 max-w-full text-white rounded-[3px] px-2 py-0.5 font-primary font-bold text-[0.62rem] tracking-wider uppercase leading-tight break-words"
                    style={{ background: colorSector(f.s.sector) }}>{f.s.sector}</span>
                )}
              </div>
              {!publicada && (
                <div className="order-2 sm:order-3 flex gap-1 justify-self-end">
                  <button onClick={() => onMover(f.idx, -1)} disabled={f.idx === 0} aria-label={`Subir ${f.s.proyecto}`} className={botonAccion}>↑</button>
                  <button onClick={() => onMover(f.idx, 1)} disabled={f.idx === total - 1} aria-label={`Bajar ${f.s.proyecto}`} className={botonAccion}>↓</button>
                  <button onClick={() => onQuitar(f.s.proyecto_id)} aria-label={`Quitar ${f.s.proyecto} de la jornada`} className={`${botonAccion} hover:text-inalde-red`}>✕</button>
                </div>
              )}
            </div>

            {/* Día fijo y archivos en una línea; en celular bajan si no caben. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {publicada ? (
                f.s.jornada_fija != null && <span className="text-[0.7rem] text-inalde-blue">📌 Día {f.s.jornada_fija}</span>
              ) : (
                <select value={f.s.jornada_fija ?? ''} onChange={(e) => onFijar(f.s.proyecto_id, e.target.value === '' ? null : Number(e.target.value))}
                  aria-label={`Día de ${f.s.proyecto}`}
                  title="Fija este proyecto a un día: «Repartir» lo deja siempre en esa jornada"
                  className={`text-xs rounded border px-1.5 py-1.5 ${f.s.jornada_fija != null ? 'border-inalde-blue text-inalde-blue font-semibold' : 'border-inalde-gray-light text-inalde-gray'}`}>
                  <option value="">Día libre</option>
                  {jornadas.map((jj) => <option key={jj.id} value={jj.numero}>📌 Día {jj.numero}</option>)}
                </select>
              )}
              {f.s.logo_url && <button onClick={() => onVer(f.s.logo_url!, `Logo · ${f.s.proyecto}`)} className="px-2.5 py-1.5 rounded-[3px] font-primary font-bold text-[0.68rem] bg-inalde-gray-bg text-inalde-blue border border-inalde-blue hover:bg-inalde-blue hover:text-white">Logo</button>}
              {f.s.one_pager_url && <button onClick={() => onVer(f.s.one_pager_url!, `One Pager · ${f.s.proyecto}`)} className="px-2.5 py-1.5 rounded-[3px] font-primary font-bold text-[0.68rem] bg-inalde-gray-bg text-inalde-red border border-inalde-red hover:bg-inalde-red hover:text-white">One Pager</button>}
            </div>

            {/* Resumen y post: uno debajo del otro en celular, lado a lado desde 768 px. */}
            <div className="mt-3 grid gap-3 md:grid-cols-2 md:gap-5">
              <div>
                <span className={rotulo}>Resumen</span>
                <p className="text-[0.82rem] leading-relaxed text-inalde-text">
                  {f.s.resumen || <span className="text-inalde-gray italic">Sin resumen</span>}
                </p>
              </div>
              <div>
                <span className={rotulo}>Post LinkedIn</span>
                {f.s.linkedin ? (
                  <>
                    <p className="text-[0.8rem] leading-relaxed text-inalde-text whitespace-pre-line mb-2">{f.s.linkedin}</p>
                    <button onClick={() => onCopiar(f.s.proyecto_id, f.s.linkedin!)}
                      className={`font-primary font-bold text-[0.68rem] tracking-wider uppercase border px-3 py-1.5 transition-colors ${copiado === f.s.proyecto_id ? 'bg-inalde-blue text-white border-inalde-blue' : 'border-inalde-gray-light text-inalde-gray hover:bg-inalde-text hover:text-white hover:border-inalde-text'}`}>
                      {copiado === f.s.proyecto_id ? '✓ Copiado' : 'Copiar'}
                    </button>
                  </>
                ) : <span className="text-[0.8rem] text-inalde-gray italic">Sin post</span>}
              </div>
            </div>
          </li>
        ))}
        {/* Los mismos avisos que la tabla pone al final de cada jornada. */}
        {total === 0 && <li className="py-3 text-center text-inalde-gray italic text-xs">Sin proyectos asignados</li>}
        {!j.hora_inicio && (
          <li className="px-3 py-3 text-xs text-inalde-text bg-inalde-gray-bg border-l-4 border-inalde-red">
            Esta jornada <strong>no tiene hora de inicio</strong>, así que no se pueden calcular los horarios. Ponle la hora de inicio en «Opciones de la programación» → Jornada {j.numero} y se recalculan solos.
          </li>
        )}
        {j.almuerzo && total < 2 && (
          <li className="px-3 py-3 text-xs text-inalde-text bg-inalde-gray-bg border-l-4 border-inalde-red">
            El <strong>almuerzo</strong> parte la jornada en dos, así que necesita al menos dos presentaciones. Asigna proyectos y la franja aparecerá sola.
          </li>
        )}
      </ol>
    </div>
  );
}
