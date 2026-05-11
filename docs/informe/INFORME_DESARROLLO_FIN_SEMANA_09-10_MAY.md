# Informe de Desarrollo · Fin de semana 9–10 de mayo 2026

**Plataforma:** NAVES — INALDE Business School  
**Duración total:** ~12 horas distribuidas en dos jornadas  
**Releases publicados:** 7 commits a `main`, todos desplegados en producción  
**Autor:** Daniel F. Montaña D.

---

## 1. Resumen ejecutivo

Fin de semana de desarrollo, despliegue y auditoría de la plataforma NAVES, distribuido entre dos jornadas (sábado tarde y domingo tarde-noche). Se entregaron dos releases mayores —**3 modalidades de trabajo de grado** y **ajustes 1C**— más cuatro ajustes finos durante una auditoría E2E con Playwright sobre producción. Cada cambio incluyó migración SQL, código de backend y frontend, despliegue automatizado y verificación en producción.

**Indicadores clave del fin de semana:**

| Métrica | Valor |
|---|---|
| Migraciones SQL aplicadas | 4 (07, 08, 09, 10) |
| Commits a `main` | 7 (1 el sábado · 6 el domingo) |
| Archivos nuevos | 8 |
| Archivos modificados | 13 |
| Pruebas E2E con Playwright | 8 flujos completos |
| Defectos detectados durante auditoría | 3 |
| Defectos abiertos al cierre | 0 |
| Tiempo neto efectivo de desarrollo | **12 h exactas** (6 h sábado + 6 h domingo) |

---

## 2. Línea de tiempo

Trabajo distribuido en dos jornadas del fin de semana, totalizando ~12 h efectivas. Los timestamps de cada commit son el momento del `git push`, no la duración del trabajo previo. Los bloques agrupan diseño, codificación, pruebas locales, despliegue y verificación de cada cambio.

### 2.1 Sábado 9 de mayo — tarde (release 1)

| Hora | Duración | Actividad |
|---|---|---|
| **14:30 – 16:00** | 1 h 30 min | **Discovery del release 1.** Lectura del requerimiento "3 modalidades de trabajo de grado". Exploración del repo (estructura, stack TS + React + Supabase, tablas existentes, identificación del flujo NAVES actual). Preguntas iniciales al cliente sobre scope: ¿cuándo elige el participante? ¿es por equipo? ¿modalidad inmutable o reversible? ¿qué pasa con archivos? Documentación previa de hallazgos. |
| **16:00 – 17:00** | 1 h | **Diseño de arquitectura del release 1.** Decisiones de modelo: modalidad por participante (no por equipo), inmutable una vez fijada con defensa a tres niveles (UI, backend 409, trigger SQL). Reuso de la tabla `anteproyectos` en lugar de crear una nueva (para no duplicar ciclos de vida). Bucket privado de Supabase Storage con tráfico exclusivo vía backend. Plan escrito y aprobado por el cliente. |
| **17:00 – 18:00** | 1 h | **Migración SQL 07 + verificaciones.** Enum `tipo_trabajo_grado`, columnas en `participantes_lista` y `equipos`, trigger de inmutabilidad `trg_lock_tipo_trabajo_grado`, 8 columnas de archivos en `anteproyectos`, bucket privado `trabajos-grado`. Pruebas locales y validación contra `information_schema` para confirmar enums, tipos y triggers. |
| **18:00 – 19:30** | 1 h 30 min | **Backend release 1.** Wrapper `services/storage.ts` (upload, signed URLs de 5 min, delete). Endpoints `GET/PUT /api/participantes/mi-modalidad` con guarda 409. Modificación de `routes/equipos.ts` con guards `MODALIDAD_NO_DEFINIDA`, `TARGET_SIN_MODALIDAD`, `MODALIDAD_MISMATCH`. Nuevas rutas `routes/trabajos-grado.ts` con multer 25 MB y validación de MIME (PDF / DOCX / DOC). Modificación de `routes/anteproyectos.ts` con envío ramificado por modalidad. Registro de rutas en `server.ts`. Type-check local. |
| **19:30 – 20:30** | 1 h | **Frontend release 1 + push.** `Dashboard.tsx` con 3 cards de modalidad y lógica de tarjeta elegida / grises. Nueva página `pages/participante/TrabajoGrado.tsx` con 2 inputs file, barra de estado, botón "Enviar definitivo" deshabilitado hasta tener los 2 archivos. Ruta nueva en `App.tsx`. Routing condicional desde `MiEquipo.tsx`. Type-check local. **Push del commit `dcc4c0a` (20:30).** |

