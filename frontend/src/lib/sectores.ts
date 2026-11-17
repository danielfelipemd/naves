import { useEffect, useState } from 'react';
import { api } from './api';

// Catálogo de sectores para los proyectos NAVES.
// Desde el 17-nov-2026 la lista VIVA está en la base (tabla sectores, sql/53) y
// la edita el súper admin en /admin/sectores; se lee con useSectores(). Esta
// constante queda solo como respaldo si la API no responde.
// Aprobado por JMV (20-jul-2026), consolidado del histórico de programaciones
// 2017–2026 (antes era texto libre con 150+ etiquetas duplicadas/erróneas).
// Se usa como input de la programación: las jornadas se arman en bloques de 5
// presentaciones del mismo sector. NO confundir con AREAS_AFINIDAD (afinidad de
// profesores) en lib/areas.ts.
export const SECTORES = [
  'Agro y Agroindustria',
  'Alimentos y Bebidas',
  'Salud / HealthTech',
  'Tecnología / Software / IA',
  'Plataformas digitales / Marketplace',
  'Servicios financieros / Fintech / Insurtech',
  'Inmobiliario / Construcción / Proptech',
  'Energía / Movilidad',
  'Energía',
  'Industrial',
  'Oil & Gas',
  'Economía circular / Reciclaje / Ambiental',
  'Educación / Edtech',
  'Moda / Vestuario y Calzado / Lujo',
  'Retail / Productos de consumo',
  'Logística / Transporte / Comercio exterior',
  'Turismo / Entretenimiento / Cultura',
  'Consultoría y servicios profesionales',
  'Bienestar / Deporte / Servicios personales',
  'Sector social',
  'Otro',
] as const;
// 17-nov-2026: JMV pide añadir «Energía» (a secas), «Sector social», «Industrial» y «Oil & Gas».

export type Sector = (typeof SECTORES)[number];

// Sectores activos del catálogo, en el orden que fijó el súper admin. Arranca
// con la lista de respaldo y la reemplaza en cuanto responde la API. Una sola
// petición por carga de página (caché en memoria); invalidarSectores() la
// fuerza de nuevo tras editar el catálogo.
let cache: Promise<string[]> | null = null;
function cargarSectores(): Promise<string[]> {
  if (!cache) {
    cache = api.get('/sectores')
      .then((r) => (Array.isArray(r.data) && r.data.length ? (r.data as string[]) : [...SECTORES]))
      .catch(() => { cache = null; return [...SECTORES]; });
  }
  return cache;
}
const oyentes = new Set<() => void>();
// Tras agregar/renombrar/ocultar: descarta la caché y avisa a cada lista
// abierta para que se recargue sola.
export function invalidarSectores() { cache = null; oyentes.forEach((f) => f()); }
export function useSectores(): string[] {
  const [lista, setLista] = useState<string[]>([...SECTORES]);
  useEffect(() => {
    let vivo = true;
    const cargar = () => { cargarSectores().then((l) => { if (vivo) setLista(l); }); };
    cargar();
    oyentes.add(cargar);
    return () => { vivo = false; oyentes.delete(cargar); };
  }, []);
  return lista;
}
