// Pruebas del ayudante que quita el nombre del proyecto antes de buscar cifras en el post.
// Se corren con `npm test` (tsx + node:test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinNombreProyecto } from '../src/lib/nombreProyecto.js';

const digitos = (t: string) => t.match(/(?<![\p{L}\d])\d[\d.,]*(?![\p{L}\d])/gu);

test('el nombre abreviado no cuenta como cifra (Fundación Nexo 3-21)', () => {
  const nombre = 'Fundación Nexo 3-21. Conectamos Capacidades con Oportunidades';
  const post = 'Martha y Fredy presentaron Fundación Nexo 3-21, una red que conecta capacidades con oportunidades.';
  assert.equal(digitos(sinNombreProyecto(post, nombre)), null);
});

test('el nombre completo también se quita', () => {
  const nombre = 'Fundación Nexo 3-21. Conectamos Capacidades con Oportunidades';
  const post = `Presentaron ${nombre} en la jornada.`;
  assert.equal(sinNombreProyecto(post, nombre), 'Presentaron Proyecto en la jornada.');
});

test('los números del nombre cuentan como marca aunque cambien mayúsculas o espacios', () => {
  assert.equal(digitos(sinNombreProyecto('Llega NEXO  3-21 a Bogotá', 'Fundación Nexo 3-21')), null);
  assert.equal(digitos(sinNombreProyecto('Ready2 crece', 'Ready2')), null);
});

test('las cifras que NO son del nombre se siguen detectando', () => {
  const nombre = 'Fundación Nexo 3-21. Conectamos Capacidades con Oportunidades';
  const post = 'Fundación Nexo 3-21 atendió 500 familias en 2025 y sigue creciendo.';
  assert.deepEqual(digitos(sinNombreProyecto(post, nombre)), ['500', '2025']);
});

test('nombre vacío no cambia nada', () => {
  assert.equal(sinNombreProyecto('Vendió 300 unidades', ''), 'Vendió 300 unidades');
});
