import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';

// ── Datos de la BD ────────────────────────────────────────────────────────
// El backend (GET /cohortes/mi-cronograma) devuelve los 13 hitos de la cohorte
// del usuario autenticado. Solo trae posicion + nombre + fecha; las
// descripciones, horas y tags son contenido de presentación y viven aquí.
type HitoDb = { posicion: number; nombre: string; fecha: string | null };

// ── Plantilla de presentación ─────────────────────────────────────────────
// Cada ítem de la línea de tiempo referencia de qué posición(es) de
// cohorte_hitos saca su fecha. Así las FECHAS salen siempre de la cohorte
// activa (BD) y la copy curada se mantiene estable.
type Fuente =
  | { tipo: 'single'; pos: number }
  | { tipo: 'rango'; desde: number; hasta: number }
  | { tipo: 'offset'; pos: number; dias: number }; // p.ej. "3 días antes de la entrega"

type ItemTpl = {
  clave: string;
  titulo: string;
  descripcion: string;
  tags?: string[];
  fuente: Fuente;
};

const PLANTILLA: ItemTpl[] = [
  {
    clave: 'lanzamiento',
    titulo: 'Lanzamiento',
    descripcion:
      'Conformación del grupo de WhatsApp oficial, entrega de notas técnicas con instrucciones del proceso, y reunión de Kick Off donde se explica el cronograma completo y las expectativas.',
    fuente: { tipo: 'single', pos: 1 },
  },
  {
    clave: 'anteproyecto',
    titulo: 'Entrega del anteproyecto',
    descripcion:
      'Los profesores de NAVES les pedimos bajar la ansiedad con esta entrega. Se trata de llenar un formulario con la idea de negocio, que entendemos está en un estado primario.',
    tags: ['Hora límite: 7:59 AM'],
    fuente: { tipo: 'single', pos: 2 },
  },
  {
    clave: 'ventana-1',
    titulo: 'Ventana Reunión 1',
    descripcion:
      'Primero se publican los profesores asignados. Luego cada equipo agenda y realiza la Reunión 1 con su profesor para discutir el anteproyecto y recibir retroalimentación.',
    tags: ['Obligatoria — Requisito de grado'],
    fuente: { tipo: 'rango', desde: 4, hasta: 5 },
  },
  {
    clave: 'limite-cambios',
    titulo: 'Fecha límite de cambios',
    descripcion:
      'Último día para solicitar cambios de tema, de equipo o de modalidad. Después de esta fecha no se aceptan cambios.',
    tags: ['Fecha límite'],
    fuente: { tipo: 'single', pos: 6 },
  },
  {
    clave: 'ventana-2',
    titulo: 'Ventana Reunión 2',
    descripcion:
      'Período para agendar y realizar la Reunión 2 con el profesor NAVES. Se revisan los avances del Business Plan y se define la recta final del proyecto.',
    tags: ['Obligatoria — Requisito de grado'],
    fuente: { tipo: 'rango', desde: 7, hasta: 8 },
  },
  {
    clave: '60-dias',
    titulo: 'Reunión 60 días antes',
    descripcion:
      'Reunión grupal a las 6:30 PM. Cada equipo debe tener una lista clara y fechada de lo que falta para completar el documento. Es el momento de definir el plan de cierre.',
    tags: ['Obligatoria — Requisito de grado'],
    fuente: { tipo: 'single', pos: 9 },
  },
  {
    clave: 'entrega-anticipada',
    titulo: 'Entrega anticipada (recomendada)',
    descripcion:
      'Fecha recomendada para subir los documentos con margen y evitar fallas de plataforma. No cambia la fecha oficial de entrega.',
    tags: ['Recomendado'],
    fuente: { tipo: 'offset', pos: 10, dias: -3 },
  },
  {
    clave: 'entrega-final',
    titulo: 'Entrega final',
    descripcion:
      'Entrega de los cuatro documentos finales antes de las 7:59 AM: Business Plan (PDF), Resumen Ejecutivo (PDF), Logo (JPG) y Modelo financiero (Excel). Se recomienda subir con 3 días de anticipación.',
    fuente: { tipo: 'single', pos: 10 },
  },
  {
    clave: 'preparacion',
    titulo: 'Reunión preparación presentación',
    descripcion:
      'Reunión grupal a las 6:30 PM. Repaso de la estructura de la presentación, manejo del tiempo y preparación para las preguntas del panel.',
    tags: ['Obligatoria — Requisito de grado'],
    fuente: { tipo: 'single', pos: 11 },
  },
  {
    clave: 'presentaciones',
    titulo: 'Presentaciones NAVES',
    descripcion:
      'Jornadas de presentación final. Cada equipo presenta en la jornada asignada: 10 minutos de presentación + 10 minutos de preguntas de los panelistas.',
    tags: ['Asistencia obligatoria'],
    fuente: { tipo: 'rango', desde: 12, hasta: 13 },
  },
];

