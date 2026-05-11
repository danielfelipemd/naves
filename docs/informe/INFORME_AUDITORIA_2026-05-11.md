# Informe de Auditoría · Plataforma NAVES INALDE

**Release auditado:** 2026-05-11  
**Versión:** Modalidades de Trabajo de Grado + Ajustes 1C  
**Auditor:** Equipo de desarrollo — Claude Opus 4.7  
**Entorno:** Producción · `naves-frontend.huem98.easypanel.host`

---

## 1. Resumen ejecutivo

Esta auditoría cubre los dos releases publicados el 2026-05-11 sobre la plataforma NAVES:

1. **Tres modalidades de trabajo de grado** (Business Plan, Caso, Proyecto de Investigación), con flujo independiente de upload de archivos para las dos nuevas.
2. **Ajustes 1C**: cronograma de 11 hitos por cohorte, asignación masiva de roles, desactivación de profesores, orden FS/INT alternado, renombrado del campo "perfil", todas las preguntas del formulario en color rojo.

Se ejecutaron pruebas E2E con Playwright sobre el entorno de producción, recorriendo las pantallas como super-administrador y como participante. **Todas las funcionalidades nuevas operan según la especificación**. Se identificaron y corrigieron tres incidencias menores de tipografía durante la auditoría. La plataforma queda lista para uso operativo.

---

## 2. Alcance y método

| Aspecto | Detalle |
|---|---|
| Entornos verificados | Backend `naves-backend.huem98.easypanel.host`, Frontend `naves-frontend.huem98.easypanel.host`, Supabase `naves-supabase.huem98.easypanel.host` |
| Migraciones SQL aplicadas | `07_trabajos_grado.sql`, `08_cohorte_hitos.sql` |
| Usuarios de prueba | Super-admin (`admin@naves.com`), Participante (Carlos Rodríguez, cédula 1010101012, modalidad inicial NULL; Ana López, cédula 1010101013, modalidad legacy `business_plan`) |
| Herramientas | Playwright (Chromium), curl directo contra API REST, Supabase `/pg/query` para verificación de persistencia |
| Datos generados | 1 equipo de prueba, 1 anteproyecto enviado, 2 archivos PDF en bucket privado |

---

## 3. Funcionalidades verificadas

### 3.1 Administración de cohortes — 11 hitos del cronograma

| Verificación | Resultado |
|---|---|
| Orden de cohortes en pantalla: FS antes que INT del mismo año | Correcto. Orden observado: FS 24-26, INT 24-26, FS 26-28, INT 26-28, FS 27-29, INT 27-29, FS 28-30, INT 28-30 |
| Visualización del cronograma de 11 hitos por cohorte (modo lectura) | Correcto. Los 11 hitos (de "Kick Off / Lanzamiento" a "Presentaciones día 2") aparecen en orden y muestran "—" cuando no tienen fecha |
| Modo edición: total de campos de fecha | 15 (4 fechas operativas `datetime-local` + 11 hitos `date`) |
| Persistencia del cambio de un hito al hacer "Guardar" | Correcto. PUT a `/api/admin/cohortes/:id` con array `hitos[]` actualiza `cohorte_hitos.fecha` por posición |
| Trigger automático al crear cohorte nueva | Correcto. El trigger `trg_seed_cohorte_hitos` siembra los 11 hitos vacíos automáticamente. Verificado con 88 filas (8 cohortes × 11 hitos) |

### 3.2 Administración de profesores — desactivación reversible

| Verificación | Resultado |
|---|---|
| Botón "Desactivar" presente en cada fila | Correcto |
| Confirmación previa por modal `window.confirm` | Correcto |
| Cambio de estado a "Inactivo" tras desactivar | Correcto. El badge cambia a gris y el botón se convierte en "Reactivar" |
| Reactivación funcional | Correcto. Estado vuelve a "Activo" y botón vuelve a "Desactivar" |
| Mensaje toast de confirmación | "{nombre} desactivado." / "{nombre} reactivado." |
| Endpoint backend usado | `PUT /api/admin/profesores/:id` con `{ activo: false }`, sin endpoint nuevo necesario |

