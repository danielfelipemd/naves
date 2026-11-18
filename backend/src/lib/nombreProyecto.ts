// Ayudante de la revisión automática de posts (routes/proyectos-db.ts).

/**
 * Quita del texto el nombre del proyecto para que sus números no cuenten como cifra.
 * La IA suele abreviarlo («Fundación Nexo 3-21» en vez de «Fundación Nexo 3-21. Conectamos
 * Capacidades con Oportunidades»), así que se quitan: el nombre completo, cada tramo antes de
 * un punto, dos puntos, coma o guion largo, y cada palabra del nombre que lleve dígitos.
 */
export function sinNombreProyecto(texto: string, nombreProyecto: string): string {
  const nombre = nombreProyecto.trim().replace(/\s+/g, ' ');
  if (!nombre) return texto;
  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tramos = new Set<string>([nombre]);
  for (const t of nombre.split(/\s*(?:[.:;,–—]|\s-\s)\s*/)) if (t.trim().length >= 3) tramos.add(t.trim());
  for (const w of nombre.split(/\s+/)) {
    const limpia = w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
    if (/\d/.test(limpia)) tramos.add(limpia);
  }
  // Primero los más largos, para no partir el nombre completo en pedazos.
  for (const t of [...tramos].sort((a, b) => b.length - a.length)) {
    texto = texto.replace(new RegExp(escapar(t).replace(/ /g, '\\s+'), 'giu'), 'Proyecto');
  }
  return texto;
}
