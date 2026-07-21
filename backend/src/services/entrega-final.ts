// Fuente única de verdad para "¿el trabajo de grado definitivo está ENTREGADO?".
//
// Un proyecto NO puede contar como entregado si le falta cualquiera de sus
// documentos. Por modalidad:
//   - business_plan: PDF del Business Plan + one pager + logo + modelo financiero
//     (los CUATRO documentos de la entrega final).
//   - caso / proyecto_investigacion: solo el PDF definitivo (no llevan material).
//
// El PDF vive en anteproyectos.archivo_proyecto_final_path; el material (one
// pager, logo, modelo financiero) en proyecto_contenido, colgado del proyecto
// definitivo. Cualquier cálculo de "entregado / definitivo entregado" debe pasar
// por aquí para no quedar desalineado entre pantallas.

export type ModalidadTG = 'business_plan' | 'caso' | 'proyecto_investigacion' | null | undefined;

export interface DocsEntregaFinal {
  archivoFinalPath?: string | null;
  onePagerPath?: string | null;
  logoPath?: string | null;
  modeloFinancieroPath?: string | null;
}

/** ¿La entrega final está COMPLETA? Un documento faltante ⇒ NO entregado. */
export function entregaFinalCompleta(modalidad: ModalidadTG, docs: DocsEntregaFinal): boolean {
  if (!docs.archivoFinalPath) return false;
  if (modalidad === 'business_plan') {
    return !!docs.onePagerPath && !!docs.logoPath && !!docs.modeloFinancieroPath;
  }
  // caso / proyecto_investigacion: el trabajo de grado es un único documento.
  return true;
}