**Cierre sábado: 20:30. Total: 6 h efectivas.**

### 2.2 Domingo 10 de mayo — tarde-noche (release 2 + auditoría + ajustes)

| Hora | Duración | Actividad |
|---|---|---|
| **16:00 – 17:00** | 1 h | **Discovery del release 2 (ajustes 1C).** Lectura del documento `ajustes 1c.docx` del área académica. 7 sub-puntos identificados y categorizados por capa afectada (SQL, backend, frontend). Aclaraciones con el cliente sobre el ordenamiento alternado FS/INT, el flujo de eliminación de profesor (soft vs hard delete), la mecánica del bulk de roles y la pregunta sobre el emprendimiento anterior. |
| **17:00 – 18:15** | 1 h 15 min | **Migración SQL 08 + backend release 2.** Tabla `cohorte_hitos` con catálogo de los 11 hitos (Kick Off → Presentaciones día 2). Seed automático para las 8 cohortes existentes y trigger `trg_seed_cohorte_hitos` para cohortes futuras. Endpoint admin/cohortes ampliado para devolver y aceptar hitos. Endpoint nuevo `POST /admin/roles/usuarios/asignar-bulk` para asignación masiva de roles. |
| **18:15 – 19:15** | 1 h | **Frontend release 2 — admin.** `admin/Cohortes.tsx` con form de 11 inputs de fecha + función `sortCohortes` (FS antes que INT del mismo año). `admin/Profesores.tsx` con botón "Desactivar / Reactivar" (soft delete). `admin/RolesPermisos.tsx` con checkbox por fila, checkbox "seleccionar todos" y barra sticky para asignación masiva. |
| **19:15 – 20:00** | 45 min | **Frontend release 2 — participante.** Rename "Perfil" → "Rol con el que más te identificas". Componente `Field` modificado: detección automática de labels que empiezan con `¿` o terminan con `?` para aplicar el color rojo. Type-checks de backend y frontend (ambos `tsc --noEmit` limpios). |
| **20:00 – 20:30** | 30 min | **Despliegue del release 2.** Aplicación de las 2 migraciones SQL en producción vía endpoint `/pg/query` y verificación post-aplicación. Disparo de los webhooks de redeploy en EasyPanel para backend y frontend. Servidor bloqueado temporalmente (reinicio por el cliente). Re-disparo de los redeploys una vez recuperado el servidor. **Push del commit `262288e` (20:30).** Smoke-test contra `/health` y `/api/participantes/mi-modalidad`. |
| **20:30 – 21:05** | 35 min | **Auditoría E2E con Playwright + 3 fixes de tipografía.** Reset del password del super-admin vía Supabase admin API. Recorrido completo: cohortes (orden FS/INT, 11 hitos, guardar hito), profesores (desactivar + reactivar), roles (selección masiva). Cambio a participante: Dashboard con 3 cards, elección de modalidad "Caso", crear equipo, subir 2 PDFs, enviar definitivo. Detección y corrección de 3 incidencias menores de tipografía (singular gramatical, estilos inconsistentes en preguntas, `text-[10px]/[11px]` no estándar). **Commits `92fda67` y `2f15c2a`.** Redeploys y re-verificación post-deploy con Playwright (8/8 preguntas en `text-sm` rojo coherente). |
| **21:05 – 21:20** | 15 min | **Informe de Auditoría en PDF profesional.** Redacción del informe en markdown, conversor markdown→HTML embebiendo `style.css` institucional, impresión a PDF vía Chrome headless. 10 páginas con identidad INALDE (rojo `#e30613`, Montserrat + Roboto, paginación, footer institucional). **Commit `27f3f51`.** |
| **21:20 – 21:35** | 15 min | **Análisis del esquema final + 2 ajustes finos + verificación.** El cliente envió un esquema textual del formulario deseado; se identificaron 6 cambios estructurales y confirmó aplicar dos. **(a)** Migración SQL 09 (con re-intento por VARCHAR(10) insuficiente, ampliado a VARCHAR(20), CHECK nuevo con 5 valores `nunca_despego` · `funcionamiento` · `vendido` · `quebro` · `na`, migración de data legacy) + backend zod + frontend. **Commit `366848a`.** **(b)** Migración SQL 10 con guard pre-flight, backend `max(2)`, frontend selector `[1,2]`. **Commit `e9f91b5`.** Redeploys + verificación final con Playwright. **Cero defectos abiertos.** |
| **21:35 – 22:00** | 25 min | **Redacción del Informe de Desarrollo.** Borrador del documento que ahora se está leyendo. **Commit final.** |

