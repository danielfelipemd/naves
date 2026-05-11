# Plan de Desarrollo · Fases pendientes — Plataforma de Trabajos de Grado MBA INALDE

**Cliente:** INALDE Business School — Programa MBA
**Plataforma:** NAVES — Sistema de Gestión de Trabajos de Grado
**Documento:** Plan de desarrollo de las fases pendientes del brief institucional
**Fecha:** 11 de mayo de 2026
**Versión:** 1.3

---

## 1. Resumen ejecutivo

La plataforma NAVES está en producción y cubre los flujos del **anteproyecto** para las tres modalidades de trabajo de grado (Business Plan / NAVES, Redacción de Caso, Proyecto de Investigación), el **cronograma de hitos** por cohorte, la **sábana consolidada** y la **asignación de profesores** por el super administrador. Todo lo verificado en la auditoría del **2026-05-11**.

Este documento define el plan para construir las **fases pendientes** descritas en el brief institucional (Versión 1.0, mayo 2026), **migrar la plataforma a la infraestructura tecnológica de la Universidad de La Sabana**, **publicarla bajo el dominio institucional definido por el cliente** y **dejar el modelo de IA configurado con la cuenta y los créditos del cliente**.

**Estimación total:** **66 horas**, distribuidas en 9 sprints de construcción, un sprint dedicado a pruebas E2E con Playwright y corrección de bugs, y la entrega de los manuales de Usuario y de Administración.

**Cronograma propuesto:** 4 semanas calendario, del **mié 13 de mayo de 2026** al **mar 9 de junio de 2026**, con una carga promedio de 16-17 horas por semana.

---

## 2. Estado actual

Lo que ya está construido y operativo:

| Módulo | Estado |
|---|---|
| Cohortes con cronograma de 11 hitos por cohorte | Operativo |
| Selector de modalidad de trabajo de grado | Operativo |
| Anteproyecto NAVES (Canvas + Mercado + Hitos · hasta 2 alternativas) | Operativo |
| Upload de PDF anteproyecto Caso y Proyecto de Investigación | Operativo |
| PDF profesional del anteproyecto y de la sábana | Operativo |
| Sábana de proyectos con sugerencia de profesor por afinidad | Operativo |
| Asignación profesor↔equipo registrada por super admin | Operativo |
| Selección del proyecto definitivo · solicitudes de desarchivado | Operativo |
| RBAC granular y auditoría automática | Operativo |
| Manual de Usuario v1.1 (34 páginas) | Entregado |

---

## 3. Alcance del nuevo desarrollo

Se listan únicamente las acciones que el brief institucional pide explícitamente y que aún no están construidas.

**Fase 1 — Planeación**
- Ajustar el cronograma a las ~14 fechas hito según la fórmula institucional.
- Generar el sitio público con el cronograma y enviarlo automáticamente a los participantes.

**Fase 2 — Anteproyecto (Caso e Investigación)**
- Email automático al director del caso o tutor cuando el participante sube el PDF.
- Carta formal del director al Comité MBA con plantilla institucional y campos variables, generada y firmada electrónicamente con un solo clic.
- Aprobación del Comité MBA con un clic.
- Notificación automática al participante y al director al aprobar.
- Informe automático al Comité MBA al cerrar la ventana, con la lista por modalidad.

**Fase 3 — Asignación de profesores (NAVES)**
- Email al participante con el profesor asignado y el link para agendar la primera reunión por Microsoft Bookings (link configurado en el perfil de cada profesor).

**Fase 4 — Seguimiento**
- NAVES: notificación automática al abrir cada ventana de reunión (R1 y R2) y registro de si fue agendada y realizada.
- Caso e Investigación: upload del documento de avance, email automático al director y registro de fecha.

**Fase 5 — Entrega del trabajo final**
- NAVES: campos del Business Plan completo + uploads obligatorios del Business Plan PDF, el One Pager PDF y el logo en alta resolución.
- Caso e Investigación: upload del PDF del trabajo final.
- Informe automático al Comité MBA al cerrar la ventana.

