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

export interface ProyectoCronograma {
  nombre: string;
  tipo?: string | null;
  sector?: string | null;
  ciiu?: string | null;
  hitos: Array<{
    posicion: number;
    descripcion: string;
    fecha_inicio: string;
    fecha_fin: string;
  }>;
}

export interface OpcionesBP {
  /**
   * Proyectos del equipo BP con sus hitos. Si llega, el correo agrega una
   * seccion 'Cronograma' al final.
   */
  proyectos: ProyectoCronograma[];
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
  bp?: OpcionesBP;
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

    // Cronograma (solo BP): tabla(s) de hitos ordenados por fecha_inicio.
    const fmtFecha = (iso: string): string => {
      if (!iso) return '—';
      const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
      return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
    };
    const seccionCronograma = (() => {
      const proys = args.bp?.proyectos ?? [];
      if (!proys.length) return '';
      const bloques = proys.map((p, idx) => {
        const hitosOrdenados = [...(p.hitos ?? [])].sort((a, b) =>
          (a.fecha_inicio || '').localeCompare(b.fecha_inicio || '') || a.posicion - b.posicion,
        );
        const filas = hitosOrdenados.length
          ? hitosOrdenados.map((h, i) => `
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 8px 6px; color:#888; width: 32px;">${i + 1}</td>
              <td style="padding: 8px 6px;">${h.descripcion || '—'}</td>
              <td style="padding: 8px 6px; white-space: nowrap; color:#555;">${fmtFecha(h.fecha_inicio)}</td>
              <td style="padding: 8px 6px; white-space: nowrap; color:#555;">${fmtFecha(h.fecha_fin)}</td>
            </tr>`).join('')
          : `<tr><td colspan="4" style="padding: 8px 6px; color:#888; font-style: italic;">Sin hitos registrados.</td></tr>`;
        const meta = [p.sector, p.ciiu ? `CIIU ${p.ciiu}` : '', p.tipo].filter(Boolean).join(' · ');
        const tituloProy = proys.length > 1 ? `Proyecto ${idx + 1} — ${p.nombre}` : p.nombre;
        return `
          <div style="margin-top: 22px;">
            <p style="margin: 0 0 4px 0; font-weight: 700; color:#1a1a1a;">${tituloProy}</p>
            ${meta ? `<p style="margin: 0 0 8px 0; color:#888; font-size: 12px;">${meta}</p>` : ''}
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; border-top: 2px solid #e30613;">
              <thead>
                <tr style="background: #f5f5f5; text-align: left;">
                  <th style="padding: 8px 6px; color:#888; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">#</th>
                  <th style="padding: 8px 6px; color:#888; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Hito</th>
                  <th style="padding: 8px 6px; color:#888; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Inicio</th>
                  <th style="padding: 8px 6px; color:#888; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Fin</th>
                </tr>
              </thead>
              <tbody>${filas}</tbody>
            </table>
          </div>`;
      }).join('');
      return `
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0 8px;"/>
        <p style="color: #888; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; margin: 8px 0 0 0;">Cronograma</p>
        <p style="font-size: 13px; color:#555; margin: 4px 0 0 0;">A continuación se relaciona el cronograma de hitos definido por el equipo. Manten este correo como referencia; el cronograma queda registrado en la plataforma.</p>
        ${bloques}`;
    })();

    // Pluralizacion: si el equipo presento mas de un proyecto BP, usamos plural
    // ('los anteproyectos ... fueron cargados ... quedan registrados').
    const nProyectos = args.bp?.proyectos.length ?? 1;
    const plural = nProyectos > 1;
    const tituloAnteproyecto = plural
      ? 'Los anteproyectos de su equipo fueron cargados'
      : 'El anteproyecto de su equipo fue cargado';
    const cuerpoAnteproyecto = plural
      ? 'Le confirmamos que los anteproyectos del equipo'
      : 'Le confirmamos que el anteproyecto del equipo';
    const verboAnteproyecto = plural ? 'fueron cargados' : 'fue cargado';
    const cierreAnteproyecto = plural
      ? 'Los anteproyectos quedan registrados de manera definitiva.'
      : 'El anteproyecto queda registrado de manera definitiva.';

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
            <h2 style="color: #1a1a1a; margin: 6px 0 0 0; font-size: 22px;">${tituloAnteproyecto}</h2>
          </div>
          <p><strong>${m.nombre_completo}</strong>:</p>
          <p>Reciba un cordial saludo. ${cuerpoAnteproyecto}
          <strong>${equipoNombre}</strong> ${verboAnteproyecto} en el sistema de trabajos de grado del
          MBA${cargador ? ` por ${cargador}` : ''}.${parrafoAdjunto}</p>
          <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
            <tr><td style="padding: 6px 0; color:#888; width: 40%;">Equipo</td><td style="padding: 6px 0;"><strong>${equipoNombre}</strong></td></tr>
            <tr><td style="padding: 6px 0; color:#888; vertical-align: top;">Miembros</td><td style="padding: 6px 0;">${miembrosNombres}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Modalidad</td><td style="padding: 6px 0;">${modalidadLabel}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Cohorte</td><td style="padding: 6px 0;">${cohorte}</td></tr>
            ${filaDireccion}
            <tr><td style="padding: 6px 0; color:#888;">Fecha y hora</td><td style="padding: 6px 0;"><strong>${fechaStr}</strong></td></tr>
          </table>
          <p style="font-size: 13px; color:#555;">${cierreAnteproyecto}</p>
          ${seccionCronograma}
          <p style="margin-top: 22px;">Cordialmente,</p>
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
