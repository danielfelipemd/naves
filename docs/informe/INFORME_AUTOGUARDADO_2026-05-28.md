# Mejoras al autoguardado del Anteproyecto NAVES

**Cliente:** INALDE Business School — Programa MBA
**Proyecto:** NAVES (New Business Adventures) — Plataforma de gestión del trabajo de grado
**Fecha:** 28 de mayo de 2026

---

## 1. Problema reportado

Mientras los participantes diligenciaban el anteproyecto:

- Algunos veían el mensaje rojo **«⚠ No se pudo autoguardar — usa "Guardar borrador"»**.
- Si la sesión se les caía (token expirado, cierre accidental, refresh), perdían lo escrito.
- Un caso documentado: una participante perdió varias horas de trabajo.

---

## 2. Diagnóstico técnico

Encontramos **cuatro problemas independientes** que se sumaban al síntoma.

### 2.1 Autoguardado con debounce muy largo

El sistema esperaba 3 segundos sin tipear para guardar. Un participante que escribiera continuamente nunca disparaba el guardado.

### 2.2 El servidor rechazaba guardar borradores incompletos

El backend exigía que el "Nombre del proyecto" estuviera lleno para guardar. Como el autoguardado dispara desde el primer campo que el participante toca (que no siempre es el nombre), el servidor respondía con error y los participantes veían el mensaje rojo en pantalla.

### 2.3 El "guardado forzado cada 30 segundos" enviaba datos antiguos

El intervalo de respaldo capturaba el estado del formulario al inicio (vacío) y lo seguía mandando cada 30 segundos en lugar del estado actual. Este envío fallaba constantemente.

### 2.4 No había respaldo local

Si la sesión se caía, no quedaba copia en el navegador. El participante perdía todo.

---

## 3. Soluciones implementadas

### 3.1 Autoguardado inmediato (≈ 1 segundo)

Reducido el tiempo de debounce de 3 s a 1 s. Cualquier cambio en cualquier campo dispara el guardado al servidor casi al instante.

### 3.2 Respaldo local en el navegador (cada 250 ms)

El navegador escribe una copia espejo del trabajo cada 250 milisegundos. Esta copia **sobrevive** a:

- Cierre del navegador.
- Pérdida de sesión.
- Logout accidental.
- Token de seguridad expirado.

### 3.3 Recuperación automática al volver a entrar

Al volver al formulario, el sistema compara la copia local contra la del servidor. Si la local es más nueva (porque algo falló al sincronizar antes), la **restaura automáticamente** y la persiste al servidor. El participante ve un banner amarillo:

> 🔄 **Recuperamos tu progreso del intento anterior**
>
> Detectamos cambios guardados localmente que aún no se habían enviado al servidor. Los cargamos automáticamente para que no pierdas tu trabajo.

El banner permanece visible hasta que el participante lo cierre con la "×".

### 3.4 Guardado forzado cada 30 segundos (corregido)

Ahora envía siempre el estado actual del formulario, no el inicial.

### 3.5 El servidor ahora acepta borradores parciales

Aflojamos las validaciones del guardado de borrador. El servidor admite que el participante esté a medio llenar el formulario. Las validaciones estrictas (campos obligatorios, mínimo 5 hitos, flags del equipo respondidos) se aplican **solo al momento de "Enviar anteproyecto"**, no antes — que es lo correcto.

---

## 4. Pruebas realizadas (verificación end-to-end)

Simulamos a un participante real con un usuario de prueba dedicado y ejecutamos el flujo completo:

| Paso | Resultado |
|---|---|
| Login + cambio de clave inicial | OK |
| Perfil emprendedor (rol, emociones, preocupaciones) | OK |
| Selección de modalidad Business Plan (irreversible) | OK |
| Creación de equipo | OK |
| Llenado de los 11 campos del Canvas de negocio | OK |
| Sector, CIIU y tipo de proyecto | OK |
| 5 hitos del cronograma con fechas | OK |
| Respuesta a flags del equipo (socios / asociación) | OK |
| **Envío del anteproyecto → estado "enviado" confirmado en base de datos** | OK |

**Verificaciones específicas del fix:**

| Escenario | Antes | Ahora |
|---|---|---|
| Guardar con campos vacíos durante la escritura | Error en rojo | Sin error |
| Recuperar trabajo tras logout / sesión caída | Pérdida total | Recuperado automáticamente |
| Enviar sin nombre de proyecto | Error genérico | Mensaje claro: "Cada proyecto debe tener un nombre" |
| Enviar sin tipo (emprendimiento / intraemprendimiento) | Pasaba | Mensaje claro: "Elige el tipo del proyecto" |
| Enviar sin responder flags del equipo | Error genérico | Mensaje claro |

Todos los datos de prueba fueron eliminados después de la verificación.

---

## 5. Impacto para los participantes

| Antes | Ahora |
|---|---|
| Debían recordar tocar "Guardar borrador" cada cierto tiempo. | Todo se guarda solo desde el primer carácter. |
| Si la sesión expiraba, perdían el trabajo. | El navegador guarda una copia local de respaldo cada fracción de segundo. |
| Mensajes rojos confusos durante el llenado. | Mensaje verde "✓ Guardado automáticamente" o aviso claro de qué falta. |
| Sin aviso si se recuperaba trabajo. | Banner amarillo visible explicando la recuperación. |
| Mensajes de error vagos al enviar. | Mensajes específicos indicando qué corregir. |

---

## 6. Despliegue

Los cambios están **en producción** (www.naves-inalde.com) desde hoy, 28 de mayo de 2026, antes de la fecha límite de entrega (29 de mayo a las 6:00 p. m.). Los participantes que están actualmente llenando el formulario ya están protegidos.

---

## 7. Tiempo dedicado

| Etapa | Tramo | Tiempo |
|---|---|---|
| Pruebas end-to-end con Playwright, hallazgo de tres bugs adicionales y aplicación de fixes (validación de borrador, closure stale, banner persistente) | 02:38 → 03:21 | 43 min |
| Ronda final: enums/regex permisivos en borrador, validaciones movidas al envío, verificación con llamadas reales contra producción | 03:21 → 03:50 | 29 min |
| **Total dedicado en esta sesión** | 02:38 → 03:50 | **≈ 1 h 12 min** |

Incluye: diagnóstico, implementación, despliegue, pruebas end-to-end simulando un participante real (login, llenado del formulario completo y envío en producción), verificación en base de datos y limpieza de las evidencias.

---

## 8. Cierre

El sistema queda funcionando correctamente. El caso reportado no se debe repetir y, si por algún motivo externo (corte de internet, cierre del computador) se interrumpe el llenado, el trabajo ya no se pierde — se restaura automáticamente al volver a entrar.