**Fase 6 — Cierre académico**
- Demo Day (NAVES): programación automática por sector económico en bloques de 5 presentaciones (2-4 días × 2-4 bloques), aprobación del super admin, distribución por email a Publicaciones, Coordinación Académica, Marketing (con borradores de post de LinkedIn por proyecto) y Coordinación del Programa.
- Actas de grado (3 modalidades): generación del acta, firma electrónica multi-firmante, link único masivo del director del programa para firmar todas con un clic, distribución por email.
- Calificación AOL (NAVES): IA propone calificación por criterio de la rúbrica leyendo el Business Plan; el profesor acepta, modifica o rechaza; genera Excel + Word y los guarda en OneDrive.

---

## 4. Plan por sprints

### Sprint 1 — Publicación del cronograma (Fase 1) · 2 h

| Tarea | Horas |
|---|---|
| Ajuste a 14 hitos según fórmula institucional + página pública por cohorte | 1 |
| Envío automático del cronograma a los participantes | 1 |

### Sprint 2 — Flujo Caso / Investigación con carta firmada (Fase 2) · 5 h

| Tarea | Horas |
|---|---|
| Email automático al director al subir PDF del anteproyecto | 0.5 |
| Plantilla parametrizable de la carta del Comité + generación PDF | 1 |
| Firma electrónica de la carta y envío con un clic | 1.5 |
| Bandeja del Comité MBA con aprobación de un clic | 1 |
| Notificaciones a participante y director al aprobar | 0.5 |
| Informe automático al Comité MBA al cerrar la ventana | 0.5 |

### Sprint 3 — Asignación de profesores (Fase 3) · 1 h

| Tarea | Horas |
|---|---|
| Campo "Link Microsoft Bookings" en perfil del profesor | 0.25 |
| Email al participante con profesor asignado + link de Bookings | 0.75 |

### Sprint 4 — Seguimiento intermedio (Fase 4) · 2 h

| Tarea | Horas |
|---|---|
| Notificación a participantes al abrir cada ventana (R1 y R2) | 0.5 |
| Pantalla del profesor para registrar agendada/realizada | 0.75 |
| Upload del documento de avance Caso/Investigación + email al director | 0.75 |

### Sprint 5 — Entrega del trabajo final (Fase 5) · 3 h

| Tarea | Horas |
|---|---|
| Extensión del formulario NAVES a Business Plan completo (modo entrega final) | 1 |
| Uploads obligatorios: Business Plan PDF, One Pager PDF, Logo HD (NAVES) | 1 |
| Upload PDF trabajo final Caso/Investigación + informe al Comité MBA | 1 |

### Sprint 6A — Demo Day NAVES (Fase 6) · 4 h

| Tarea | Horas |
|---|---|
| Algoritmo de programación por sector económico (bloques de 5; 2-4 días × 2-4 bloques) | 1.5 |
| Pantalla de revisión + aprobación del super admin | 1 |
| Emails a Publicaciones, Coordinación Académica y Coordinación del Programa | 0.5 |
| Borradores de post de LinkedIn por proyecto (uso del prompt entrenado) + email a Marketing con logos | 1 |

### Sprint 6B — Actas de grado con firma electrónica (Fase 6) · 6 h

| Tarea | Horas |
|---|---|
| Generación PDF del acta (una por equipo NAVES, una individual Caso/Investigación) | 1.5 |
| Integración de la herramienta de firma electrónica (a definir con el cliente) | 2.5 |
| Flujo multi-firmante (participantes + director + director del programa) | 1 |
| Link único masivo del director del programa | 0.5 |
| Distribución por email de actas firmadas | 0.5 |

### Sprint 6C — Calificación AOL con IA (Fase 6) · 6 h

