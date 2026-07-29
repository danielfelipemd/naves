// =====================================================================
// AoL — código de cohorte (una sola fuente de verdad)
// =====================================================================
// El histórico de AoL identifica cada cohorte por un código del estilo
// "FS 2024-2026" derivado de la etiqueta de la plataforma. Antes esta lógica
// estaba copiada en tres sitios (dashboard, export y firma), con el riesgo de
// que se separaran.
//
// IMPORTANTE — cohortes de prueba: "QA MBA FS 24-26" y "MBA FS 24-26" producían
// EL MISMO código, así que las calificaciones de prueba se mezclaban con los
// datos reales de la cohorte FS 24-26 en el histórico AACSB, sin forma de
// distinguirlas. Las cohortes de prueba llevan ahora el prefijo "QA " en su
// código: quedan aparte, visibles y borrables.
// =====================================================================

export interface CodigoAol {
  codigo: string;
  modalidad: string;
  anio_inicio: number;
  anio_fin: number;
  es_prueba: boolean;
}

/** ¿La etiqueta corresponde a una cohorte de prueba (no reportable a AACSB)? */
export function esCohorteDePrueba(etiqueta: string, cohorteId?: string): boolean {
  const txt = `${etiqueta ?? ''} ${cohorteId ?? ''}`;
  return /\b(qa|prueba|pruebas|test|demo)\b/i.test(txt);
}

/**
 * Deriva el código de AoL de la etiqueta de plataforma.
 * Ej.: "MBA INT 24-26" → "INT 2024-2026"; "QA MBA FS 24-26" → "QA FS 2024-2026".
 */
export function codigoAolDeEtiqueta(etiqueta: string, cohorteId?: string): CodigoAol {
  const modalidad = /\bINT\b/i.test(etiqueta ?? '') ? 'INT' : 'FS';
  const anios = (etiqueta ?? '').match(/(\d{2,4})\s*[-–]\s*(\d{2,4})/);
  const to4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const anio_inicio = anios ? to4(anios[1]) : 0;
  const anio_fin = anios ? to4(anios[2]) : 0;
  const es_prueba = esCohorteDePrueba(etiqueta ?? '', cohorteId);
  const base = `${modalidad} ${anio_inicio}-${anio_fin}`;
  return { codigo: es_prueba ? `QA ${base}` : base, modalidad, anio_inicio, anio_fin, es_prueba };
}