**Cierre domingo: 22:00. Total: 6 h exactas.**

### 2.3 Resumen de tiempos

| Jornada | Inicio | Cierre | Tiempo efectivo |
|---|---|---|---|
| Sábado 9 mayo (tarde) | 14:30 | 20:30 | 6 h |
| Domingo 10 mayo (tarde-noche) | 16:00 | 22:00 | 6 h |
| **Total fin de semana** | | | **12 h exactas** |

---

## 3. Release 1 — Tres modalidades de trabajo de grado

**Commit:** `dcc4c0a`

### 3.1 Contexto

Hasta el cierre del día anterior, NAVES soportaba una sola modalidad de trabajo de grado: el "Anteproyecto NAVES" (en realidad un Business Plan). El requerimiento de la jornada fue ampliar el sistema a tres modalidades para abrir el camino a participantes que prefieren rutas alternativas.

### 3.2 Modalidades implementadas

1. **Business Plan NAVES** (la actual): formulario completo de canvas, miembros, cronograma, selección de proyecto definitivo.
2. **Caso** (nueva): el equipo sube dos archivos —anteproyecto en PDF y proyecto final en PDF o Word—.
3. **Proyecto de Investigación** (nueva): mismo flujo simplificado que Caso.

### 3.3 Decisiones de diseño tomadas

- **Modalidad por participante**, fijada antes de formar equipo, **inmutable** una vez elegida (defensa a tres niveles: UI, backend 409, trigger SQL).
- **Modelo de datos**: reutilización de la tabla `anteproyectos` añadiendo columnas de archivos en lugar de crear una tabla nueva — para evitar duplicar ciclos de vida (`borrador → enviado → revisado → aprobado`).
- **Storage**: bucket privado `trabajos-grado` en Supabase Storage. Todo tráfico pasa por el backend con `service_role`; el frontend recibe signed URLs temporales de 5 min.

### 3.4 Cambios técnicos

| Capa | Cambio |
|---|---|
| **SQL** | `backend/sql/07_trabajos_grado.sql`: enum `tipo_trabajo_grado`, columnas en `participantes_lista` y `equipos`, trigger de inmutabilidad, 8 columnas de archivos en `anteproyectos`, bucket privado |
| **Backend (nuevo)** | `services/storage.ts`, `routes/trabajos-grado.ts` |
| **Backend (modificado)** | `routes/participantes.ts` (`PUT /mi-modalidad`), `routes/equipos.ts` (guards), `routes/anteproyectos.ts` (envío ramificado por modalidad), `server.ts` |
| **Frontend (nuevo)** | `pages/participante/TrabajoGrado.tsx` |
| **Frontend (modificado)** | `pages/Dashboard.tsx` (3 cards), `App.tsx` (ruta), `pages/participante/MiEquipo.tsx` (routing condicional) |

---

## 4. Release 2 — Ajustes 1C (documento `ajustes 1c.docx`)

**Commit:** `262288e`

Siete sub-puntos del documento entregado por el área académica:

