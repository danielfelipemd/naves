import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';

type HitoCronograma = {
  posicion: number;   // orden cronológico en la línea de tiempo (clave de render)
  fecha: string;      // etiqueta visible tal cual la ve el participante
  titulo: string;
  descripcion: string;
  tags?: string[];
};

// Cronograma de la cohorte (v1 "pie de inicio"): contenido curado del sitio de
// referencia (prueba-int2026-naves/index.html). Las fechas, descripciones,
// horas y tags viven aquí porque la BD (cohorte_hitos) solo guarda
// posicion+nombre+fecha. En v2, para hacerlo editable por cohorte sin redeploy,
// se puede leer la `fecha` desde un endpoint de participante que exponga
// cohorte_hitos y mantener aquí las descripciones/tags por hito.
const HITOS_CRONOGRAMA: HitoCronograma[] = [
  {
    posicion: 1,
    fecha: '12 — 13 Mayo',
    titulo: 'Lanzamiento',
    descripcion:
      'Conformación del grupo de WhatsApp oficial, entrega de notas técnicas con instrucciones del proceso, y reunión de Kick Off donde se explica el cronograma completo y las expectativas.',
  },
  {
    posicion: 2,
    fecha: '26 Mayo',
    titulo: 'Entrega del anteproyecto',
    descripcion:
      'Los profesores de NAVES les pedimos bajar la ansiedad con esta entrega. Se trata de llenar un formulario con la idea de negocio, que entendemos está en un estado primario.',
    tags: ['Hora límite: 7:59 AM'],
  },
  {
    posicion: 3,
    fecha: 'Hasta el 31 Julio',
    titulo: 'Ventana Reunión 1',
    descripcion:
      'Primero se publican los profesores asignados. Luego cada equipo agenda y realiza la Reunión 1 con su profesor para discutir el anteproyecto y recibir retroalimentación.',
    tags: ['Obligatoria — Requisito de grado'],
  },
  {
    posicion: 4,
    fecha: '31 Julio',
    titulo: 'Fecha límite de cambios',
    descripcion:
      'Último día para solicitar cambios de tema, de equipo o de modalidad. Después de esta fecha no se aceptan cambios.',
    tags: ['Fecha límite'],
  },
  {
    posicion: 5,
    fecha: '1 — 15 Septiembre',
    titulo: 'Ventana Reunión 2',
    descripcion:
      'Período para agendar y realizar la Reunión 2 con el profesor NAVES. Se revisan los avances del Business Plan y se define la recta final del proyecto.',
    tags: ['Obligatoria — Requisito de grado'],
  },
  {
    posicion: 6,
    fecha: '15 Septiembre',
    titulo: 'Reunión 60 días antes',
    descripcion:
      'Reunión grupal a las 6:30 PM. Cada equipo debe tener una lista clara y fechada de lo que falta para completar el documento. Es el momento de definir el plan de cierre.',
    tags: ['Obligatoria — Requisito de grado'],
  },
  {
    posicion: 7,
    fecha: '14 Noviembre',
    titulo: 'Entrega anticipada (recomendada)',
    descripcion:
      'Fecha recomendada para subir los documentos con margen y evitar fallas de plataforma. No cambia la fecha oficial de entrega.',
    tags: ['Recomendado'],
  },
  {
    posicion: 8,
    fecha: '17 Noviembre',
    titulo: 'Entrega final',
    descripcion:
      'Entrega de los cuatro documentos finales antes de las 7:59 AM: Business Plan (PDF), Resumen Ejecutivo (PDF), Logo (JPG) y Modelo financiero (Excel). Se recomienda subir con 3 días de anticipación.',
  },
  {
    posicion: 9,
    fecha: '18 Noviembre',
    titulo: 'Reunión preparación presentación',
    descripcion:
      'Reunión grupal a las 6:30 PM. Repaso de la estructura de la presentación, manejo del tiempo y preparación para las preguntas del panel.',
    tags: ['Obligatoria — Requisito de grado'],
  },
  {
    posicion: 10,
    fecha: '24 — 25 Noviembre',
    titulo: 'Presentaciones NAVES',
    descripcion:
      'Jornadas de presentación final. Cada equipo presenta en la jornada asignada: 10 minutos de presentación + 10 minutos de preguntas de los panelistas.',
    tags: ['Asistencia obligatoria'],
  },
];

export default function ConsultaCronograma() {
  const navigate = useNavigate();

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

          {/* Línea de tiempo: riel vertical a la izquierda con puntos rojos.
              Una sola columna (responsive y consistente con la app), evocando
              el timeline del sitio de referencia con los tokens de marca. */}
          <ol className="relative">
            <div
              className="absolute left-[8px] top-2 bottom-2 w-0.5 bg-inalde-gray-light"
              aria-hidden="true"
            />
            {HITOS_CRONOGRAMA.map((h) => (
              <li key={h.posicion} className="relative pl-10 pb-9 last:pb-0">
                <span
                  className="absolute left-0 top-1 w-[18px] h-[18px] rounded-full bg-inalde-red ring-4 ring-white"
                  aria-hidden="true"
                />
                <span className="inline-block text-inalde-red bg-inalde-red/[0.08] text-xs font-primary font-bold tracking-widest uppercase rounded px-3 py-1">
                  {h.fecha}
                </span>
                <h2 className="font-primary font-bold text-lg text-inalde-text mt-3 mb-1">{h.titulo}</h2>
                <p className="font-body text-inalde-gray text-sm leading-relaxed">{h.descripcion}</p>
                {h.tags && h.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {h.tags.map((t) => (
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
