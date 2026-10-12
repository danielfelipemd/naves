// backend/src/lib/traerTodasLasFilas.ts
//
// Trae una lista completa aunque pase de 1000 filas.
//
// POR QUÉ EXISTE
//
// PostgREST corta cada respuesta en 1000 filas (PGRST_DB_MAX_ROWS=1000 en el
// compose naves/bd) y NO avisa: no hay error, la lista simplemente sale
// incompleta. También corta las funciones que devuelven filas (.rpc()).
// En CalzadoPro costó facturas sin cliente el 10/10/2026, el día que una
// tienda pasó de 1000 clientes. Aquí ninguna lista lo alcanza todavía, pero
// las que recorren TODAS las cohortes (participantes, asignaciones…) crecen
// con cada cohorte nueva.
//
// CÓMO SE USA
//
//   const { data, error } = await traerTodasLasFilas((desde, hasta) =>
//     supabaseAdmin.from('participantes_lista').select('id, nombre_completo')
//       .order('nombre_completo').order('id')
//       .range(desde, hasta));
//
// La consulta TIENE que llevar un orden que termine en una columna única
// (normalmente `id`). Sin eso, Postgres no garantiza el mismo orden entre una
// página y la siguiente, y una fila puede salir dos veces o ninguna.

const TAMANO_PAGINA = 1000;

/** Tope de seguridad: 50 páginas son 50.000 filas. Nada de NAVES llega ahí. */
const MAX_PAGINAS = 50;

type Respuesta<T> = { data: T[] | null; error: any };

export async function traerTodasLasFilas<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
  // Cómo reconocer una fila repetida. Por defecto, su `id`; las tablas sin
  // `id` (p. ej. usuario_roles, cuya clave es auth_user_id + rol_id) pasan la
  // suya.
  clave: (fila: T) => unknown = (fila: any) => fila?.id,
): Promise<Respuesta<T>> {
  const filas: T[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const desde = pagina * TAMANO_PAGINA;
    const { data, error } = await consulta(desde, desde + TAMANO_PAGINA - 1);
    if (error) return { data: null, error };
    const lote = data ?? [];
    filas.push(...lote);
    if (lote.length < TAMANO_PAGINA) break;
  }

  // Si alguien crea una fila mientras se pagina, las siguientes se corren un
  // puesto y la última de una página reaparece al principio de la otra.
  const vistos = new Set<unknown>();
  const unicas = filas.filter((f) => {
    const k = clave(f);
    if (k == null) return true;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return { data: unicas, error: null };
}

/**
 * Parte una lista en tandas. Para los `.in()` con UUID: la URL de PostgREST
 * pasa por Kong/Cloudflare y a partir de ~206 UUID (≈8,2 KB, con las comas
 * codificadas como %2C, que es como lo arma supabase-js) la petición muere con
 * 414 «URI too long». supabase-js NO lanza ese error: lo devuelve en `error`,
 * así que un `const { data }` sin mirar `error` lo convierte en «no hay filas».
 */
export function enTandas<T>(lista: T[], tamano = 150): T[][] {
  const tandas: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) tandas.push(lista.slice(i, i + tamano));
  return tandas;
}
