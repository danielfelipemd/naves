import { useMemo, useState } from 'react';

/**
 * Ordenamiento por encabezado para las tablas de listados (patrón estándar:
 * clic ordena ascendente, otro clic descendente, con una flecha indicando el
 * orden activo). Se usa en todas las pantallas con listados para que se
 * comporten igual.
 *
 *   const orden = useOrdenTabla<Fila>('nombre');
 *   const filas = orden.ordenar(filtrados, { nombre: (f) => f.nombre, ... });
 *   <th><ThOrden orden={orden} campo="nombre">Nombre</ThOrden></th>
 */
export type Direccion = 'asc' | 'desc';
export type ValorOrden = string | number | null | undefined;

export interface OrdenTabla {
  campo: string | null;
  direccion: Direccion;
  alternar: (campo: string) => void;
  ordenar: <T>(filas: T[], accesores: Record<string, (f: T) => ValorOrden>) => T[];
}

export function useOrdenTabla(campoInicial: string | null = null): OrdenTabla {
  const [campo, setCampo] = useState<string | null>(campoInicial);
  const [direccion, setDireccion] = useState<Direccion>('asc');

  function alternar(nuevo: string) {
    if (nuevo === campo) { setDireccion((d) => (d === 'asc' ? 'desc' : 'asc')); return; }
    setCampo(nuevo);
    setDireccion('asc');
  }

  const ordenar = useMemo(() => (
    function <T>(filas: T[], accesores: Record<string, (f: T) => ValorOrden>): T[] {
      const get = campo ? accesores[campo] : undefined;
      if (!get) return filas;
      const factor = direccion === 'asc' ? 1 : -1;
      // Copia: nunca mutamos el array del estado.
      return [...filas].sort((a, b) => {
        const va = get(a), vb = get(b);
        // Los vacíos siempre al final, sin importar la dirección.
        const aVacio = va === null || va === undefined || va === '';
        const bVacio = vb === null || vb === undefined || vb === '';
        if (aVacio && bVacio) return 0;
        if (aVacio) return 1;
        if (bVacio) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
        // localeCompare con 'es' para que tildes y ñ queden donde se esperan.
        return String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' }) * factor;
      });
    }
  ), [campo, direccion]);

  return { campo, direccion, alternar, ordenar };
}

/** Encabezado clicable con indicador de orden. */
export function ThOrden({
  orden, campo, children, className = '', variante = 'claro',
}: {
  orden: OrdenTabla;
  campo: string;
  children: React.ReactNode;
  className?: string;
  /** 'oscuro' para las tablas con encabezado de fondo oscuro (AoL, actas). */
  variante?: 'claro' | 'oscuro';
}) {
  const activo = orden.campo === campo;
  const base = variante === 'oscuro'
    ? 'text-left font-primary font-bold text-[0.68rem] tracking-widest uppercase px-3 py-2.5 whitespace-nowrap'
    : 'px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray';
  return (
    <th
      className={`${base} ${className}`}
      aria-sort={activo ? (orden.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => orden.alternar(campo)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition ${
          variante === 'oscuro' ? 'hover:text-white/70' : 'hover:text-inalde-red'}`}
        title="Ordenar por esta columna"
      >
        {children}
        <span aria-hidden="true" className={
          activo
            ? (variante === 'oscuro' ? 'text-white' : 'text-inalde-red')
            : (variante === 'oscuro' ? 'text-white/40' : 'text-inalde-gray-light')
        }>
          {activo ? (orden.direccion === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}