| Tarea | Horas |
|---|---|
| Lectura del Business Plan PDF + ejecución de calificación con el prompt entrenado | 2 |
| Pantalla del profesor: aceptar / modificar / rechazar cada sugerencia | 1.5 |
| Generación del Excel consolidado y del documento Word por proyecto | 1.5 |
| Guardado automático en OneDrive | 1 |

### Sprint 7 — Migración al servidor de la Universidad de La Sabana · 6 h

Despliegue de la plataforma desde el VPS actual al servidor institucional de la **Universidad de La Sabana**, manteniendo el mismo modelo operativo basado en **EasyPanel** que ya está en producción.

| Tarea | Horas |
|---|---|
| Coordinación con TI de La Sabana (accesos, puertos, ventana de despliegue) | 1 |
| Instalación de **EasyPanel** en el servidor institucional | 1 |
| Despliegue del stack Supabase self-hosted desde EasyPanel | 1.5 |
| Despliegue del backend y frontend con auto-deploy desde GitHub preservado | 1 |
| Migración del volumen de PostgreSQL (datos productivos) | 1 |
| Validación de HTTPS y conectividad institucional | 0.5 |

> El sprint puede cerrarse entre **4 y 6 horas** según la disponibilidad del servidor de la Universidad. La estimación conservadora es 6 horas.

### Sprint 8 — Puesta en producción · 8 h

| Tarea | Horas |
|---|---|
| Coordinación con el cliente para definir el dominio institucional y registros DNS solicitados | 1 |
| Configuración de los registros DNS del dominio (A / CNAME) | 1.5 |
| Configuración del dominio en el servidor (vhost · reverse proxy) | 1.5 |
| Emisión y configuración de los certificados SSL para el dominio institucional | 2 |
| Comunicación de URLs y credenciales a los usuarios + soporte de los primeros días | 2 |

### Sprint 9 — Configuración y entrenamiento de la IA · 9 h

La plataforma incorpora tres usos de IA: **resúmenes ejecutivos** en la sábana de proyectos (Fase 3), **borradores de post de LinkedIn** por proyecto (Fase 6 — Demo Day) y **propuesta de calificación AOL** sobre cada Business Plan (Fase 6 — AOL). El entrenamiento es **iterativo**: cada uso requiere un ciclo de prompt → ejecución sobre datos reales → validación con el área responsable → ajuste → repetir hasta alcanzar la calidad de salida esperada.

| Tarea | Horas |
|---|---|
| Apertura y configuración de la cuenta de IA del cliente: claves, límites de gasto, alertas de consumo y dashboard de monitoreo | 1 |
| **Resúmenes ejecutivos de la sábana** — prompt inicial + 2-3 iteraciones con la Coordinación del Programa sobre un dataset real de anteproyectos | 2 |
| **Borradores de post de LinkedIn** — prompt inicial + 3-4 iteraciones con Marketing & Comunicaciones para fijar la voz institucional INALDE | 2 |
| **Calificación AOL** — prompt inicial sobre Business Plans históricos + 4-5 iteraciones validadas contra calificaciones de referencia del director del programa | 3 |
| Documentación de los prompts finales para que el cliente pueda re-entrenarlos en el futuro | 1 |

### Sprint 10 — Pruebas E2E con Playwright y corrección de bugs · 9 h

Cobertura automatizada de los flujos construidos en los 9 sprints anteriores, con recorridos por cada rol (super admin, profesor, participante, comité MBA, director del programa) y resolución de los bugs detectados antes y durante la operación temprana.

| Tarea | Horas |
|---|---|
| Pruebas E2E con Playwright para Fases 1-5 (cronograma, anteproyecto Caso/Investigación, asignación, seguimiento, entrega final) | 3 |
| Pruebas E2E con Playwright para Fase 6 (Demo Day, actas con firma electrónica, calificación AOL) | 3 |
| Corrección de bugs detectados en las pruebas y en la operación temprana | 3 |

### Entrega de manuales · 5 h

