// Pruebas del ayudante de paginación. Se corren con `npm test` (tsx + node:test).
// Viven fuera de src/ para que `tsc` no las compile a dist/.
//
// El doble de PostgREST EXIGE lo mismo que el real: corta en 1000 filas
// aunque se le pida más, y solo responde el tramo [desde, hasta] pedido. Un
// doble que devolviera todo de golpe dejaría pasar un ayudante roto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traerTodasLasFilas, enTandas } from '../src/lib/traerTodasLasFilas.js';

const MAX_ROWS = 1000;

function tablaFalsa(n: number) {
  const filas = Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(6, '0')}`, n: i }));
  const llamadas: Array<[number, number]> = [];
  const consulta = async (desde: number, hasta: number) => {
    llamadas.push([desde, hasta]);
    const fin = Math.min(hasta + 1, desde + MAX_ROWS); // el tope de PostgREST
    return { data: filas.slice(desde, fin), error: null };
  };
  return { filas, llamadas, consulta };
}

test('trae las 2.500 filas aunque PostgREST corte en 1000', async () => {
  const t = tablaFalsa(2500);
  const { data, error } = await traerTodasLasFilas(t.consulta);
  assert.equal(error, null);
  assert.equal(data!.length, 2500);
  assert.deepEqual(t.llamadas, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(data![2499].n, 2499);
});

test('con exactamente 1000 filas pide una página más para confirmar el final', async () => {
  const t = tablaFalsa(1000);
  const { data } = await traerTodasLasFilas(t.consulta);
  assert.equal(data!.length, 1000);
  assert.equal(t.llamadas.length, 2);
});

test('una tabla vacía devuelve lista vacía, no null', async () => {
  const t = tablaFalsa(0);
  const { data, error } = await traerTodasLasFilas(t.consulta);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test('si una página falla, devuelve el error y no una lista a medias', async () => {
  let llamada = 0;
  const { data, error } = await traerTodasLasFilas(async (desde, hasta) => {
    llamada++;
    if (llamada === 2) return { data: null, error: { message: 'URI too long' } };
    return { data: Array.from({ length: hasta - desde + 1 }, (_, i) => ({ id: desde + i })), error: null };
  });
  assert.equal(data, null);
  assert.equal(error.message, 'URI too long');
});

test('descarta la fila repetida cuando una inserción corre la página', async () => {
  // Página 1: 0..999. Antes de pedir la 2 entra una fila nueva al principio,
  // así que la 999 reaparece como primera de la página 2.
  const base = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
  const { data } = await traerTodasLasFilas(async (desde, hasta) => {
    const vista = desde === 0 ? base : [{ id: -1 }, ...base];
    return { data: vista.slice(desde, hasta + 1), error: null };
  });
  const ids = data!.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(1499));
});

test('acepta una clave propia para tablas sin id (usuario_roles)', async () => {
  const filas = [
    { auth_user_id: 'a', rol_id: 'r1' },
    { auth_user_id: 'a', rol_id: 'r2' },
    { auth_user_id: 'a', rol_id: 'r1' },
  ];
  const { data } = await traerTodasLasFilas(async () => ({ data: filas, error: null }),
    (f) => `${f.auth_user_id}|${f.rol_id}`);
  assert.equal(data!.length, 2);
});

test('enTandas parte 400 UUID en tandas de 150 sin perder ninguno', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `u${i}`);
  const tandas = enTandas(ids, 150);
  assert.deepEqual(tandas.map((t) => t.length), [150, 150, 100]);
  assert.deepEqual(tandas.flat(), ids);
  assert.deepEqual(enTandas([], 150), []);
});
