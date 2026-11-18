import { describe, expect, test } from 'bun:test';
import {
  sesionesDelDia, terminaA, textoSesiones, textoTransporte, transporteDelDia, type BloqueSesion,
} from '../src/lib/logisticaPanelista';

const DIA: BloqueSesion[] = [
  { numero: 1, hora_inicio: '07:00', hora_fin: '08:40', primer_slot: 1, ultimo_slot: 5 },
  { numero: 2, hora_inicio: '09:00', hora_fin: '10:40', primer_slot: 6, ultimo_slot: 10 },
  { numero: 3, hora_inicio: '11:30', hora_fin: '13:10', primer_slot: 11, ultimo_slot: 15 },
];

describe('sesiones del día', () => {
  test('quien eligió bloques ve solo esos, no todo el día', () => {
    const s = sesionesDelDia(false, [3, 1], DIA);
    expect(s.tipo).toBe('bloques');
    expect(s.bloques.map((b) => b.numero)).toEqual([1, 3]);
    expect(textoSesiones(s)).toBe('Bloque 1 (07:00–08:40) · Bloque 3 (11:30–13:10)');
    expect(terminaA(s)).toBe('13:10');
  });
  test('«todas» es todo el día', () => {
    const s = sesionesDelDia(true, [], DIA);
    expect(textoSesiones(s)).toBe('Todas las sesiones (07:00–13:10)');
  });
  test('asignado al día sin bloques lo dice', () => {
    expect(textoSesiones(sesionesDelDia(false, [], DIA))).toContain('sin bloques elegidos');
  });
});

describe('transporte de ida y regreso', () => {
  test('sin transporte', () => {
    expect(textoTransporte(transporteDelDia({ necesita_transporte: false }, '2026-11-24', '13:10'))).toBe('Sin transporte');
  });
  test('confirmó antes de sql/60: ida, regreso sin preguntar', () => {
    const t = transporteDelDia({ necesita_transporte: true, direccion_recogida: 'Calle 145 17 54', hora_recogida: '05:45:00' }, '2026-11-24', '13:10');
    expect(t.ida).toEqual({ direccion: 'Calle 145 17 54', hora: '05:45' });
    expect(t.regreso).toBeNull();
    expect(textoTransporte(t)).toBe('Ida: Calle 145 17 54, 05:45 · Regreso: sin preguntar');
  });
  test('regreso sin dirección ni hora: misma dirección, al terminar su última sesión', () => {
    const t = transporteDelDia({ necesita_transporte: true, transporte_ida: true, transporte_regreso: true, direccion_recogida: 'Cra 15', hora_recogida: '06:00' }, '2026-11-24', '10:40');
    expect(textoTransporte(t)).toBe('Ida: Cra 15, 06:00 · Regreso: a Cra 15, ~10:40 (al terminar)');
  });
  test('solo regreso, a otra dirección y hora', () => {
    const t = transporteDelDia({ necesita_transporte: true, transporte_ida: false, transporte_regreso: true, direccion_regreso: 'Aeropuerto', hora_regreso: '14:00:00' }, '2026-11-24', '13:10');
    expect(t.ida).toBeNull();
    expect(textoTransporte(t)).toBe('Regreso: a Aeropuerto, 14:00');
  });
  test('un día sin transporte marcado no lleva nada', () => {
    const t = transporteDelDia({ necesita_transporte: true, transporte_ida: true, transporte_regreso: true, transporte_por_fecha: { '2026-11-25': false } }, '2026-11-25', '13:10');
    expect(textoTransporte(t)).toBe('Sin transporte');
  });
  test('regreso respondido con «no» no dice «sin preguntar»', () => {
    const t = transporteDelDia({ necesita_transporte: true, transporte_ida: true, transporte_regreso: false, direccion_recogida: 'Cra 15' }, '2026-11-24', null);
    expect(textoTransporte(t)).toBe('Ida: Cra 15');
  });
});