| Tarea | Horas |
|---|---|
| Actualización del **Manual de Usuario** con los nuevos flujos y capturas | 2.5 |
| Redacción del **Manual de Administración** (operación, configuración, RBAC, mantenimiento) | 2.5 |

---

## 5. Resumen de horas

| Sprint | Alcance | Horas |
|---|---|---|
| 1 | Publicación del cronograma (Fase 1) | 2 |
| 2 | Caso/Investigación + carta firmada (Fase 2) | 5 |
| 3 | Asignación + email con link Bookings (Fase 3) | 1 |
| 4 | Seguimiento intermedio (Fase 4) | 2 |
| 5 | Entrega del trabajo final (Fase 5) | 3 |
| 6A | Demo Day NAVES (Fase 6) | 4 |
| 6B | Actas + firma electrónica (Fase 6) | 6 |
| 6C | Calificación AOL con IA (Fase 6) | 6 |
| 7 | Migración al servidor de la Universidad de La Sabana | 6 |
| 8 | Puesta en producción (DNS, dominio, SSL, soporte inicial) | 8 |
| 9 | Configuración y entrenamiento de la IA (prompts + créditos) | 9 |
| 10 | Pruebas E2E con Playwright y corrección de bugs | 9 |
| M | Manuales de Usuario y de Administración | 5 |
| **Total** | | **66** |

---

## 6. Cronograma propuesto

Inicio sugerido: **miércoles 13 de mayo de 2026**. Cierre sugerido: **martes 9 de junio de 2026** (4 semanas calendario · 66 horas · 16-17 horas por semana).

| Semana | Fechas | Foco de la semana | Horas |
|---|---|---|---|
| 1 | 13-19 may (mié-mar) | Sprints 1, 2, 3, 4 y 5 (todas las Fases 1-5 del brief) + arranque Sprint 9 (apertura cuenta IA y entrenamiento del prompt de resúmenes ejecutivos) | 16 |
| 2 | 20-26 may (mié-mar) | Sprint 6A (Demo Day NAVES) + Sprint 6B (actas + firma electrónica) + Sprint 9 (posts LinkedIn + arranque AOL) + arranque Sprint 10 (pruebas E2E de Fases 1-5) | 16 |
| 3 | 27 may - 2 jun (mié-mar) | Sprint 6C (calificación AOL) + Sprint 9 (validación final del prompt AOL con el director del programa) + Sprint 10 (pruebas E2E de Fase 6) + arranque Sprint 7 (coordinación con TI de La Sabana) | 17 |
| 4 | 3-9 jun (mié-mar) | Sprint 7 (cierre de la migración a La Sabana) + Sprint 8 (puesta en producción · DNS, dominio, SSL) + Sprint 10 (corrección final de bugs) + entrega de los manuales de Usuario y de Administración | 17 |

**Cruce del entrenamiento de IA con los sprints funcionales:** el entrenamiento de IA se reparte a lo largo del proyecto, no se concentra en una sola semana. Cada prompt se entrena justo antes —o en paralelo— al sprint funcional que lo consume:

- **Resúmenes ejecutivos** → entrenamiento en la semana 1, validación con la Coordinación del Programa.
- **Posts de LinkedIn** → entrenamiento en la semana 2, antes de ejecutar el Sprint 6A (Demo Day).
- **Calificación AOL** → entrenamiento en la semana 3, simultáneamente con el Sprint 6C, validado contra calificaciones históricas con el director del programa.

Esta secuencia permite **probar cada prompt sobre datos reales** del propio sprint en construcción y validarlo con el área responsable sin retrasos.

---

## 7. Entregables

- Plataforma completa en producción cubriendo las **6 fases** del brief.
- Plataforma migrada al **servidor de la Universidad de La Sabana**.
- Plataforma publicada bajo el **dominio institucional** definido por el cliente.
- **Modelo de IA configurado y entrenado** (resúmenes, posts y AOL) · operación gestionada incluida en el servicio.
- **Manual de Usuario** actualizado en PDF.
- **Manual de Administración** en PDF.