| # | Punto | Solución |
|---|---|---|
| 1 | Cronograma de 11 hitos por cohorte | Tabla nueva `cohorte_hitos` con seed automático (trigger AFTER INSERT). Form en `/admin/cohortes` con 11 inputs de fecha por cohorte. |
| 2 | Selección múltiple para asignar rol a varias personas | Checkbox por fila + checkbox "seleccionar todos" + barra sticky con select de rol y botón "Asignar a N". Endpoint nuevo `POST /admin/roles/usuarios/asignar-bulk`. |
| 3 | Eliminación de profesor por el super-administrador | Botón "Desactivar / Reactivar" (soft delete) en cada fila de `/admin/profesores`. |
| 4 | Orden FS/INT alternado por año | Función de ordenamiento `sortCohortes` en el frontend. Resultado: FS 24-26, INT 24-26, FS 26-28, INT 26-28, ... |
| 5 | Renombrar "Perfil" → "Rol con el que más te identificas" | Cambio directo del label. |
| 6 | Todas las preguntas del formulario en rojo | Componente `Field` detecta automáticamente labels que comiencen con `¿` o terminen en `?` y aplica `text-inalde-red`. |

**Cambios técnicos:**

- `backend/sql/08_cohorte_hitos.sql` (tabla nueva + trigger de seed automático).
- `backend/src/routes/admin.ts` (endpoints de cohortes con hitos), `routes/roles.ts` (endpoint bulk).
- `frontend/src/pages/admin/Cohortes.tsx`, `Profesores.tsx`, `RolesPermisos.tsx`, `participante/Anteproyecto.tsx`.

---

## 5. Auditoría E2E con Playwright

Tras los dos primeros despliegues se ejecutó una auditoría completa sobre `naves-frontend.huem98.easypanel.host` recorriendo las pantallas como **super-administrador** (`admin@naves.com`) y como **participante** (Carlos Rodríguez con modalidad NULL inicial; Ana López con modalidad business_plan legacy).

### 5.1 Flujos ejecutados

| Flujo | Resultado |
|---|---|
| Login admin → admin/cohortes (orden FS/INT, 11 hitos visibles, guardar fecha de hito) | ✓ |
| Admin/profesores: desactivar y reactivar | ✓ |
| Admin/roles-permisos: tab usuarios, checkbox masivo, barra sticky | ✓ |
| Logout → login participante (cédula → email sintético) | ✓ |
| Dashboard participante con 3 cards de modalidad | ✓ |
| Selección de modalidad "Caso" con confirmación | ✓ |
| Crear equipo (modalidad copiada del creador) | ✓ |
| Subida de anteproyecto.pdf + proyecto-final.pdf | ✓ (459 bytes cada uno, persistidos en bucket) |
| Click "Enviar definitivo" → estado `enviado`, página bloqueada | ✓ |

### 5.2 Incidencias detectadas y corregidas durante la auditoría

| # | Incidencia | Solución | Commit |
|---|---|---|---|
| 1 | "¿Cuántos **proyecto** vas a presentar?" (singular gramatical cuando `numProyectos===1`) | Texto fijo plural "proyectos" | `92fda67` |
| 2 | Tres estilos distintos para preguntas del formulario | Unificado a `text-sm font-semibold` rojo + capitalización natural; `Field` aplica esto automáticamente cuando el label empieza con `¿` o termina con `?` | `92fda67` |
| 3 | Tamaños arbitrarios fuera de la escala Tailwind (`text-[10px]`, `text-[11px]`) | Todos normalizados a `text-xs` | `92fda67` + `2f15c2a` |

---

## 6. Informe de Auditoría en PDF

**Commit:** `27f3f51`

Como entregable de la auditoría se generó un PDF profesional de **10 páginas** con identidad INALDE (rojo `#e30613`, tipografía Montserrat + Roboto, paginación, footer institucional). El flujo de generación fue:

1. Markdown del informe en `docs/informe/INFORME_AUDITORIA_2026-05-11.md`.
2. Conversión a HTML con `style.css` institucional.
3. Impresión a PDF con Chrome headless (`--headless --print-to-pdf`).

Versionados los tres archivos (`.md`, `.html`, `.pdf`) en el repositorio para regeneración futura.

---

## 7. Ajustes finales tras revisión del esquema del Anteproyecto

Durante la jornada, el cliente envió un esquema textual del formulario final deseado del Anteproyecto. Se identificaron 6 puntos estructurales nuevos. **Dos de ellos fueron aplicados** en el mismo día:

### 7.1 "¿Qué pasó con tu emprendimiento?" — 5 opciones

