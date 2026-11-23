import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esCalificacion, notaDeCalificacion, ESCALA_CASO } from '../src/services/actas/calificacion.js';

describe('calificación del Caso', () => {
  it('acepta solo la escala A, B+, B, B-, C', () => {
    for (const c of ESCALA_CASO) assert.equal(esCalificacion(c), true);
    for (const c of ['a', 'B +', 'D', 'aceptado', '', null, undefined, 4]) assert.equal(esCalificacion(c), false);
  });

  it('de cada calificación sale un resultado', () => {
    for (const c of ESCALA_CASO) assert.ok(['aceptado', 'rechazado'].includes(notaDeCalificacion(c)));
    for (const c of ['A', 'B+', 'B', 'B-'] as const) assert.equal(notaDeCalificacion(c), 'aceptado');
    assert.equal(notaDeCalificacion('C'), 'rechazado');
  });
});