---

## 8. Supuestos y dependencias del cliente

| Dependencia | Sprint que la requiere |
|---|---|
| Fórmula final de las 14 fechas hito | 1 |
| Plantilla institucional de la carta del Comité MBA | 2 |
| Decisión de la herramienta de firma electrónica | 2 y 6B |
| Lista de direcciones del Comité MBA, Publicaciones, Coordinación Académica, Marketing y Coordinación del Programa | 2, 5 y 6A |
| Plantilla institucional del post de LinkedIn | 6A |
| Plantilla del acta de grado (NAVES y Caso/Investigación) | 6B |
| Rúbrica AOL en formato estructurado (criterios + niveles) | 6C |
| Acceso a OneDrive institucional para guardar resultados AOL | 6C |
| Acceso al servidor de la Universidad de La Sabana (credenciales, puertos, dominios, certificados, ventana de despliegue) | 7 |
| Dominio institucional definido por el cliente para la plataforma | 8 |

---

## 9. Requerimientos técnicos

### 9.1 Operación de IA

La plataforma usa IA en tres puntos del flujo: **resúmenes ejecutivos** de la sábana, **borradores de post de LinkedIn** del Demo Day y **propuesta de calificación AOL** sobre el Business Plan.

El cliente puede escoger entre **dos modelos de operación** del servicio de IA:

#### Opción A · Suscripción mensual al proveedor de la plataforma (recomendada)

El proveedor de la plataforma opera la cuenta de IA y entrega el servicio como una suscripción mensual que incluye:

- Provisión y operación de la cuenta del modelo de IA institucionalizada para la plataforma.
- Consumo de créditos del modelo en todos los usos descritos, para volúmenes normales de operación (hasta ~30 proyectos NAVES por cohorte activa).
- Monitoreo de consumo y alertas operativas.
- Re-ajuste de prompts cuando un área responsable lo solicite (cambio de tono, criterios actualizados, etc.).

**Tarifa estimada:** **USD 50 / mes** (≈ COP 200.000 / mes), facturada como suscripción mensual al cierre del proyecto. El cliente no abre cuenta con el proveedor de IA, no gestiona claves API ni se ocupa del monitoreo del consumo.

#### Opción B · Cuenta de IA propia del cliente

Si el cliente prefiere asumir directamente los costos de IA, puede contratar su propia cuenta institucional con el proveedor que escoja y entregar las claves API a la plataforma.

En este modelo, el cliente asume:

- El costo del consumo de créditos directamente con el proveedor de IA.
- La gestión de claves, límites de gasto y alertas de consumo.
- El monitoreo periódico del dashboard del proveedor.

La suscripción mensual de la **Opción A** no aplica en este caso.

#### Comparativo rápido

| Aspecto | Opción A · Suscripción | Opción B · Cuenta propia |
|---|---|---|
| Quién opera la cuenta de IA | Proveedor de la plataforma | Cliente |
| Costo mensual | USD 50 / mes (cobertura completa) | Variable según consumo + tiempo del cliente para monitoreo |
| Gestión de claves y créditos | Incluida | A cargo del cliente |
| Re-ajuste de prompts ante cambios | Incluido | A cargo del proveedor de la plataforma, facturado aparte |
| Recomendado para | Operación estable, sin carga administrativa del cliente | Clientes que ya tienen contrato corporativo con un proveedor de IA |

### 9.2 Soporte y mantenimiento mensual

Posterior a la entrega del proyecto, el cliente contrata un paquete mensual de horas de soporte y mantenimiento para atender los ajustes que se requieran sobre la plataforma en operación.

**Qué SÍ incluye este paquete:**

