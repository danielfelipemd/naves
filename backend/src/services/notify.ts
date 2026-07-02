import { supabaseAdmin } from '../db/supabase.js';

// Notificaciones dentro de la plataforma (Módulo E). El destinatario se
// identifica por su auth_user_id (el `sub` del JWT). Inserción best-effort:
// nunca lanza (una notificación fallida no debe tumbar el flujo que la origina).

export interface NuevaNotificacion {
  destinatario_auth_id: string;
  tipo: string;
  titulo: string;
  cuerpo?: string | null;
  enlace?: string | null;
}

export async function notificar(items: NuevaNotificacion[]): Promise<number> {
  const filas = items.filter((n) => n.destinatario_auth_id && n.titulo);
  if (!filas.length) return 0;
  try {
    const { error } = await supabaseAdmin.from('notificaciones').insert(
      filas.map((n) => ({
        destinatario_auth_id: n.destinatario_auth_id,
        tipo: n.tipo,
        titulo: n.titulo,
        cuerpo: n.cuerpo ?? null,
        enlace: n.enlace ?? null,
      })),
    );
    if (error) { console.warn('[notify] insert falló:', error.message); return 0; }
    return filas.length;
  } catch (e) {
    console.warn('[notify] excepción:', (e as Error).message);
    return 0;
  }
}

// Borra notificaciones previas de un tipo para un conjunto de destinatarios
// (para no duplicar al re-notificar, p.ej. si se re-publica la programación).
export async function limpiarNotificaciones(tipo: string, destinatarios: string[]): Promise<void> {
  if (!destinatarios.length) return;
  try {
    await supabaseAdmin.from('notificaciones').delete().eq('tipo', tipo).in('destinatario_auth_id', destinatarios);
  } catch (e) {
    console.warn('[notify] limpiar falló:', (e as Error).message);
  }
}