// ── Formato de fechas (es-CO, sin año, como en el sitio de referencia) ──────
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

type Ymd = { y: number; m: number; d: number };

// Se parsea a mano para no depender de la zona horaria (new Date('YYYY-MM-DD')
// se interpreta en UTC y en Colombia (UTC-5) restaría un día).
function parseISO(s: string | null): Ymd | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

function fmtDia(p: Ymd): string {
  return `${p.d} ${MESES[p.m - 1]}`;
}

function addDays(p: Ymd, dias: number): Ymd {
  const dt = new Date(p.y, p.m - 1, p.d);
  dt.setDate(dt.getDate() + dias);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

function fechaTexto(f: Fuente, mapa: Map<number, string | null>): string | null {
  if (f.tipo === 'single') {
    const p = parseISO(mapa.get(f.pos) ?? null);
    return p ? fmtDia(p) : null;
  }
  if (f.tipo === 'offset') {
    const p = parseISO(mapa.get(f.pos) ?? null);
    return p ? fmtDia(addDays(p, f.dias)) : null;
  }
  // rango: inicio — cierre
  const p1 = parseISO(mapa.get(f.desde) ?? null);
  const p2 = parseISO(mapa.get(f.hasta) ?? null);
  if (p1 && p2) {
    return p1.m === p2.m
      ? `${p1.d} — ${p2.d} ${MESES[p2.m - 1]}`
      : `${p1.d} ${MESES[p1.m - 1]} — ${p2.d} ${MESES[p2.m - 1]}`;
  }
  const solo = p1 ?? p2;
  return solo ? fmtDia(solo) : null;
}

export default function ConsultaCronograma() {
  const navigate = useNavigate();
  const [mapa, setMapa] = useState<Map<number, string | null> | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/cohortes/mi-cronograma');
        const hitos = (data?.hitos ?? []) as HitoDb[];
        const m = new Map<number, string | null>();
        hitos.forEach((h) => m.set(h.posicion, h.fecha));
        setMapa(m);
        setEstado('ok');
      } catch {
        setEstado('error');
      }
    })();
  }, []);

  if (estado === 'cargando') {
    return (
      <>
        <Header />
        <main className="pt-36 text-center text-inalde-gray">Cargando cronograma…</main>
      </>
    );
  }

  const items = PLANTILLA.map((t) => ({
    ...t,
    fecha: mapa ? fechaTexto(t.fuente, mapa) : null,
  }));
  const faltanFechas = estado === 'ok' && items.some((i) => !i.fecha);

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[720px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Cronograma</p>
            <h1 className="section-title">Consulta Cronograma</h1>
            <p className="text-inalde-gray text-sm mt-3 leading-relaxed">
              Principales hitos del proceso NAVES, con las fechas clave de tu cohorte.
            </p>
          </div>

          {estado === 'error' && (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6">
              No pudimos cargar el cronograma de tu cohorte. Inténtalo de nuevo más tarde.
            </div>
          )}
          {faltanFechas && (
            <div className="rounded border-l-4 border-inalde-gold bg-inalde-gold/10 px-4 py-3 text-sm mb-6">
              Algunas fechas aún no están publicadas por la coordinación. Aparecen como
              «Por confirmar».
            </div>
          )}

          {/* Línea de tiempo: riel vertical a la izquierda con puntos rojos.
              Las fechas salen de cohorte_hitos (BD) de la cohorte del usuario. */}
          <ol className="relative">
            <div
              className="absolute left-[8px] top-2 bottom-2 w-0.5 bg-inalde-gray-light"
              aria-hidden="true"
            />
            {items.map((it) => (
              <li key={it.clave} className="relative pl-10 pb-9 last:pb-0">
                <span
                  className="absolute left-0 top-1 w-[18px] h-[18px] rounded-full bg-inalde-red ring-4 ring-white"
                  aria-hidden="true"
                />
                {it.fecha ? (
                  <span className="inline-block text-inalde-red bg-inalde-red/[0.08] text-xs font-primary font-bold tracking-widest uppercase rounded px-3 py-1">
                    {it.fecha}
                  </span>
                ) : (
                  <span className="inline-block text-inalde-gray bg-inalde-gray-light/60 text-xs font-primary font-bold tracking-widest uppercase rounded px-3 py-1">
                    Por confirmar
                  </span>
                )}
                <h2 className="font-primary font-bold text-lg text-inalde-text mt-3 mb-1">{it.titulo}</h2>
                <p className="font-body text-inalde-gray text-sm leading-relaxed">{it.descripcion}</p>
                {it.tags && it.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {it.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-block bg-inalde-text text-white text-[0.7rem] font-primary font-semibold tracking-wide uppercase rounded px-2 py-0.5"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="mt-10 pt-6 border-t border-inalde-gray-light">
            <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
              ← Dashboard
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
