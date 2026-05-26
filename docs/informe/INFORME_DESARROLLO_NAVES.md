# Informe de desarrollo · Plataforma NAVES INALDE

**Cliente:** INALDE Business School — Programa MBA  
**Proyecto:** NAVES (New Business Adventures) — Plataforma de gestión del trabajo de grado  
**Período:** 2 al 4 de mayo de 2026  
**Duración total:** 3 días · ~17 horas de trabajo  
**URL en producción:** https://naves-frontend.huem98.easypanel.host

---

## Resumen ejecutivo

Durante un período de **tres días** se diseñó, desarrolló y desplegó en producción una plataforma web completa para la gestión del trabajo de grado del MBA de INALDE Business School. La plataforma cubre el ciclo completo de los participantes desde la formación de equipos hasta la selección del proyecto definitivo, incluye un panel administrativo robusto y un sistema granular de roles y permisos.

El sistema atiende **tres perfiles de usuario** (Administrador, Profesor, Participante), incorpora **catálogos oficiales pre-cargados** (499 clases CIIU del DANE, 8 cohortes del MBA), genera **PDFs con identidad institucional** para anteproyectos y sábana de proyectos, y registra **auditoría automática** de toda acción relevante mediante triggers de base de datos.

Adicionalmente se entrega un **Manual de Usuario en PDF de 34 páginas** con 33 capturas de pantalla, listo para distribuir entre los usuarios finales.

---

## Cronología detallada

### Día 1 — Sábado 2 de mayo · Infraestructura (≈ 4 horas)

**Objetivo del día:** Preparar el entorno de producción donde correrá la plataforma.

| Actividad | Resultado |
|---|---|
| Creación del proyecto `naves` en EasyPanel | Entorno aislado en VPS dedicado |
| Despliegue del stack Supabase self-hosted | 12+ contenedores orquestados con Docker Compose (PostgreSQL, Kong, Auth, PostgREST, Realtime, Storage, Studio, Imgproxy, Meta, Analytics, Vector, Functions) |
| Configuración de dominios HTTPS con Let's Encrypt | 3 subdominios productivos con certificados válidos |
| Validación de Supabase Studio y endpoints públicos | Backend de datos confirmado operativo |

**Entregable:** Infraestructura productiva funcionando bajo HTTPS, lista para recibir el código de la aplicación.

---

### Día 2 — Domingo 3 de mayo · Arquitectura y seguridad (≈ 5 horas)

**Objetivo del día:** Definir las decisiones técnicas estructurales y endurecer la seguridad.

| Actividad | Resultado |
|---|---|
| Rotación completa de keys de Supabase | Anon key, service role key, JWT secret, postgres password, dashboard credentials y vault encryption key — todas regeneradas |
| Auditoría de variables de entorno en los 3 servicios | Configuración coherente y sin claves por defecto |
| Diseño del esquema de autenticación con cédula | Solución segura: hash SHA-256 de la cédula → email sintético, sin exponer cédulas en Supabase Auth |
| Política de encriptación de PII | AES-256-GCM para cédula, email y celular en base de datos |
| Diseño del sistema de claims JWT custom | `app_role`, `participante_id`, `cohorte_id`, `es_super_admin` viajan en el JWT |
| Decisión arquitectónica: stack único en Node | Eliminación del servicio Python; toda la lógica converge en el backend Node/Express |
| Política de aislamiento de Supabase | Ningún cliente accede a Supabase directamente; todo va por el backend Node |
| Definición del catálogo de cohortes del MBA | 8 cohortes: INT/FS · 24-26, 26-28, 27-29, 28-30 |
| Definición del NAVES Scheduler | 4 fechas críticas por cohorte que controlan los bloqueos de acciones del flujo |
| Diseño del flujo end-to-end para los 3 roles | Roadmap claro para la jornada de codificación |

**Entregable:** Arquitectura técnica definida y documentada, sin riesgos de seguridad conocidos.

---

### Día 3 — Lunes 4 de mayo · Codificación y entrega (≈ 8 horas)