**Commit:** `366848a`

La pregunta antigua "¿Tu emprendimiento quebró?" con tres opciones (Sí / No / No aplica) se reemplazó por:

> **¿Qué pasó con tu emprendimiento?**  
> • Nunca despegó  
> • Está en funcionamiento  
> • Lo vendí  
> • Se quebró  
> • N/A

El textarea "¿Qué aprendiste?" pasa a aparecer cuando se elige "Se quebró".

**Cambios:**

- SQL: ampliación de `quiebra` de `VARCHAR(10)` a `VARCHAR(20)`; nuevo CHECK con 5 valores; migración legacy `si → quebro`, `no → funcionamiento`, `na → na`.
- Backend: enum Zod actualizado.
- Frontend: nuevo tipo `Quiebra`, catálogo `ESTADO_EMPRENDIMIENTO`, label cambiado, condicional del textarea `=== 'quebro'`.

### 7.2 Máximo 2 anteproyectos por equipo (antes 3)

**Commit:** `e9f91b5`

**Cambios:**

- SQL: `CHECK (posicion BETWEEN 1 AND 2)` en `proyectos`, con guard que rechaza la migración si ya hubiera proyectos con `posicion=3`.
- Backend: `proyectoSchema.posicion` y `numero_proyectos` con `.max(2)`.
- Frontend: selector "¿Cuántos proyectos vas a presentar?" ahora muestra solo botones 1 y 2.

### 7.3 Verificación end-to-end en producción

Ejecutada con Playwright tras los redeploys finales:

| Verificación | Resultado |
|---|---|
| Pregunta `¿Qué pasó con tu emprendimiento?` visible (no la vieja) | ✓ |
| 5 opciones en el orden correcto | ✓ |
| Click "Se quebró" → aparece textarea "¿Qué aprendiste?" | ✓ |
| Click "Lo vendí" → textarea desaparece | ✓ |
| Selector "¿Cuántos proyectos vas a presentar?" ahora ofrece solo 1 y 2 | ✓ (tras invalidar cache del bundle) |

---

## 8. Hallazgos operativos de la jornada

### 8.1 Endpoint `/pg/query` del Supabase Self-Hosted

Durante la jornada se descubrió que el Supabase de NAVES expone el endpoint privado `/pg/query` con autenticación por `service_role` que permite ejecutar SQL arbitrario, incluido DDL (CREATE TYPE, ALTER TABLE, triggers, INSERT en `storage.buckets`). Esto eliminó la fricción de tener que abrir psql o entrar al contenedor para cada migración.

Quedó documentado como memoria de referencia para futuras migraciones.

### 8.2 Orden obligatorio en releases con migraciones

Se identificó —tras un incidente menor— que en releases con migraciones SQL **el orden importa**: si el backend redesplega antes de aplicar el SQL, queries con columnas nuevas (p. ej. `tipo_trabajo_grado` en `meAndCohorte`) fallan con `column does not exist`, lo que rompe flujos básicos como "crear equipo".

Orden estándar adoptado:

1. Aplicar SQL vía `/pg/query`.
2. Verificar con `information_schema`.
3. Redeployar backend.
4. Redeployar frontend.
5. Smoke-test contra `/health` y alguna ruta nueva.

### 8.3 Cache de bundle del frontend en pruebas

Durante la verificación final del cambio 3→2 anteproyectos, el navegador Playwright presentaba aún el bundle JS anterior (con `[1,2,3].map`). Resuelto con cache bust por parámetro de URL. Confirmación adicional consultando el `.js` del bundle público con `curl`.

---

## 9. Estado al cierre de la jornada

| Componente | Estado |
|---|---|
| Frontend en producción | Activo · build con los 7 commits del día |
| Backend en producción | Activo · ruta nueva `/api/participantes/mi-modalidad` responde 401 (existe) |
| Supabase Postgres | 4 migraciones aplicadas (07, 08, 09, 10) |
| Bucket privado `trabajos-grado` | Operativo |
| Tabla `cohorte_hitos` | 88 filas (8 cohortes × 11 hitos) |
| Triggers activos | `trg_lock_tipo_trabajo_grado`, `trg_seed_cohorte_hitos` |
| Defectos abiertos | 0 |