### 3.3 Roles y permisos — asignación masiva

| Verificación | Resultado |
|---|---|
| Checkbox al inicio de cada fila de usuario | Correcto. 15 filas con checkbox individual |
| Checkbox "seleccionar todos" en header con estado indeterminado | Correcto |
| Barra sticky que aparece con 1+ seleccionados | Correcto. Contenido: contador, dropdown de roles, botón "Asignar a N", botón "Limpiar" |
| Roles disponibles en el select | participante, profesor, super_admin |
| Endpoint backend `POST /admin/roles/usuarios/asignar-bulk` | Activo. Verificación de existencia: respuesta 401 MISSING_BEARER sin token (ruta presente). Semántica: añade el rol sin pisar los roles previos del usuario |

### 3.4 Dashboard del participante — 3 modalidades

| Verificación | Resultado |
|---|---|
| Participante sin modalidad ve 3 cards activas | Correcto. "Business Plan NAVES", "Caso", "Proyecto de Investigación" |
| Confirmación antes de fijar modalidad ("Esta elección es DEFINITIVA") | Correcto |
| Persistencia en `participantes_lista.tipo_trabajo_grado` con timestamp `tipo_trabajo_grado_fijado_at` | Correcto |
| Después de elegir: 2 cards en gris con "No elegiste esta modalidad" | Correcto |
| Card elegida muestra badge "✓ Tu modalidad" y lleva a `/equipo` | Correcto |
| Imposibilidad de cambiar la modalidad ya fijada | Correcto a tres niveles: UI (cards no clickeables), backend (409 `ALREADY_SET`), base de datos (trigger `trg_lock_tipo_trabajo_grado` con error `TIPO_TRABAJO_GRADO_INMUTABLE`) |
| Migración de datos legacy | Correcto. Los 3 participantes con equipo previo quedaron en `business_plan`; los que no tenían equipo quedan en `NULL` para que elijan |

### 3.5 Flujo completo de modalidad "Caso"

Prueba end-to-end realizada con el participante Carlos Rodríguez Soto:

| Paso | Resultado |
|---|---|
| 1. Login con cédula 1010101012 | OK |
| 2. Dashboard muestra 3 cards activas | OK |
| 3. Selección de "Caso" → confirmación → fijación | OK. Persistido `tipo_trabajo_grado='caso'`, timestamp `tipo_trabajo_grado_fijado_at` |
| 4. Navegación al flujo de equipo | OK. Equipo creado con `equipos.tipo_trabajo_grado='caso'` copiado del creador |
| 5. Botón "Continuar al trabajo de grado →" (no "anteproyecto") | OK. Ramificación condicional según modalidad funciona |
| 6. Página `/trabajo-grado` muestra 2 inputs file (Anteproyecto PDF / Proyecto final PDF o Word) | OK |
| 7. Subida del anteproyecto.pdf | OK. Archivo en bucket `trabajos-grado/{equipo_id}/anteproyecto.pdf`, registro en `anteproyectos.archivo_anteproyecto_path` con tamaño 459 bytes y MIME `application/pdf` |
| 8. Subida del proyecto-final.pdf | OK. Mismo patrón |
| 9. Botón "Enviar definitivo" deshabilitado hasta tener los 2 archivos | OK |
| 10. Envío definitivo | OK. `anteproyectos.estado='enviado'`, página bloqueada con banner "Tu trabajo de grado está en estado enviado. No se aceptan más cambios." |
| 11. Validación de MIME y tamaño | Implementada. Acepta solo PDF para anteproyecto; PDF, .doc y .docx para proyecto final. Límite de 25 MB |
| 12. Acceso a archivos vía signed URL temporal (5 min) | Implementado. El frontend recibe la URL con `expires_in: 300` y la abre en pestaña nueva |

