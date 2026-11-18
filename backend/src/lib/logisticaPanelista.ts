// Lo que necesita saber la coordinación de cada panelista en una jornada: a qué
// sesiones va y qué trayectos de transporte pidió. Funciones puras: las usan el
// resumen por jornada (pantalla, Excel, «Copiar» y correo) y el correo de
// confirmación, y así dicen lo mismo en todos lados.
//
// Pedido de Daniel (18/11/2026): el resumen daba a entender que cada panelista
// iba a toda la jornada, y el transporte era solo «lo recogemos»; ahora se
// pregunta la ida y el regreso por separado (sql/60).

export interface BloqueSesion {
  numero: number;
  hora_inicio: string;   // HH:MM
  hora_fin: string;      // HH:MM
  primer_slot: number;
  ultimo_slot: number;
}

export type Sesiones =
  | { tipo: 'todas'; bloques: BloqueSesion[] }     // eligió «todas»
  | { tipo: 'bloques'; bloques: BloqueSesion[] }   // eligió bloques de esta jornada
  | { tipo: 'jornada'; bloques: BloqueSesion[] };  // asignado al día sin bloques (desde el admin)

/** Las sesiones de un panelista en una jornada. `bloquesDia` = todos los bloques del día. */
export function sesionesDelDia(asisteTodas: boolean, elegidos: number[], bloquesDia: BloqueSesion[]): Sesiones {
  if (asisteTodas) return { tipo: 'todas', bloques: bloquesDia };
  const mios = bloquesDia.filter((b) => elegidos.includes(b.numero));
  if (mios.length) return { tipo: 'bloques', bloques: mios };
  return { tipo: 'jornada', bloques: bloquesDia };
}

/** A qué hora termina su última sesión del día (null si el día no tiene bloques). */
export function terminaA(s: Sesiones): string | null {
  return s.bloques.length ? s.bloques[s.bloques.length - 1].hora_fin : null;
}

export function textoSesiones(s: Sesiones): string {
  const rango = s.bloques.length ? ` (${s.bloques[0].hora_inicio}–${s.bloques[s.bloques.length - 1].hora_fin})` : '';
  if (s.tipo === 'todas') return `Todas las sesiones${rango}`;
  if (s.tipo === 'jornada') return `Toda la jornada${rango} · sin bloques elegidos`;
  return s.bloques.map((b) => `Bloque ${b.numero} (${b.hora_inicio}–${b.hora_fin})`).join(' · ');
}

export interface LogisticaTransporte {
  necesita_transporte?: boolean | null;
  transporte_ida?: boolean | null;
  transporte_regreso?: boolean | null;
  direccion_recogida?: string | null;
  hora_recogida?: string | null;
  direccion_regreso?: string | null;
  hora_regreso?: string | null;
  transporte_por_fecha?: Record<string, boolean> | null;
}

export interface TransporteDia {
  ida: { direccion: string | null; hora: string | null } | null;
  regreso: {
    direccion: string | null;
    misma_direccion: boolean;   // no dio otra: se lo lleva a donde se le recogió
    hora: string | null;
    hora_estimada: boolean;     // no dio hora: la de fin de su última sesión
  } | null;
  regreso_sin_preguntar: boolean;  // pidió transporte antes de que se preguntara el regreso
}

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : null);

/** El transporte de un panelista para un día. `termina` = fin de su última sesión ese día. */
export function transporteDelDia(log: LogisticaTransporte | null | undefined, fecha: string, termina: string | null): TransporteDia {
  const nada: TransporteDia = { ida: null, regreso: null, regreso_sin_preguntar: false };
  if (!log || log.necesita_transporte !== true) return nada;
  if (log.transporte_por_fecha?.[fecha] === false) return nada;
  // Sin la columna nueva (confirmó antes de sql/60) el transporte era la recogida.
  const ida = log.transporte_ida ?? true;
  const regreso = log.transporte_regreso === true;
  const dirRegreso = (log.direccion_regreso ?? '').trim() || null;
  return {
    ida: ida ? { direccion: log.direccion_recogida ?? null, hora: hhmm(log.hora_recogida) } : null,
    regreso: regreso ? {
      direccion: dirRegreso ?? log.direccion_recogida ?? null,
      misma_direccion: !dirRegreso,
      hora: hhmm(log.hora_regreso) ?? termina,
      hora_estimada: !log.hora_regreso,
    } : null,
    regreso_sin_preguntar: log.transporte_regreso == null && ida,
  };
}

/** Una línea para el resumen: «Ida: Calle 145, 05:45 · Regreso: misma dirección, ~14:50». */
export function textoTransporte(t: TransporteDia): string {
  const partes: string[] = [];
  if (t.ida) partes.push(`Ida: ${[t.ida.direccion, t.ida.hora].filter(Boolean).join(', ') || 'sin dirección'}`);
  if (t.regreso) {
    const dir = t.regreso.misma_direccion ? (t.regreso.direccion ? `a ${t.regreso.direccion}` : 'sin dirección') : `a ${t.regreso.direccion}`;
    const hora = t.regreso.hora ? `, ${t.regreso.hora_estimada ? `~${t.regreso.hora} (al terminar)` : t.regreso.hora}` : '';
    partes.push(`Regreso: ${dir}${hora}`);
  } else if (t.regreso_sin_preguntar) {
    partes.push('Regreso: sin preguntar');
  }
  return partes.length ? partes.join(' · ') : 'Sin transporte';
}