---

## 10. Commits del fin de semana

Cada commit corresponde a un bloque previo de implementación (diseño + código + pruebas locales). El timestamp de `git push` es el momento de subir el cambio acumulado, no la duración del trabajo asociado.

### 10.1 Sábado 9 de mayo — commit `dcc4c0a`

**Push: Sáb 20:30 · Trabajo previo: 14:30 – 20:30 (6 h)**

**`feat: 3 modalidades de trabajo de grado (Business Plan / Caso / Proyecto Investigación)`**

Único commit del sábado, que consolida las 6 horas de trabajo del release 1. Cubre las tres capas (base de datos, backend, frontend), añade un mecanismo completo de upload de archivos por modalidad y deja el sistema preparado para diferenciar los tres tipos de entrega.

**Estadísticas:**

| Métrica | Valor |
|---|---|
| Archivos nuevos | 4 (1 SQL + 1 servicio backend + 1 ruta backend + 1 página frontend) |
| Archivos modificados | 6 (3 backend + 3 frontend) |
| Líneas añadidas (aprox.) | ~880 |

**Base de datos — migración `07_trabajos_grado.sql`:**

- Enum `tipo_trabajo_grado` con los valores `business_plan`, `caso`, `proyecto_investigacion`.
- Columnas `tipo_trabajo_grado` y `tipo_trabajo_grado_fijado_at` en `participantes_lista`.
- Columna `tipo_trabajo_grado` (NOT NULL) en `equipos`.
- Trigger `trg_lock_tipo_trabajo_grado` que impide cambiar la modalidad una vez fijada (defensa en profundidad a nivel de base de datos).
- 8 columnas nuevas en `anteproyectos`: `archivo_anteproyecto_path / _mime / _size_bytes / _uploaded_at` y `archivo_proyecto_final_path / _mime / _size_bytes / _uploaded_at`.
- Migración automática de participantes y equipos legacy a `business_plan`.
- Bucket privado `trabajos-grado` creado en `storage.buckets`.

**Backend — archivos nuevos:**

- `backend/src/services/storage.ts` — wrapper de Supabase Storage: upload con upsert, generación de signed URLs (TTL 5 min), delete.
- `backend/src/routes/trabajos-grado.ts` — endpoint `POST /:id/archivo/:tipo` con multer (memoria, 25 MB de límite, validación estricta de MIME) y endpoint `GET /:id/archivo/:tipo` que devuelve `{ url, expires_in: 300 }`.

**Backend — archivos modificados:**

- `routes/participantes.ts` — endpoints `GET /api/participantes/mi-modalidad` y `PUT /api/participantes/mi-modalidad` (con guarda 409 `ALREADY_SET` para reforzar inmutabilidad).
- `routes/equipos.ts` — guards al crear equipo y al agregar miembros (`MODALIDAD_NO_DEFINIDA`, `TARGET_SIN_MODALIDAD`, `MODALIDAD_MISMATCH`); el equipo hereda la modalidad del creador.
- `routes/anteproyectos.ts` — envío ramificado por modalidad: `business_plan` mantiene la lógica existente (proyectos + hitos); `caso` y `proyecto_investigacion` solo requieren los 2 archivos.
- `server.ts` — registro del nuevo router `trabajos-grado` bajo `/api/anteproyectos`.

**Frontend — archivo nuevo:**

- `frontend/src/pages/participante/TrabajoGrado.tsx` — página completa con dos inputs `file` (anteproyecto / proyecto final), barra de estado por archivo, lógica de reemplazo con borrado del anterior, botón "Enviar definitivo" deshabilitado hasta tener ambos archivos, bloqueo cuando el estado pasa a `enviado`, integración con signed URLs para descargar.

**Frontend — archivos modificados:**

- `pages/Dashboard.tsx` — 3 cards de modalidad (Business Plan, Caso, Proyecto de Investigación); click + confirmación + `PUT` a la API + fijación inmutable; UI dual: tarjeta elegida activa y dos en gris con leyenda "No elegiste esta modalidad".
- `App.tsx` — ruta nueva `/trabajo-grado` registrada en el router.
- `pages/participante/MiEquipo.tsx` — routing condicional al hacer click en "Continuar": Business Plan va a `/anteproyecto` (formulario existente), las otras dos modalidades van a `/trabajo-grado`. Type `Equipo` ampliado con `tipo_trabajo_grado`.