**Objetivo del día:** Implementar la totalidad del producto y entregar el manual de usuario.

#### Mañana — Backend, base de datos y frontend base (08:41 → 12:00)

- Scaffold del repositorio: estructura `backend/` (Node + Express + TypeScript) y `frontend/` (React + Vite + TypeScript + Tailwind), Dockerfiles, integración con auto-deploy de EasyPanel
- Migraciones SQL completas: tablas core de cohortes, participantes, equipos, miembros, anteproyectos, proyectos, hitos, sábanas, solicitudes, auditoría
- Triggers de Postgres para auditoría automática de toda acción
- Carga del catálogo CIIU (499 clases del DANE Rev. 4 A.C. 2020) con búsqueda inteligente
- Endpoints REST: autenticación con cédula, búsqueda CIIU, gestión de participantes y equipos, anteproyectos, selección de proyecto definitivo, solicitudes de desarchivado
- Frontend: pantallas de login dual (cédula/email), Mi Equipo, formulario de Anteproyecto con selector CIIU autocompletado
- Datos de prueba seedeados (6 participantes de ejemplo)

#### Mediodía — Módulo administrativo y generación de PDFs (12:00 → 15:00)

- Panel administrativo completo con 7 módulos independientes:
  - Cohortes con NAVES Scheduler
  - Cargar participantes (importación Excel)
  - Profesores
  - Anteproyectos (lista + detalle)
  - Sábana de proyectos
  - Solicitudes de desarchivado
  - Auditoría
- Pantalla "Selección del proyecto definitivo" con manejo de los 5 estados posibles del flujo
- Pantalla "Mi profesor" con integración de booking
- Flujo completo de **recuperación de clave + reset password**
- **Generación de PDFs profesionales** con identidad INALDE para anteproyecto individual y sábana consolidada
- Refactor del dashboard administrativo: cards independientes con hints contextuales y alertas
- Limpieza de mockups HTML originales

#### Tarde — RBAC granular (15:00 → 16:00)

- Migración SQL del sistema de Roles y Permisos: 5 tablas dedicadas, 21 permisos atómicos en 9 categorías
- 3 roles del sistema seedeados (Administrador, Profesor, Participante) con permisos por defecto coherentes
- Funciones de Postgres `auth.tiene_permiso()` y `auth.permisos_del_usuario()` con caché de 60 segundos
- Endpoints `/api/admin/roles` con middleware `requirePermission`
- Frontend `/admin/roles-permisos` con tabla, modal de edición y permisos mostrados con descripción legible (no códigos técnicos)
- Renombrado consistente de "Super admin" a "Administrador" en toda la interfaz visible al usuario

#### Tarde — Anteproyecto refinado y experiencia de usuario (16:00 → 17:00)

- Reescritura del formulario de Anteproyecto fiel al diseño original (todos los campos del Canvas del negocio, fuentes de validación, cronograma)
- Buscador inteligente en vivo en Mi Equipo (sin botón "Buscar", debounce de 250 ms)
- Layout optimizado a 1100 px de ancho aprovechable, Canvas en 2 columnas
- Cronograma de hitos con auto-expansión: empieza con 1 hito visible y se expande automáticamente a medida que el participante avanza (hasta un máximo de 10)

#### Tarde-noche — Manual de usuario y entrega final (17:00 → 18:21)

- Manual de Usuario v1.0 redactado: 400+ líneas Markdown, 26 capturas de pantalla obtenidas mediante automatización con Playwright
- Conversión a PDF profesional de 34 páginas con identidad INALDE (rojo institucional + tipografía corporativa)
- 7 capturas adicionales del nuevo layout de Anteproyecto
- Manual v1.1: incorporación del módulo "Roles y permisos", actualización de terminología, documentación del live search, del auto-grow del cronograma, de los botones de descarga PDF, y glosario actualizado
- Resolución del incidente de red Docker en el VPS y regeneración final del PDF

**Entregable del día:** Plataforma completa en producción + Manual de Usuario PDF distribuible.

---

## Entregables finales