- Corrección de bugs reportados sobre las funcionalidades en producción.
- Ajustes menores de interfaz y experiencia de usuario.
- Soporte y atención de consultas a los usuarios (administradores, profesores, participantes).
- Monitoreo operativo de la plataforma y resolución de incidencias.
- Capacitación adicional puntual sobre el uso del sistema.

**Qué NO incluye este paquete** (se cotizan aparte como nuevo desarrollo):

- Desarrollo de nuevas funcionalidades fuera del alcance del proyecto.
- Cambios estructurales en la arquitectura de la plataforma.
- Integraciones con sistemas adicionales no previstos.
- Recuperación tras incidentes mayores de infraestructura del servidor.

**Paquete contratado:**

| Concepto | Detalle |
|---|---|
| Horas de soporte incluidas por mes | **6 horas** |
| Tarifa de soporte por hora | **COP 90.000** |
| Mensualidad fija | **COP 540.000 / mes** |

**Tarifas de referencia:**

| Concepto | Tarifa por hora |
|---|---|
| Hora de soporte (dentro del paquete mensual de 6 h) | COP 90.000 |
| Hora de desarrollo (nuevas funcionalidades fuera del paquete) | COP 110.000 |

**Condiciones del paquete:**

- Las horas no utilizadas en el mes **no se acumulan** al mes siguiente.
- Las horas adicionales de soporte por encima de las 6 horas mensuales se facturan a la **tarifa de soporte (COP 90.000 / hora)**.
- Cualquier trabajo de **nueva funcionalidad** o desarrollo fuera del alcance del soporte se cotiza y factura a la **tarifa de desarrollo vigente (COP 110.000 / hora)**.
- Tiempo de respuesta estándar: **72 horas hábiles** desde el reporte.
- Tiempo de respuesta para **incidencias críticas de producción** (plataforma caída, login bloqueado, pérdida de datos): **dentro de las primeras 24 horas**.

### 9.3 Infraestructura de servidor

#### 9.3.1 Servidor actual · transición durante la migración

Mientras se completa la migración a la Universidad de La Sabana, la plataforma sigue operando en el **VPS actual** donde está hoy en producción. Esto evita cualquier interrupción del servicio a los participantes activos durante el periodo de migración.

| Concepto | Valor |
|---|---|
| Proveedor | Hosting VPS (EasyPanel) actual de NAVES |
| Suscripción mensual | **COP 70.000** |
| Duración estimada | 1 a 2 meses máximo (hasta cerrar Sprints 7 y 8) |
| Costo total estimado | **COP 70.000 – COP 140.000** |
| Quién lo asume | Cliente, directamente con el proveedor de hosting actual |
| Baja del servicio | Una vez verificada la operación estable en el servidor de La Sabana, el VPS actual se da de baja |

#### 9.3.2 Servidor destino · Universidad de La Sabana

| Recurso | Mínimo | Recomendado |
|---|---|---|
| RAM | 4 GB | 8 GB |
| CPU | 2 vCPU | 4 vCPU |
| Disco SSD | 40 GB | 80 GB |
| Sistema operativo | Linux (Ubuntu LTS o Debian) | Ubuntu 22.04 LTS |
| Acceso | SSH con permisos suficientes para **instalar EasyPanel** (panel de administración de contenedores Docker) + puertos 80/443 abiertos | Acceso root o sudo completo |
| Gestión de contenedores | **EasyPanel** administra Docker, Docker Compose, certificados SSL Let's Encrypt y auto-deploy desde GitHub | Mismo stack que ya opera en el VPS actual de NAVES |
| Backup | Snapshot semanal del volumen de PostgreSQL (gestionado desde EasyPanel) | Política de retención definida con TI |

> **Por qué EasyPanel:** la plataforma NAVES ya corre hoy sobre EasyPanel en el VPS actual, con Supabase self-hosted, backend y frontend orquestados como contenedores. Migrar manteniendo EasyPanel preserva el flujo de auto-deploy desde GitHub, la renovación automática de SSL y el modelo operativo conocido, lo que reduce el tiempo y el riesgo de la migración.

