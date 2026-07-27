import { supabaseAdmin } from '../db/supabase.js';
import { sendEmail } from './email.js';
import { decryptPII } from '../auth/crypto.js';

/**
 * Correo de confirmación de la ENTREGA DEL TRABAJO DE GRADO. Se envía a TODOS
 * los integrantes del equipo (no solo a quien cargó el archivo) en el momento
 * en que la entrega queda completa:
 *   · Business Plan → los cuatro documentos (proyecto final, one pager, logo y
 *     modelo financiero).
 *   · Caso / Proyecto de Investigación → el documento del proyecto final.
 * Falla silenciosamente: nunca bloquea la respuesta al upload.
 */

const MODALIDAD_LABEL: Record<string, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

/** ¿La entrega del equipo quedó completa? Misma regla que muestra la pantalla. */
export async function entregaTrabajoGradoCompleta(anteproyectoId: string): Promise<boolean> {
  const { data: ant } = await supabaseAdmin
    .from('anteproyectos')
    .select('archivo_proyecto_final_path, equipos:equipos!inner ( tipo_trabajo_grado, proyecto_definitivo_id )')
    .eq('id', anteproyectoId)
    .maybeSingle();
  if (!ant) return false;
  if (!(ant as any).archivo_proyecto_final_path) return false;

  const modalidad = (ant as any).equipos?.tipo_trabajo_grado;
  if (modalidad !== 'business_plan') return true;

  const proyectoId = (ant as any).equipos?.proyecto_definitivo_id;
  if (!proyectoId) return false;
  const { data: cont } = await supabaseAdmin
    .from('proyecto_contenido')
    .select('one_pager_path, logo_path, modelo_financiero_path')
    .eq('proyecto_id', proyectoId)
    .maybeSingle();
  return !!(cont as any)?.one_pager_path
    && !!(cont as any)?.logo_path
    && !!(cont as any)?.modelo_financiero_path;
}

export async function notificarEntregaTrabajoGrado(args: {
  equipoId: string;
  fechaIso: string;
}): Promise<void> {
  try {
    const { data: equipo } = await supabaseAdmin
      .from('equipos')
      .select(`
        nombre_equipo, cohorte_id, tipo_trabajo_grado, proyecto_definitivo_id,
        miembros_equipo (
          posicion,
          participantes_lista ( nombre_completo, email_encriptado )
        )
      `)
      .eq('id', args.equipoId)
      .maybeSingle();
    if (!equipo) return;

    const modalidad = (equipo as any).tipo_trabajo_grado as string | null;
    const esBP = modalidad === 'business_plan';
    const modalidadLabel = modalidad ? (MODALIDAD_LABEL[modalidad] ?? modalidad) : '—';
    const cohorte = (equipo as any).cohorte_id ?? '';

    // El equipo no tiene nombre propio: lo identifica el nombre del proyecto.
    let nombreProyecto: string = (equipo as any).nombre_equipo || '';
    const proyectoId = (equipo as any).proyecto_definitivo_id as string | null;
    if (proyectoId) {
      const { data: proy } = await supabaseAdmin
        .from('proyectos').select('nombre').eq('id', proyectoId).maybeSingle();
      if ((proy as any)?.nombre) nombreProyecto = String((proy as any).nombre).trim();
    }
    if (!nombreProyecto) nombreProyecto = 'sin nombre registrado';

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

    const documentos = esBP
      ? 'Business Plan, Resumen (One Pager), Logo y Modelo Financiero'
      : 'el documento del proyecto final';

    for (const m of miembros) {
      let email = '';
      try { email = decryptPII(m.email_encriptado); } catch { continue; }
      if (!email) continue;

      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #1a1a1a;">
          <div style="border-bottom: 3px solid #e30613; padding-bottom: 14px; margin-bottom: 22px;">
            <p style="color: #888; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; margin: 0;">Confirmación de entrega — Programa MBA</p>
            <h2 style="color: #1a1a1a; margin: 6px 0 0 0; font-size: 22px;">¡Felicitaciones! Entregaron su trabajo de grado</h2>
          </div>
          <p><strong>${m.nombre_completo}</strong>:</p>
          <p>Reciba un cordial saludo. Le confirmamos que el trabajo de grado de su equipo, con nombre
          <strong>${nombreProyecto}</strong>, fue entregado en el sistema de trabajos de grado del MBA.
          Con esto completan la entrega de ${documentos}.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
            <tr><td style="padding: 6px 0; color:#888; width: 40%;">Trabajo de grado</td><td style="padding: 6px 0;"><strong>${nombreProyecto}</strong></td></tr>
            <tr><td style="padding: 6px 0; color:#888; vertical-align: top;">Participantes</td><td style="padding: 6px 0;">${miembrosNombres}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Modalidad</td><td style="padding: 6px 0;">${modalidadLabel}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Cohorte</td><td style="padding: 6px 0;">${cohorte}</td></tr>
            <tr><td style="padding: 6px 0; color:#888;">Fecha y hora</td><td style="padding: 6px 0;"><strong>${fechaStr}</strong></td></tr>
          </table>
          <p style="font-size: 13px; color:#555;">La entrega queda registrada de manera definitiva. Ahora solo les resta <strong>preparar su presentación</strong>. ¡Mucho éxito en la recta final!</p>
          <p style="margin-top: 22px;">Cordialmente,</p>
          <p style="margin: 4px 0;"><strong>Programa MBA</strong><br/>INALDE Business School</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0 16px;"/>
          <p style="font-size: 11px; color: #888; line-height: 1.5; margin: 0;">
            <strong>INALDE Business School</strong> — Programa MBA<br/>
            Sistema de trabajos de grado. Este es un mensaje automático, por favor no responda a este correo.
          </p>
        </div>`;
      try {
        await sendEmail(email, 'Confirmación de entrega del trabajo de grado — MBA INALDE', html);
      } catch { /* best effort */ }
    }
  } catch (e) {
    console.warn('[entrega.trabajo-grado] notificación falló:', (e as Error).message);
  }
}
