// Calificación del acta de Caso.
//
// El Caso no se cierra con un simple aceptado/rechazado: lleva una nota en la
// escala A, B+, B, B-, C. El resultado (acta.nota) se deduce de ella para que el
// resto del sistema —avance, lotes, Mi acta— siga funcionando igual.

export const ESCALA_CASO = ['A', 'B+', 'B', 'B-', 'C'] as const;
export type Calificacion = (typeof ESCALA_CASO)[number];

/** Calificaciones con las que el Caso queda aprobado. La C no aprueba (Daniel, 23/11/2026). */
export const APROBATORIAS: readonly Calificacion[] = ['A', 'B+', 'B', 'B-'];

export function esCalificacion(v: unknown): v is Calificacion {
  return typeof v === 'string' && (ESCALA_CASO as readonly string[]).includes(v);
}

/** El resultado aceptado/rechazado que corresponde a una calificación. */
export function notaDeCalificacion(c: Calificacion): 'aceptado' | 'rechazado' {
  return APROBATORIAS.includes(c) ? 'aceptado' : 'rechazado';
}