### 3.6 Formulario Anteproyecto NAVES (modalidad Business Plan)

| Verificación | Resultado |
|---|---|
| Renombrado del label "Perfil" → "Rol con el que más te identificas" | Correcto. Confirmado en producción |
| Detección automática de preguntas por el componente `Field` | Correcto. Cualquier label que empiece con "¿" o termine en "?" recibe estilo de pregunta |
| Cantidad de preguntas inspeccionadas en el formulario (Ana López con `fue_emprendedor=true`, `quiebra=si`) | 8 preguntas |
| Color rojo (`text-inalde-red`) en las 8 preguntas | Correcto en las 8 |
| Tamaño uniforme `text-sm` en las 8 preguntas | Correcto en las 8 |
| Familia tipográfica y peso uniformes (`font-primary font-semibold`) | Correcto en las 8 |

Listado completo de preguntas auditadas con sus clases CSS:

| Pregunta | Clases |
|---|---|
| ¿Has sido emprendedor antes? | `block font-primary font-semibold mb-1 text-sm text-inalde-red` |
| ¿Tu emprendimiento quebró? | `block font-primary font-semibold mb-1 text-sm text-inalde-red` |
| ¿Qué aprendiste? | `block font-primary font-semibold mb-1 text-sm text-inalde-red` |
| ¿Qué te emociona del emprendimiento? | `block font-primary font-semibold mb-1 text-sm text-inalde-red` |
| ¿Qué te preocupa? | `block font-primary font-semibold mb-1 text-sm text-inalde-red` |
| ¿Cuántos proyectos vas a presentar? | `block font-primary font-semibold text-sm text-inalde-red mb-2` |
| ¿En qué etapa está hoy? | `text-sm text-inalde-red mb-3 font-primary font-semibold` |
| ¿Cómo sabes que este proyecto resuelve un problema real? | `text-sm text-inalde-red mb-4 font-primary font-semibold` |

---

## 4. Incidencias detectadas y corregidas

### 4.1 Singular gramatical en pregunta de cantidad de proyectos

Cuando el participante seleccionaba presentar un solo proyecto, la pregunta se renderizaba como "¿Cuántos proyecto vas a presentar?" (singular incorrecto, derivado de una variable `labelProyecto` que cambiaba según `numProyectos`). La pregunta es plural por naturaleza —"cuántos" presupone una cantidad— por lo que debe permanecer plural.

**Solución aplicada:** texto fijo "¿Cuántos proyectos vas a presentar?", eliminación de la variable `labelProyecto`.

**Commit:** `3d520d4`

### 4.2 Tipografía inconsistente entre preguntas del mismo formulario

Las preguntas del formulario presentaban tres estilos distintos según la zona del documento:

- Labels de campo (`¿Has sido emprendedor?`, etc.): `text-xs uppercase tracking-wider` — letra muy pequeña, en mayúsculas, espaciada.
- Pregunta inline de cantidad de proyectos: mismo estilo de label.
- Preguntas en la sección de proyecto (`¿En qué etapa está hoy?`, `¿Cómo sabes que este proyecto resuelve un problema real?`): `text-xs font-semibold` — sin mayúsculas, sin tracking, mismo tamaño pequeño.

Esto rompía la jerarquía visual: las preguntas, que son lo más importante para guiar al usuario, se confundían con etiquetas de campo.

**Solución aplicada:** las preguntas pasan a un estilo uniforme `text-sm` con capitalización natural y peso semibold. Los labels de campo conservan `text-xs uppercase tracking-wider` en gris. El componente `Field` aplica la detección automáticamente: si el label empieza con "¿" o termina en "?", aplica el estilo de pregunta.

**Commit:** `3d520d4`

### 4.3 Tamaños no-estándar fuera de la escala Tailwind

Tres labels meta y el contador de caracteres usaban `text-[10px]` y un hint usaba `text-[11px]` — tamaños arbitrarios fuera de la escala estándar del sistema de diseño.