### 9.4 Servicios externos requeridos

| Servicio | Para qué | Quién provee |
|---|---|---|
| Servidor SMTP institucional (o pasarela paga como SendGrid / Mailgun) | ≈ 12 plantillas de email del flujo automatizado | Cliente · TI institucional |
| Herramienta de firma electrónica | Firma de la carta del Comité MBA y de las actas de grado | Cliente (DocuSign, SignWell, Autentic u otra) |
| OneDrive institucional | Carpeta destino de los archivos AOL (Excel + Word) — evidencia de acreditación AACSB / EQUIS / AMBA | Cliente · M365 institucional |
| DNS del dominio institucional | Apuntar el dominio al servidor de La Sabana | Cliente · área que administre DNS |
| Microsoft 365 | Que cada profesor cree su agenda en Bookings y entregue su link | Cliente (los profesores ya tienen M365) |
| Operación de IA | Resúmenes, posts LinkedIn, calificación AOL · operación continua, créditos y monitoreo | Suscripción mensual con el proveedor de la plataforma (USD 50 / mes) · Alternativa: el cliente asume con cuenta propia |

### 9.5 Software y dependencias técnicas

| Componente | Versión | Observaciones |
|---|---|---|
| **EasyPanel** | Última estable | Panel de administración que orquesta Docker, certificados SSL y auto-deploy desde GitHub. Es el mismo stack que ya opera en el VPS actual de NAVES. |
| Docker + Docker Compose | Docker ≥ 24 · Compose ≥ 2 | Provisionado y gestionado por EasyPanel; no se administra manualmente |
| Node.js | ≥ 20 LTS | Backend Express + frontend Vite |
| PostgreSQL | 15 (vía Supabase self-hosted) | Volumen persistente gestionado desde EasyPanel |
| Certificados SSL | Let's Encrypt vía EasyPanel | Renovación automática sin intervención manual |

### 9.6 Cuentas y accesos que el cliente debe entregar

- Cuenta administrativa del **DNS** del dominio institucional.
- Acceso **SSH** al servidor de La Sabana con permisos suficientes para instalar **EasyPanel** (panel de administración de contenedores).
- Cuenta del **proveedor de firma electrónica** con cupo mensual de firmas.
- Acceso de escritura a la carpeta de **OneDrive institucional** destino del AOL (cuenta de servicio, no cuenta personal).
- Lista de **direcciones de correo** del Comité MBA, Publicaciones, Coordinación Académica, Marketing y Coordinación del Programa.

---

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Demora del cliente en elegir la herramienta de firma electrónica | Construir Sprint 6B con generación de PDF y simulación de firma; conectar la API al final. |
| Cambios en la rúbrica AOL | Modelar la rúbrica como dato editable, no hardcoded. |
| Cambios en plantillas institucionales (acta, carta, LinkedIn) | Plantillas almacenadas como datos editables, no requieren redeploy. |
| Demora en disponibilidad del servidor de la Universidad de La Sabana | Coordinar con TI desde el inicio del proyecto. Mantener el VPS actual operativo en paralelo hasta confirmar éxito de la migración. |

---

## 11. Cierre

Este plan permite cerrar el alcance completo del brief institucional, **migrar la plataforma a la infraestructura de la Universidad de La Sabana**, **publicarla bajo el dominio institucional definido por el cliente** y **dejar el modelo de IA entrenado y configurado con su cuenta y créditos** en **66 horas** de trabajo distribuidas en 4 semanas calendario. Al término del proyecto, INALDE Business School contará con una plataforma única que cubre las tres modalidades del trabajo de grado desde la publicación del cronograma hasta la entrega de las actas firmadas y la calificación AOL, acompañada por los manuales de Usuario y de Administración.

---

*Documento preparado el 11 de mayo de 2026 por Daniel F. Montaña D. · Metodología de desarrollo: Vibe Code.*
