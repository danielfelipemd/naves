import { describe, expect, test } from 'bun:test';
import { normalizarCopias } from '../src/services/actas/copia-firmadas';

describe('correos de copia de actas firmadas', () => {
  test('limpia espacios, mayúsculas y repetidos', () => {
    const r = normalizarCopias({ caso: [' Ernesto.Barrera@inalde.edu.co ', 'ernesto.barrera@inalde.edu.co', ''] });
    expect(r).toEqual({ ok: true, valor: { caso: ['ernesto.barrera@inalde.edu.co'], business_plan: [], proyecto_investigacion: [] } });
  });
  test('rechaza un correo con tilde', () => {
    const r = normalizarCopias({ caso: ['cindy.pinzón@inalde.edu.co'] });
    expect(r.ok).toBe(false);
  });
  test('rechaza un correo mal escrito', () => {
    expect(normalizarCopias({ business_plan: ['sin-arroba.com'] }).ok).toBe(false);
  });
  test('una modalidad vacía queda sin copia', () => {
    const r = normalizarCopias({});
    expect(r.ok && r.valor.caso.length).toBe(0);
  });
});
