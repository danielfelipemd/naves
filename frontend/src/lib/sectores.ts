// Catálogo CERRADO de sectores para los proyectos NAVES.
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
  'Economía circular / Reciclaje / Ambiental',
  'Educación / Edtech',
  'Moda / Vestuario y Calzado / Lujo',
  'Retail / Productos de consumo',
  'Logística / Transporte / Comercio exterior',
  'Turismo / Entretenimiento / Cultura',
  'Consultoría y servicios profesionales',
  'Bienestar / Deporte / Servicios personales',
  'Otro',
] as const;

export type Sector = (typeof SECTORES)[number];
