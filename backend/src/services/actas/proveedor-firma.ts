// =====================================================================
// Interfaz del PROVEEDOR DE FIRMA electrónica de las actas.
//
// El proveedor real (DocuSign / ZapSign / Autentic) NO está confirmado todavía
// (decisión de Juan Manuel; recomendación: ZapSign por firma en lote nativa y
// costo, Ley 527/1999 · Decreto 2364/2012). Hasta entonces, el módulo usa el
// STUB de abajo, que simula el ciclo (crear sobre, firmar en lote, webhook) para
// operar de punta a punta. Cuando se defina el proveedor, se implementa esta
// misma interfaz y se cambia `proveedorActivo`. El resto del módulo NO cambia.
// =====================================================================

export interface SobreCreado { sobreId: string; }

export interface ProveedorFirma {
  nombre: string;
  esStub: boolean;
  // Crea el sobre de firma para un firmante con TODAS sus actas (firma en lote,
  // un solo acto). `rutaFirmantes` mapea el rol/persona a los campos del PDF.
  crearSobreLote(firmante: { rol: string; nombre: string; email: string | null }, actaIds: number[]): Promise<SobreCreado>;
  // Interpreta un evento del webhook del proveedor → nuevo estado de firma.
  interpretarWebhook(evento: any): { sobreId: string; estado: 'firmada' | 'rechazada' | 'vencida' } | null;
}

// STUB: no crea sobres reales; simula que el sobre se creó. La "firma" real la
// dispara el endpoint de firma en lote del módulo (también stub) mientras no haya
// proveedor. Marcado esStub=true para que la UI lo advierta.
export const proveedorStub: ProveedorFirma = {
  nombre: 'stub (sin proveedor configurado)',
  esStub: true,
  async crearSobreLote(firmante, actaIds) {
    return { sobreId: `stub-${firmante.rol}-${Date.now?.() ?? actaIds.length}-${actaIds[0] ?? 0}` };
  },
  interpretarWebhook() { return null; },
};

export const proveedorActivo: ProveedorFirma = proveedorStub;