**Decisiones de diseño tomadas en la jornada:**

- Modalidad por participante (no por equipo). Tomada en el bloque de diseño 16:00–17:00.
- Inmutable una vez fijada, con defensa a tres niveles independientes: UI (las dos tarjetas no-elegidas quedan deshabilitadas), backend (409 `ALREADY_SET`), trigger SQL.
- Reuso de la tabla `anteproyectos` añadiendo columnas, en lugar de crear una tabla nueva. Conserva un único ciclo de vida `borrador → enviado → revisado → aprobado` para las tres modalidades.
- Bucket privado con tráfico exclusivo vía backend (`service_role`). El frontend nunca toca Supabase Storage directamente: recibe signed URLs temporales (TTL 5 min) y abre el archivo en pestaña nueva.
- Multer en memoria con límite de 25 MB. Validación estricta de MIME por tipo de archivo: anteproyecto solo acepta `application/pdf`; proyecto final acepta `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.



### 10.2 Domingo 10 de mayo

| Push | Hash | Trabajo previo | Resumen del commit |
|---|---|---|---|
| **Dom 20:30** | `262288e` | 16:00 – 20:30 (4 h 30 min) | **feat(admin): ajustes 1C** — migración SQL 08 con seed de 11 hitos, endpoints de cohortes con hitos y `asignar-bulk`, admin/Cohortes con orden FS/INT, admin/Profesores con soft delete, admin/RolesPermisos con selección masiva, rename "perfil" y preguntas en rojo |
| **Dom 21:00** | `92fda67` | 20:30 – 21:00 (30 min) | **ui(anteproyecto): tipografía y preguntas en rojo** — auditoría con Playwright que detectó las 3 incidencias; corrección del singular gramatical, estandarización del `Field` para preguntas con `text-sm` rojo, normalización de `text-[10px]`/`text-[11px]` a `text-xs` |
| **Dom 21:03** | `2f15c2a` | 21:00 – 21:03 (3 min) | **ui(anteproyecto): contador de textarea a text-xs** — el único `text-[10px]` residual, identificado en la verificación post-deploy del commit anterior |
| **Dom 21:15** | `27f3f51` | 21:03 – 21:15 (12 min) | **docs: informe de auditoría release 2026-05-11 (PDF profesional)** — redacción del MD, conversión a HTML con `style.css` institucional, impresión a PDF de 10 páginas con identidad INALDE |
| **Dom 21:27** | `366848a` | 21:15 – 21:27 (12 min) | **feat(anteproyecto): emprendimiento anterior con 5 opciones** — análisis del esquema final, decisión del cliente; migración SQL 09 con re-intento (VARCHAR(10) insuficiente → VARCHAR(20), CHECK nuevo con 5 valores, migración legacy), zod + nueva pregunta + catálogo + condicional `=== 'quebro'` |
| **Dom 21:32** | `e9f91b5` | 21:27 – 21:32 (5 min) | **feat(anteproyecto): máximo 2 anteproyectos** — migración SQL 10 con guard pre-flight, zod `max(2)`, selector frontend `[1,2]` |
| **Dom 22:00** | `(informe)` | 21:32 – 22:00 (28 min) | **docs: informe de desarrollo del fin de semana** — el presente documento (MD + HTML + PDF profesional) |

Todos pusheados a `main` en `github.com/danielfelipemd/naves` y desplegados en producción.

---

## 11. Conclusión

Fin de semana de **alta densidad de entrega**: dos releases mayores (sábado y domingo), una auditoría completa, su informe institucional en PDF, y dos ajustes adicionales de iteración con el cliente —todos verificados E2E en producción. La plataforma queda operativa para la cohorte vigente con los flujos de las tres modalidades de trabajo de grado funcionando de extremo a extremo. Cero defectos abiertos al cierre del domingo.

---

*Documento generado como parte del proceso de seguimiento continuo del desarrollo. INALDE Business School — NAVES Trabajo de Grado.*
