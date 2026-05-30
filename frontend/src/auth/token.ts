// Cache sincrono del access_token de Supabase Auth.
//
// PROBLEMA QUE RESUELVE: el interceptor de axios antes hacia
//   `const { data } = await supabase.auth.getSession()`
// en cada request. Esa llamada puede colgar si supabase-js esta refrescando
// el token o si Supabase Auth tiene latencia momentanea. Cada request del
// frontend dependia de ello, asi que cualquier ventana de Supabase lento
// se traducia en "se queda cargando" en login y en las paginas del admin/
// participante.
//
// Ahora el token vive en este modulo en memoria. El store de auth lo
// actualiza al arrancar y en cada onAuthStateChange. El interceptor lo
// lee de forma sincrona sin tocar Supabase.

let cachedToken: string | null = null;

export function getCachedToken(): string | null {
  return cachedToken;
}

export function setCachedToken(token: string | null): void {
  cachedToken = token;
}
