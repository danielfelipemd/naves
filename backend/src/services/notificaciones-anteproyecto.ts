import { supabaseAdmin } from '../db/supabase.js';
import { sendEmail } from './email.js';
import { decryptPII } from '../auth/crypto.js';

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion' | null;

export interface OpcionesCasoPI {
  /** Nombre del director asignado al equipo. */
  directorNombre: string;
  /**
   * Frase que se intercala en el cuerpo describiendo el estado del adjunto
   * (ej. "La dirección asignada, a cargo de X, ya fue notificada por correo
   * electrónico y recibió el documento como archivo adjunto.").
   */
  lineaAdjuntoParticipante: string;
  /** Nombre del participante que disparó la carga (opcional). */
  cargadorNombre?: string;
}

const MODALIDAD_LABEL: Record<Exclude<Modalidad, null>, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

/**
 * Envia un único correo de confirmación a cada miembro del equipo informando
 * que su anteproyecto fue registrado en la plataforma. Es el mismo correo
 * para las tres modalidades (BP, Caso, PI); la fila «Dirección asignada» y la
 * línea sobre el adjunto solo aparecen en caso/PI.
 * Falla silenciosamente: nunca bloquea la respuesta al cliente.
 */
export async function notificarRegistroAnteproyectoAParticipantes(args: {
  equipoId: string;
  modalidad: Modalidad;
  fechaIso: string;
  casoPI?: OpcionesCasoPI;
}): Promise<void> {
  try {
    const { data: equipo } = await supabaseAdmin
      .from('equipos')
      .select(`
        nombre_equipo, cohorte_id,
        miembros_equipo (
          posicion,
          participantes_lista ( nombre_completo, email_encriptado )
        )
      `)
      .eq('id', args.equipoId)
      .maybeSingle();
    if (!equipo) return;

    const modalidadLabel = args.modalidad ? MODALIDAD_LABEL[args.modalidad] : '—';
    const equipoNombre = (equipo as any).nombre_equipo || '(sin nombre)';
    const cohorte = (equipo as any).cohorte_id ?? '';

    const miembros = (((equipo as any).miembros_equipo ?? []) as any[])
      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
      .map((m) => m.participantes_lista)
      .filter(Boolean);
    const miembrosNombres = miembros.map((m: any) => m.nombre_completo).join(', ');

    const fechaStr = new Date(args.fechaIso).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const filaDireccion = args.casoPI
      ? `<tr><td style="padding: 6px 0; color:#888;">Directores asignados</td><td style="padding: 6px 0;">${args.casoPI.directorNombre}</td></tr>`
      : '';
    const parrafoAdjunto = args.casoPI?.lineaAdjuntoParticipante
      ? ` ${args.casoPI.lineaAdjuntoParticipante}`
      : '';

    for (const m of miembros) {
      let email = '';
      try { email = decryptPII(m.email_encriptado); } catch { continue; }
      if (!email) continue;

      const cargador = args.casoPI?.cargadorNombre && args.casoPI.cargadorNombre !== m.nombre_completo
        ? args.casoPI.cargadorNombre
        : null;

      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #1a1a1a;">
          <div style="border-bottom: 3px solid #e30613; padding-bottom: 14px; margin-bottom: 22px;">
            <p style="color: #888; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; margin: 0;">Confirmación de carga — Programa MBA</p>
            <h2 style="color: #1a1a1a; margin: 6px 0 0 0; font-size: 22px;">El anteproyecto de su equipo fue cargado</h2>
          </div>
          <p><strong>${m.nombre_completo}</strong>:</p>
          <p>Reciba un cordial saludo. Le confirmamos que el anteproyecto del equipo
          <strong>${equipoNombre}</strong> fue cargado en el sistema de trabajos de grado del
          MBA${cargador ? ` por ${cargador}` : ''}.${parrafoAdjunto}</p>
          <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
            <tr><td style="padding: 6px 0; color:#888; width: 40%;">Equipo</td><td style="padding: 6px 0;"><strong>${equipoNombre}</strong></td></tr>
            <tr><td style="padding: 6px 0; color:#888; vertical-align: top;">Miembros</td><td style="padding: 6px 0;">${miembrosNombres}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Modalidad</td><td style="padding: 6px 0;">${modalidadLabel}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Cohorte</td><td style="padding: 6px 0;">${cohorte}</td></tr>
            ${filaDireccion}
            <tr><td style="padding: 6px 0; color:#888;">Fecha y hora</td><td style="padding: 6px 0;"><strong>${fechaStr}</strong></td></tr>
          </table>
          <p style="font-size: 13px; color:#555;">El anteproyecto queda registrado de manera
          definitiva y no podrá ser reemplazado.</p>
          <p style="margin-top: 18px;">Cordialmente,</p>
          <p style="margin: 4px 0;"><strong>Programa MBA</strong><br/>INALDE Business School</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0 16px;"/>
          <p style="font-size: 11px; color: #888; line-height: 1.5; margin: 0;">
            <strong>INALDE Business School</strong> — Programa MBA<br/>
            Sistema de trabajos de grado. Este es un mensaje automático, por favor no responda a este correo.
          </p>
        </div>`;
      try {
        await sendEmail(email, 'Confirmación de carga del anteproyecto — MBA INALDE', html);
      } catch { /* best effort */ }
    }
  } catch (e) {
    console.warn('[anteproyecto.registrado] notificación fallo:', (e as Error).message);
  }
}