### Plataforma en producción
- **Frontend:** https://naves-frontend.huem98.easypanel.host
- **Backend API:** https://naves-backend.huem98.easypanel.host
- **Supabase (interno):** https://naves-supabase.huem98.easypanel.host
- Auto-deploy desde GitHub: cada push a `main` despliega automáticamente

### Funcionalidades por rol

**Administrador (panel completo de 8 módulos)**
- Gestión de las 8 cohortes del MBA con configuración de fechas críticas (NAVES Scheduler)
- Carga masiva de participantes desde Excel
- Gestión de cuentas de profesores con áreas de afinidad
- Visualización y descarga PDF de todos los anteproyectos
- Generación de la Sábana de proyectos con sugerencia automática de asignaciones profesor↔equipo
- Gestión de solicitudes de desarchivado de proyectos
- Sistema de Roles y Permisos granular para delegación parcial
- Auditoría cronológica de todos los eventos del sistema

**Profesor**
- Visualización de anteproyectos asignados
- Lectura y descarga PDF de la Sábana
- Aprobación o rechazo de solicitudes de desarchivado de equipos asignados

**Participante (estudiante)**
- Login seguro con cédula
- Creación y gestión de equipo (1 a 3 personas) con buscador en vivo
- Formulario de Anteproyecto con hasta 3 alternativas de proyecto
- Canvas del negocio (8 bloques), validación del mercado, cronograma de hitos
- Selección del proyecto definitivo posterior a la Reunión 1 con su profesor
- Solicitud de desarchivado de proyectos descartados
- Visualización de profesor asignado y agenda de booking

### Documentación
- Manual de Usuario v1.1 en PDF (34 páginas, 33 capturas de pantalla, identidad INALDE)
- Documentación técnica de arquitectura y decisiones (interna)

---

## Métricas del proyecto

| Indicador | Valor |
|---|---|
| Días calendario de trabajo | **3** |
| Horas estimadas de trabajo | **≈ 17 h** |
| Commits al repositorio | **24** |
| Líneas de código (TypeScript + SQL) | **7.019** |
| Archivos backend (TypeScript) | 19 |
| Archivos frontend (TSX/TS) | 28 |
| Migraciones SQL | 6 |
| Endpoints REST implementados | ≈ 35 |
| Pantallas/rutas frontend | ≈ 15 |
| Permisos atómicos del sistema RBAC | 21 |
| Clases CIIU pre-cargadas | 499 |
| Cohortes del MBA pre-cargadas | 8 |
| Capturas de pantalla del manual | 33 |
| Páginas del manual PDF | 34 |

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 · Vite · TypeScript · Tailwind CSS |
| Backend | Node.js · Express · TypeScript |
| Base de datos | PostgreSQL (Supabase self-hosted) |
| Autenticación | JWT custom con claims propios |
| Encriptación PII | AES-256-GCM |
| Generación de PDFs | pdfkit (anteproyectos y sábana) · md-to-pdf (manual) |
| Orquestación | Docker · Docker Compose |
| Hosting | VPS dedicado con EasyPanel |
| Certificados | Let's Encrypt (renovación automática) |
| CI/CD | Webhooks de GitHub a EasyPanel (auto-deploy) |
| Pruebas E2E | Playwright |

---

## Estado actual y próximos pasos sugeridos

**Operativo en producción:**  
La plataforma está funcionando y es completamente usable por los 3 roles definidos.

**Pendientes menores no bloqueantes:**
- Configuración del servidor SMTP institucional para envío real de emails de recuperación de clave (actualmente se usa SMTP de pruebas)
- 3 capturas de pantalla del módulo "Roles y permisos" para incorporar en la próxima revisión del manual

**Recomendaciones a futuro:**
- Habilitar copia de seguridad programada del volumen de PostgreSQL
- Configurar monitoreo y alertas (uptime + métricas básicas)
- Definir política de retención de datos de la tabla de auditoría

---

**Documento generado el 4 de mayo de 2026**  
**Plataforma NAVES — New Business Adventures · INALDE Business School · MBA**