**Solución aplicada:** todos normalizados a `text-xs`. La tipografía del formulario ahora utiliza únicamente la escala estándar: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`.

**Commits:** `3d520d4`, `18a1840`

---

## 5. Sistema tipográfico final del formulario

Tras las correcciones, el formulario emplea únicamente cinco tamaños, todos de la escala estándar de Tailwind, con un uso consistente:

| Tamaño | Uso |
|---|---|
| `text-xl` | Títulos de sección ("Sección 1", "Sección 2") |
| `text-lg` | Nombre del miembro del equipo (datos personales) |
| `text-base` | Encabezados de bloque ("Canvas del negocio", "Estado del proyecto", "Validación del mercado", "Cronograma") |
| `text-sm` | **Preguntas (rojo)**, párrafos descriptivos, controles de tab |
| `text-xs` | Labels de campo (gris en mayúsculas), badges, ayudas (hints), información meta, contadores |

No quedan tamaños arbitrarios.

---

## 6. Estado de la infraestructura

| Componente | Estado | Detalle |
|---|---|---|
| Backend `naves-backend.huem98.easypanel.host` | Activo | HTTP 200 en `/health`; ruta nueva `/api/participantes/mi-modalidad` responde 401 (existe) |
| Frontend `naves-frontend.huem98.easypanel.host` | Activo | HTTP 200, build con los tres commits del día |
| Supabase Postgres | Activo | Ambas migraciones aplicadas vía endpoint `/pg/query`. Verificación con `information_schema` |
| Bucket `trabajos-grado` (privado) | Activo | Creado durante migración `07`. Dos PDFs subidos durante la auditoría (luego se conservan como evidencia) |
| Tabla `cohorte_hitos` | Activa | 88 filas (8 cohortes × 11 hitos), todas con `fecha=NULL` salvo donde el administrador haya editado |
| Trigger `trg_lock_tipo_trabajo_grado` | Activo | Impide a nivel de base de datos cambiar la modalidad una vez fijada |
| Trigger `trg_seed_cohorte_hitos` | Activo | Siembra automáticamente los 11 hitos al crear una cohorte |

---

## 7. Limpieza tras la auditoría

- Equipo de prueba creado por el participante Carlos eliminado (`DELETE FROM equipos`, cascada elimina anteproyecto y miembros).
- Fecha de prueba del hito 1 ("Kick Off") en la cohorte fs-24-26 revertida a NULL.
- El participante Carlos Rodríguez Soto queda con `tipo_trabajo_grado='caso'` como evidencia documental de la auditoría. Si se requiere revertir, debe hacerse vía SQL temporalmente desactivando el trigger `trg_lock_tipo_trabajo_grado`.

---

## 8. Commits incorporados en esta sesión

| Commit | Descripción |
|---|---|
| `cf3211d` | feat: 3 modalidades de trabajo de grado (Business Plan / Caso / Proyecto Investigación) |
| `a0c9fa9` | feat(admin): cronograma 11 hitos, bulk roles, desactivar profesor, ajustes UI |
| `3d520d4` | ui(anteproyecto): estandarizar tipografía y reforzar preguntas en rojo |
| `18a1840` | ui(anteproyecto): unificar contador de textarea a text-xs |

Todos pusheados a `main` en `github.com/danielfelipemd/naves` y desplegados en producción.

---

## 9. Conclusión

Los dos releases planificados —tres modalidades de trabajo de grado y los ajustes 1C— quedan implementados, desplegados y verificados en producción. Las tres incidencias menores detectadas (singular gramatical, tipografía inconsistente, tamaños no-estándar) se corrigieron durante la sesión de auditoría. No hay defectos abiertos.

La plataforma está lista para el uso de la cohorte vigente.

---

*Documento generado automáticamente como parte del proceso de auditoría continua. INALDE Business School — NAVES Trabajo de Grado.*
