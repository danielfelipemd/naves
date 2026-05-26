export const AREAS_AFINIDAD = [
  'Alimentos',
  'Salud',
  'Educación',
  'Tecnología',
  'Retail',
  'Servicios',
  'Finanzas',
  'Sostenibilidad',
  'Agro',
  'Turismo',
  'Construcción',
  'Diseño',
  'Logística',
  'Impacto social',
  'Otro',
] as const;

export type AreaAfinidad = (typeof AREAS_AFINIDAD)[number];
