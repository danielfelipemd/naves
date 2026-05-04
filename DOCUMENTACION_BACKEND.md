# Documentación Técnica del Frontend - Anteproyecto NAVES INALDE

**Versión:** 3.0
**Fecha:** 1 de mayo de 2026
**Archivo frontend:** `anteproyecto.html`
**Dirigido a:** Ingeniero backend

---

## 1. Visión general del sistema

### 1.1 Contexto del negocio

NAVES (New Business Adventures) es una opción de trabajo de grado del MBA de INALDE Business School. Los participantes del MBA presentan un **anteproyecto** que describe el o los emprendimientos que desarrollarán durante el programa.

**Concepto clave del proceso:** un equipo entrega 1, 2 o 3 **alternativas** de proyecto en su anteproyecto. Posteriormente, en una reunión con el profesor (Reunión 1), el equipo discute las alternativas y elige **uno como definitivo**. Las alternativas no elegidas quedan **archivadas** y todos los entregables posteriores del programa se construyen únicamente sobre el proyecto definitivo. Las alternativas archivadas pueden desarchivarse posteriormente, pero solo con aprobación del profesor.

### 1.2 Características clave del sistema

- **Autenticación por cédula** validada contra una lista pre-cargada de participantes inscritos.
- **Lista de participantes pre-cargada** por el profesor desde un archivo Excel al inicio de cada cohorte.
- **Equipos formados por los participantes**: uno crea y agrega a sus compañeros desde la lista pre-cargada.
- **Fechas límite calculadas automáticamente** y entregadas desde el NAVES Scheduler.
- **Selección obligatoria del proyecto definitivo** después de la Reunión 1.
- **Catálogo de códigos CIIU** desplegable usando la clasificación oficial del DANE (CIIU Rev. 4 A.C. 2020).
- **Dos roles**: Participante y Profesor.
- **Formulario altamente dinámico**: se adapta en tiempo real (1 vs varios miembros, 1 vs varios proyectos).

### 1.3 Stack tecnológico recomendado

- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL (Neon)
- **Hosting backend:** Railway o Render
- **Hosting frontend:** Vercel
- **Autenticación:** JWT con expiración de 24 horas y refresh token
- **Hash de contraseñas:** bcrypt (cost factor 12)
- **Encriptación de PII:** AES-256
- **Procesamiento de Excel:** librería `xlsx` o `exceljs`
- **Selector CIIU:** componente con búsqueda (autocompletado por código o por descripción de actividad)

---

## 2. Modelo de autenticación y autorización

### 2.1 Flujo de carga de participantes (acción del profesor)

1. El profesor accede al panel administrativo.
2. Sube un archivo Excel con la lista de participantes de una cohorte.
3. El sistema valida el formato y carga los registros en `participantes_lista`.
4. Cada participante queda en estado `pendiente_activacion`.

**Formato esperado del Excel:**

| Columna | Obligatorio | Validación |
|---|---|---|
| `nombre_completo` | Sí | Texto, máx 150 chars |
| `cedula` | Sí | Solo dígitos, 6-20 chars, única dentro de la cohorte |
| `email` | Sí | Formato email válido |
| `cohorte` | Sí | Debe existir en catálogo de cohortes |

### 2.2 Flujo de primer acceso de un participante

1. Ingresa su **cédula**.
2. Si está en la lista y en estado `pendiente_activacion`, se le pide crear una clave (mínimo 8 chars, una mayúscula, una minúscula y un número).
3. El participante queda en estado `activo`.

### 2.3 Flujo de login posterior

1. Cédula + clave.
2. El sistema devuelve un JWT con: `sub`, `rol`, `cohorte`, `equipo_id`, `iat`, `exp`.

### 2.4 Profesores

- Login con email + clave.
- Gestionados manualmente desde panel admin.
- Inicialmente 3 profesores; el sistema permite agregar más sin límite.
- Pueden ver todos los anteproyectos sin restricción.

### 2.5 Permisos

| Acción | Participante | Profesor |
|---|---|---|
| Crear/unirse a un equipo | Sí (hasta fecha límite) | No |
| Cambiar de equipo | Sí (hasta fecha límite) | No |
| Editar anteproyecto del equipo | Sí (hasta fecha límite entrega) | No |
| Marcar "tuve Reunión 1" | Sí | No |
| Seleccionar proyecto definitivo | Sí (después de marcar Reunión 1) | No |
| Aprobar desarchivado de un proyecto | No | Sí |
| Ver todos los anteproyectos | No | Sí |
| Cargar lista de participantes | No | Sí (admin) |
| Cargar fechas del Scheduler | No | Sí (admin) |
| Crear otros profesores | No | Sí (admin) |

---

## 3. Estructura del formulario

### Sección 1: Información del equipo emprendedor
- Selector inicial: cantidad de miembros (1, 2, 3).
- Por cada miembro: datos personales + perfil emprendedor (5 preguntas individuales).
- Programa MBA (pre-llenado con la cohorte del usuario logueado).
- Rango de fechas del programa (calculado automáticamente).

### Sección 2: Tus proyectos
- Texto informativo dinámico (singular/plural).
- Selector: cantidad de proyectos (1, 2, 3).
- Pestañas dinámicas (1 por proyecto). Cada pestaña contiene:
  - Datos identificativos (nombre, tipo, sector, CIIU desplegable).
  - Canvas del negocio (8 preguntas con lenguaje dinámico).
  - Estado del proyecto.
  - Validación del mercado.
  - Cronograma del proyecto.

### Sección 3: Selección del proyecto definitivo (NUEVA)

Esta sección **solo aparece** si el equipo entregó 2 o 3 proyectos. Tiene dos sub-pasos:

**Sub-paso A: Marcar Reunión 1**
- Botón/checkbox: "Confirmo que ya tuve la Reunión 1 con el profesor".
- Al marcarlo, se habilita el sub-paso B.
- Solo se puede marcar después de la fecha de Reunión 1 establecida en `cohortes.fecha_reunion_1`.

**Sub-paso B: Selección obligatoria del proyecto definitivo**
- Una vez marcada la Reunión 1, el sistema **obliga** a los participantes a elegir el proyecto definitivo antes de poder hacer cualquier otra acción.
- Selector con los 2-3 proyectos del equipo.
- Confirmación: "¿Está seguro? Los proyectos no elegidos quedarán archivados y solo podrán desarchivarse con aprobación del profesor."
- Al confirmar:
  - El proyecto elegido pasa a estado `definitivo` y queda **congelado** (no editable).
  - Los proyectos no elegidos pasan a estado `archivado`.

**Caso especial:** si el equipo entregó solo 1 proyecto, ese se marca automáticamente como `definitivo` al momento del envío del anteproyecto. No requiere selección posterior.

---

## 4. Modelo de datos

### 4.1 Diagrama entidad-relación

```
Cohorte (1) ──── (N) ParticipanteLista
ParticipanteLista (1) ──── (0..1) Equipo (como creador)
Equipo (1) ──── (1..3) MiembroEquipo ──── (1) ParticipanteLista
Equipo (1) ──── (1) Anteproyecto
Anteproyecto (1) ──── (1..3) Proyecto
Proyecto (1) ──── (5..10) Hito
CodigoCIIU (catálogo independiente)
Profesor (independiente)
```

### 4.2 Esquema PostgreSQL

```sql
-- =====================================================
-- TABLA: COHORTES
-- =====================================================
CREATE TABLE cohortes (
    id VARCHAR(20) PRIMARY KEY,
    etiqueta VARCHAR(50) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    -- Fechas que vienen del NAVES Scheduler
    fecha_limite_formacion_equipos TIMESTAMP WITH TIME ZONE,
    fecha_limite_entrega_anteproyecto TIMESTAMP WITH TIME ZONE,
    fecha_reunion_1 TIMESTAMP WITH TIME ZONE,
    fecha_limite_seleccion_definitivo TIMESTAMP WITH TIME ZONE,
    activa BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- TABLA: CÓDIGOS CIIU (catálogo)
-- =====================================================
CREATE TABLE codigos_ciiu (
    codigo VARCHAR(4) PRIMARY KEY,              -- '6201', '5611', etc.
    descripcion VARCHAR(500) NOT NULL,
    seccion CHAR(1) NOT NULL,                   -- 'A', 'B', ..., 'U' (21 secciones)
    division VARCHAR(2) NOT NULL,
    grupo VARCHAR(3) NOT NULL,
    activo BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_ciiu_descripcion ON codigos_ciiu USING gin(to_tsvector('spanish', descripcion));
CREATE INDEX idx_ciiu_seccion ON codigos_ciiu(seccion);

-- =====================================================
-- TABLA: PARTICIPANTES (lista pre-cargada)
-- =====================================================
CREATE TABLE participantes_lista (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id),

    nombre_completo VARCHAR(150) NOT NULL,
    cedula_encriptada TEXT NOT NULL,
    cedula_hash VARCHAR(64) NOT NULL,
    email_encriptado TEXT NOT NULL,
    email_hash VARCHAR(64) NOT NULL,

    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente_activacion',
        -- 'pendiente_activacion' | 'activo' | 'desactivado'
    clave_hash TEXT,
    fecha_activacion TIMESTAMP WITH TIME ZONE,
    ultimo_login TIMESTAMP WITH TIME ZONE,

    celular_encriptado TEXT,

    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(cohorte_id, cedula_hash),
    UNIQUE(cohorte_id, email_hash)
);

CREATE INDEX idx_part_lista_cedula_hash ON participantes_lista(cedula_hash);
CREATE INDEX idx_part_lista_estado ON participantes_lista(estado);
CREATE INDEX idx_part_lista_cohorte ON participantes_lista(cohorte_id);

-- =====================================================
-- TABLA: PROFESORES
-- =====================================================
CREATE TABLE profesores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_completo VARCHAR(150) NOT NULL,
    email_encriptado TEXT NOT NULL,
    email_hash VARCHAR(64) NOT NULL UNIQUE,
    clave_hash TEXT NOT NULL,
    es_admin BOOLEAN DEFAULT FALSE,
    activo BOOLEAN DEFAULT TRUE,
    ultimo_login TIMESTAMP WITH TIME ZONE,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- TABLA: EQUIPOS
-- =====================================================
CREATE TABLE equipos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohorte_id VARCHAR(20) NOT NULL REFERENCES cohortes(id),
    creador_id UUID NOT NULL REFERENCES participantes_lista(id),
    nombre_equipo VARCHAR(100),

    -- Trazabilidad de la Reunión 1 y selección del definitivo
    reunion_1_marcada_por UUID REFERENCES participantes_lista(id),
    reunion_1_fecha_marcado TIMESTAMP WITH TIME ZONE,
    proyecto_definitivo_id UUID,                -- FK a proyectos.id (se llena al elegir)
    fecha_seleccion_definitivo TIMESTAMP WITH TIME ZONE,

    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_equipos_cohorte ON equipos(cohorte_id);

-- =====================================================
-- TABLA: MIEMBROS DEL EQUIPO
-- =====================================================
CREATE TABLE miembros_equipo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id UUID NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    participante_id UUID NOT NULL REFERENCES participantes_lista(id),
    posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 3),

    fue_emprendedor BOOLEAN,
    quiebra VARCHAR(10),
    aprendizajes_quiebra TEXT,
    perfil VARCHAR(20),

    fecha_union TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(equipo_id, posicion),
    UNIQUE(equipo_id, participante_id),
    UNIQUE(participante_id)
);

-- =====================================================
-- TABLAS: EMOCIONES Y PREOCUPACIONES
-- =====================================================
CREATE TABLE miembro_emociones (
    miembro_id UUID NOT NULL REFERENCES miembros_equipo(id) ON DELETE CASCADE,
    emocion VARCHAR(20) NOT NULL CHECK (emocion IN ('crear', 'dinero', 'problema', 'autonomia')),
    PRIMARY KEY (miembro_id, emocion)
);

CREATE TABLE miembro_preocupaciones (
    miembro_id UUID NOT NULL REFERENCES miembros_equipo(id) ON DELETE CASCADE,
    preocupacion VARCHAR(20) NOT NULL CHECK (preocupacion IN ('financiera', 'estres', 'habilidades', 'familia')),
    PRIMARY KEY (miembro_id, preocupacion)
);

-- =====================================================
-- TABLA: ANTEPROYECTOS
-- =====================================================
CREATE TABLE anteproyectos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id UUID NOT NULL UNIQUE REFERENCES equipos(id) ON DELETE CASCADE,

    estado VARCHAR(20) NOT NULL DEFAULT 'borrador',
        -- 'borrador' | 'enviado' | 'revisado' | 'aprobado'

    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_envio TIMESTAMP WITH TIME ZONE,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ultimo_editor_id UUID REFERENCES participantes_lista(id)
);

-- =====================================================
-- TABLA: PROYECTOS
-- =====================================================
CREATE TABLE proyectos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anteproyecto_id UUID NOT NULL REFERENCES anteproyectos(id) ON DELETE CASCADE,
    posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 3),

    -- Estado del proyecto en el flujo de selección
    estado_seleccion VARCHAR(20) NOT NULL DEFAULT 'pendiente_seleccion',
        -- 'pendiente_seleccion' | 'definitivo' | 'archivado'
    fecha_archivado TIMESTAMP WITH TIME ZONE,
    desarchivado BOOLEAN DEFAULT FALSE,
    fecha_desarchivado TIMESTAMP WITH TIME ZONE,
    desarchivado_aprobado_por UUID REFERENCES profesores(id),

    -- Identificación
    nombre VARCHAR(150) NOT NULL,
    tipo VARCHAR(30) CHECK (tipo IN ('emprendimiento', 'intraemprendimiento')),
    sector VARCHAR(100),
    ciiu VARCHAR(4) REFERENCES codigos_ciiu(codigo),

    -- Canvas del negocio
    canvas_cliente_problema TEXT,
    canvas_canales TEXT,
    canvas_relaciones TEXT,
    canvas_ingresos TEXT,
    canvas_recursos TEXT,
    canvas_actividades TEXT,
    canvas_socios TEXT,
    canvas_costos TEXT,

    -- Estado del proyecto (madurez)
    estado VARCHAR(20) CHECK (estado IN ('idea', 'investigacion', 'prototipo', 'validacion')),

    -- Validación del mercado
    fuentes_primarias TEXT,
    fuentes_secundarias TEXT,

    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(anteproyecto_id, posicion)
);

-- Foreign key circular para proyecto_definitivo_id
ALTER TABLE equipos ADD CONSTRAINT fk_proyecto_definitivo
    FOREIGN KEY (proyecto_definitivo_id) REFERENCES proyectos(id);

CREATE INDEX idx_proyectos_anteproyecto ON proyectos(anteproyecto_id);
CREATE INDEX idx_proyectos_estado_seleccion ON proyectos(estado_seleccion);

-- =====================================================
-- TABLA: HITOS
-- =====================================================
CREATE TABLE hitos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proyecto_id UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    posicion INTEGER NOT NULL,

    descripcion VARCHAR(100) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,

    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CHECK (fecha_fin >= fecha_inicio),
    UNIQUE(proyecto_id, posicion)
);

-- =====================================================
-- TABLA: SOLICITUDES DE DESARCHIVADO
-- =====================================================
CREATE TABLE solicitudes_desarchivado (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proyecto_id UUID NOT NULL REFERENCES proyectos(id),
    solicitante_id UUID NOT NULL REFERENCES participantes_lista(id),
    motivo TEXT NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        -- 'pendiente' | 'aprobada' | 'rechazada'
    profesor_id UUID REFERENCES profesores(id),
    respuesta_profesor TEXT,
    fecha_solicitud TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_respuesta TIMESTAMP WITH TIME ZONE
);

-- =====================================================
-- TABLA: HISTORIAL DE EQUIPOS
-- =====================================================
CREATE TABLE historial_equipos (
    id BIGSERIAL PRIMARY KEY,
    participante_id UUID NOT NULL REFERENCES participantes_lista(id),
    equipo_anterior_id UUID REFERENCES equipos(id),
    equipo_nuevo_id UUID REFERENCES equipos(id),
    fecha_cambio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    motivo TEXT
);

-- =====================================================
-- TABLA: AUDITORÍA
-- =====================================================
CREATE TABLE auditoria (
    id BIGSERIAL PRIMARY KEY,
    actor_tipo VARCHAR(20) NOT NULL,
    actor_id UUID,
    accion VARCHAR(50) NOT NULL,
    entidad_tipo VARCHAR(50),
    entidad_id UUID,
    detalles JSONB,
    ip INET,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 4.3 Catálogos de valores

#### Cohortes (cargadas en tabla `cohortes`)

| ID | Etiqueta | Inicio | Fin |
|---|---|---|---|
| `int-24-26` | MBA INT 24-26 | 13-01-2024 | 07-04-2024 |
| `fs-24-26` | MBA FS 24-26 | 18-01-2024 | 10-05-2024 |
| `int-26-28` | MBA INT 26-28 | 12-01-2026 | 06-04-2026 |
| `fs-26-28` | MBA FS 26-28 | 17-01-2026 | 09-05-2026 |
| `int-27-29` | MBA INT 27-29 | (por definir) | (por definir) |
| `fs-27-29` | MBA FS 27-29 | (por definir) | (por definir) |
| `int-28-30` | MBA INT 28-30 | 11-01-2028 | 05-04-2028 |
| `fs-28-30` | MBA FS 28-30 | 16-01-2028 | 08-05-2028 |

**Nomenclatura:** todas las cohortes mantienen el formato `INT` (Intensivo) o `FS` (Fines de Semana) seguido del rango de años en formato `YY-YY`. Cuando se definan las fechas exactas de las cohortes 27-29, deben actualizarse tanto en la base de datos (`cohortes`) como en el frontend (`anteproyecto.html`).

#### Códigos CIIU

- **Estándar:** Clasificación Industrial Internacional Uniforme Revisión 4 Adaptada para Colombia (CIIU Rev. 4 A.C. 2020).
- **Fuente oficial:** DANE — `https://www.dane.gov.co/index.php/sistema-estadistico-nacional-sen/normas-y-estandares/nomenclaturas-y-clasificaciones/clasificaciones/clasificacion-industrial-internacional-uniforme-de-todas-las-actividades-economicas-ciiu`
- **Estructura:** 21 secciones (A-U), aproximadamente 419 clases de 4 dígitos.
- **Carga inicial:** descargar el Excel oficial del DANE y poblar la tabla `codigos_ciiu` mediante un script de seed.
- **Documento de referencia:** `CIIU_Rev_4_AC2020.pdf` (DANE).
- **Resolución vigente:** Resolución DIAN 000114 de 2020 que adopta la clasificación.

#### Catálogos de selección única

- **Quiebra:** `si`, `no`, `na`
- **Perfil:** `emprendedor`, `directivo`, `ambos`
- **Tipo de proyecto:** `emprendimiento`, `intraemprendimiento`
- **Estado del proyecto (madurez):** `idea`, `investigacion`, `prototipo`, `validacion`
- **Estado del anteproyecto:** `borrador`, `enviado`, `revisado`, `aprobado`
- **Estado del participante:** `pendiente_activacion`, `activo`, `desactivado`
- **Estado de selección del proyecto:** `pendiente_seleccion`, `definitivo`, `archivado`
- **Estado de solicitud de desarchivado:** `pendiente`, `aprobada`, `rechazada`

#### Catálogos de selección múltiple

- **Emociones:** `crear`, `dinero`, `problema`, `autonomia`
- **Preocupaciones:** `financiera`, `estres`, `habilidades`, `familia`

---

## 5. Endpoints REST

### 5.1 Autenticación

#### POST /api/auth/verificar-cedula
Verifica si una cédula está en la lista pre-cargada.

#### POST /api/auth/crear-clave
Establece la clave por primera vez.

#### POST /api/auth/login
Login con cédula + clave.

#### POST /api/auth/login-profesor
Login de profesores con email + clave.

#### POST /api/auth/refresh
Renueva el JWT.

#### POST /api/auth/logout
Invalida los tokens.

### 5.2 Códigos CIIU

#### GET /api/ciiu/buscar?q=software
Busca códigos CIIU por descripción o código (texto completo en español).

**Response 200:**
```json
[
  { "codigo": "6201", "descripcion": "Actividades de desarrollo de sistemas informáticos (planificación, análisis, diseño, programación, pruebas)" },
  { "codigo": "6202", "descripcion": "Actividades de consultoría informática y actividades de administración de instalaciones informáticas" }
]
```

#### GET /api/ciiu/listar?seccion=J
Lista códigos CIIU filtrados por sección.

#### GET /api/ciiu/:codigo
Obtiene un código CIIU específico con su descripción completa.

### 5.3 Equipos

#### POST /api/equipos
Crea un equipo. El creador queda como miembro 1.

**Validaciones:**
- El creador no puede estar en otro equipo.
- Los miembros deben ser de la misma cohorte.
- Solo hasta `cohortes.fecha_limite_formacion_equipos`.

#### GET /api/equipos/mi-equipo
Devuelve el equipo del participante autenticado.

#### POST /api/equipos/:id/agregar-miembro
Agrega un miembro al equipo.

#### POST /api/equipos/:id/remover-miembro
Remueve un miembro del equipo.

#### POST /api/equipos/cambiar-de-equipo
Permite cambiar de equipo (hasta fecha límite).

#### GET /api/participantes/buscar?cohorte=...&query=...
Busca participantes disponibles (no asignados a un equipo) en la cohorte.

### 5.4 Anteproyecto

#### GET /api/anteproyectos/mi-anteproyecto
Devuelve el anteproyecto del equipo del participante autenticado.

#### PUT /api/anteproyectos/:id
Actualiza el anteproyecto (guardar borrador o enviar).

**Validaciones críticas:**
- Usuario debe ser miembro del equipo.
- Si fecha actual > `cohortes.fecha_limite_entrega_anteproyecto`: rechazar (HTTP 403).
- Si algún proyecto del equipo ya está en estado `definitivo` o `archivado`: rechazar edición de ese proyecto (está congelado).

#### POST /api/anteproyectos/:id/enviar
Cambia estado de `borrador` a `enviado`.

**Lógica especial:**
- Si `numero_proyectos === 1`: el único proyecto se marca automáticamente como `definitivo`.
- Si `numero_proyectos > 1`: todos los proyectos quedan en estado `pendiente_seleccion`.

### 5.5 Selección de proyecto definitivo

#### POST /api/equipos/:id/marcar-reunion-1
El participante marca que ya tuvo la Reunión 1 con el profesor.

**Request:** vacío.

**Validaciones:**
- El usuario debe ser miembro del equipo.
- La fecha actual debe ser `>= cohortes.fecha_reunion_1`.
- El equipo no puede haber marcado ya la Reunión 1.
- Solo aplica si el equipo tiene 2 o 3 proyectos.

**Response 200:**
```json
{
  "reunion_1_marcada": true,
  "fecha_marcado": "2026-02-20T15:30:00Z",
  "marcado_por": "Juan Pérez",
  "siguiente_paso": "seleccionar_proyecto_definitivo",
  "fecha_limite_seleccion": "2026-02-25T23:59:59Z"
}
```

**Efecto:** después de esta acción, el frontend debe forzar al participante a la pantalla de selección del proyecto definitivo. Ninguna otra funcionalidad debe estar disponible hasta que se seleccione.

#### POST /api/equipos/:id/seleccionar-proyecto-definitivo
Selecciona el proyecto definitivo del equipo.

**Request:**
```json
{ "proyecto_id": "uuid-del-proyecto-elegido" }
```

**Validaciones:**
- El equipo debe haber marcado la Reunión 1.
- `proyecto_id` debe pertenecer al anteproyecto del equipo.
- No debe haberse seleccionado ya un definitivo.
- La fecha actual debe ser `<= cohortes.fecha_limite_seleccion_definitivo`.

**Efecto en BD:**
1. El proyecto elegido pasa a `estado_seleccion = 'definitivo'`.
2. Los demás proyectos del anteproyecto pasan a `estado_seleccion = 'archivado'` con `fecha_archivado = NOW()`.
3. Se actualiza `equipos.proyecto_definitivo_id` y `equipos.fecha_seleccion_definitivo`.

#### POST /api/proyectos/:id/solicitar-desarchivar
Un participante solicita desarchivar un proyecto. Requiere aprobación del profesor.

**Request:**
```json
{ "motivo": "Después de discutirlo con el equipo, queremos retomar este proyecto porque..." }
```

**Response 201:**
```json
{
  "solicitud_id": "uuid",
  "estado": "pendiente",
  "mensaje": "Tu solicitud fue enviada al profesor. Recibirás una respuesta por email."
}
```

#### POST /api/admin/solicitudes-desarchivado/:id/aprobar
El profesor aprueba la solicitud de desarchivado.

**Request:**
```json
{ "respuesta": "Aprobado. Pueden retomar este proyecto como nueva alternativa." }
```

**Efecto:** el proyecto vuelve a estar disponible. El equipo debe pasar nuevamente por el flujo de selección.

#### POST /api/admin/solicitudes-desarchivado/:id/rechazar
El profesor rechaza la solicitud.

### 5.6 Profesores (admin)

#### GET /api/admin/anteproyectos
Lista todos los anteproyectos con filtros.

#### GET /api/admin/anteproyectos/:id
Detalle de un anteproyecto específico.

#### POST /api/admin/participantes/cargar-excel
Sube el Excel con la lista de participantes.

#### POST /api/admin/cohortes/:id/actualizar-fechas
Actualiza fechas límite del NAVES Scheduler.

**Request:**
```json
{
  "fecha_limite_formacion_equipos": "2026-02-15T23:59:59Z",
  "fecha_limite_entrega_anteproyecto": "2026-02-18T23:59:59Z",
  "fecha_reunion_1": "2026-02-20T08:00:00Z",
  "fecha_limite_seleccion_definitivo": "2026-02-25T23:59:59Z"
}
```

#### POST /api/admin/profesores
Crea un nuevo profesor (solo admin).

#### POST /api/admin/ciiu/cargar-catalogo
Carga el catálogo CIIU desde el archivo Excel oficial del DANE (acción única al setup inicial).

---

## 6. Estructura JSON del payload del anteproyecto

### 6.1 Payload al guardar/enviar

```json
{
  "estado": "enviado",
  "numero_miembros": 2,
  "numero_proyectos": 2,
  "miembros": [
    {
      "participante_id": "uuid-juan",
      "posicion": 1,
      "celular": "+573001234567",
      "fue_emprendedor": true,
      "quiebra": "no",
      "aprendizajes_quiebra": "Aprendí la importancia del flujo de caja.",
      "perfil": "emprendedor",
      "emociones": ["crear", "problema"],
      "preocupaciones": ["financiera"]
    }
  ],
  "proyectos": [
    {
      "posicion": 1,
      "nombre": "T-Health",
      "tipo": "emprendimiento",
      "sector": "Salud digital",
      "ciiu": "8620",
      "canvas_cliente_problema": "...",
      "canvas_canales": "...",
      "canvas_relaciones": "...",
      "canvas_ingresos": "...",
      "canvas_recursos": "...",
      "canvas_actividades": "...",
      "canvas_socios": "...",
      "canvas_costos": "...",
      "estado": "prototipo",
      "fuentes_primarias": "...",
      "fuentes_secundarias": "...",
      "hitos": [
        { "posicion": 1, "descripcion": "Validación", "fecha_inicio": "2026-02-01", "fecha_fin": "2026-03-15" }
      ]
    }
  ]
}
```

### 6.2 Notas importantes

- Los datos personales (nombre, cédula, email) NO van en el payload (vienen de `participantes_lista`).
- El celular SÍ va (no estaba en la lista pre-cargada).
- `numero_miembros` debe coincidir con la cantidad de elementos en `miembros[]`.
- `numero_proyectos` debe coincidir con `proyectos[]`.
- `ciiu` debe ser un código de 4 dígitos válido en `codigos_ciiu`.

---

## 7. Lógica dinámica del frontend

### 7.1 Adaptación singular/plural

El frontend reescribe los textos cuando cambia el número de miembros (1 → singular, 2+ → plural). Es solo cosmético.

### 7.2 Sección condicional de quiebra

Solo aparece si `fue_emprendedor === true`. Si es `false`, el backend ignora `quiebra` y `aprendizajes_quiebra`.

### 7.3 Selector CIIU desplegable

El frontend debe implementar un componente de búsqueda con autocompletado:
- Busca por código (ej: "6201") o por descripción (ej: "software", "restaurante", "consultoría").
- Llama al endpoint `GET /api/ciiu/buscar?q=...`.
- Muestra los resultados en un dropdown.
- Al seleccionar, guarda solo el código de 4 dígitos en el formulario.

### 7.4 Flujo de selección del proyecto definitivo

Después de que el equipo envía el anteproyecto con 2-3 proyectos:

1. El frontend muestra el dashboard del equipo con el anteproyecto enviado.
2. Cuando llega la fecha de Reunión 1, aparece un banner: "¿Ya tuviste la Reunión 1 con el profesor?"
3. Al hacer clic en "Sí, ya tuve la reunión 1", se llama al endpoint `marcar-reunion-1`.
4. El frontend bloquea toda la navegación y muestra solo la pantalla de selección.
5. El participante elige uno de los proyectos.
6. Confirmación con advertencia clara.
7. Al confirmar, los demás proyectos pasan a archivados.

---

## 8. Validaciones del backend

### 8.1 Validaciones del payload

| Campo | Regla |
|---|---|
| `numero_miembros` | 1-3, coincide con `miembros.length` |
| `numero_proyectos` | 1-3, coincide con `proyectos.length` |
| `miembros[].participante_id` | Debe existir en `participantes_lista`, misma cohorte que el equipo |
| `miembros[].celular` | Formato `+<código_país><número>`, máx 20 chars |
| `miembros[].fue_emprendedor` | Booleano |
| `miembros[].quiebra` | Si `fue_emprendedor=true`, requerido y en catálogo |
| `miembros[].aprendizajes_quiebra` | Si `fue_emprendedor=true`, máx 300 chars |
| `miembros[].perfil` | En catálogo |
| `miembros[].emociones` | Array no vacío con valores del catálogo |
| `miembros[].preocupaciones` | Array no vacío con valores del catálogo |
| `proyectos[].nombre` | Máx 150 chars |
| `proyectos[].ciiu` | Código de 4 dígitos válido en `codigos_ciiu` |
| `proyectos[].canvas_cliente_problema` | Máx 500 chars |
| `proyectos[].canvas_*` (resto) | Máx 300 chars |
| `proyectos[].fuentes_*` | Máx 300 chars |
| `proyectos[].hitos` | 5-10 elementos si `estado === 'enviado'` |
| `proyectos[].hitos[].fecha_fin` | `>= fecha_inicio` |

### 8.2 Validaciones críticas de fechas

```javascript
// Pseudocódigo
function puedeFormarEquipo(participante) {
  return new Date() < participante.cohorte.fecha_limite_formacion_equipos;
}

function puedeEditarAnteproyecto(participante) {
  return new Date() < participante.cohorte.fecha_limite_entrega_anteproyecto;
}

function puedeMarcarReunion1(participante) {
  const ahora = new Date();
  return ahora >= participante.cohorte.fecha_reunion_1
      && ahora <= participante.cohorte.fecha_limite_seleccion_definitivo;
}

function puedeEditarProyecto(proyecto) {
  return proyecto.estado_seleccion !== 'definitivo'
      && proyecto.estado_seleccion !== 'archivado';
}
```

Si la fecha actual ya pasó el límite, devolver HTTP 403:
```json
{
  "error": "FECHA_LIMITE_EXPIRADA",
  "mensaje": "La fecha límite para editar el anteproyecto fue el 30 de abril de 2026.",
  "fecha_limite": "2026-04-30T23:59:59Z"
}
```

### 8.3 Sanitización

- Eliminar etiquetas HTML del input (XSS).
- Trim y colapsar espacios.
- Para celulares: eliminar espacios, guiones, paréntesis.
- Para cédulas: eliminar puntos, espacios y guiones.
- Para CIIU: validar que sean exactamente 4 dígitos numéricos y existan en `codigos_ciiu`.

---

## 9. Seguridad y privacidad

### 9.1 Datos sensibles (PII)

Encriptar con AES-256:
- `participantes_lista.cedula`, `email`, `celular`
- `profesores.email`

Hash SHA-256:
- `participantes_lista.cedula_hash`, `email_hash`
- `profesores.email_hash`

Hash bcrypt (cost factor 12):
- `participantes_lista.clave_hash`
- `profesores.clave_hash`

### 9.2 Auditoría

Toda acción significativa registrada:
- Login (exitoso o fallido)
- Creación de equipo
- Cambio de equipo
- Edición de anteproyecto
- Envío de anteproyecto
- Marcado de Reunión 1
- Selección de proyecto definitivo
- Solicitud de desarchivado
- Aprobación/rechazo de profesor
- Carga de Excel
- Acceso de profesor a anteproyectos

### 9.3 Rate limiting

- POST `/api/auth/verificar-cedula`: 10/h por IP.
- POST `/api/auth/login`: 5 intentos fallidos por cédula → bloqueo 15 min.
- POST `/api/anteproyectos/*`: 60/h por usuario.
- GET `/api/ciiu/buscar`: 100/h por usuario (es una búsqueda frecuente).

### 9.4 CORS

Aceptar solo desde dominio de producción (Vercel) y staging. Para desarrollo, permitir `localhost:3000` y `localhost:5173`.

---

## 10. Notas finales para el ingeniero backend

1. **NAVES Scheduler:** Las fechas límite vienen del NAVES Scheduler. En el futuro será reemplazado por algoritmos estructurales en el backend, pero por ahora el endpoint `/api/admin/cohortes/:id/actualizar-fechas` permite cargar las fechas calculadas externamente.

2. **Carga inicial del catálogo CIIU:** Crear un script `seed_ciiu.js` que descargue el Excel oficial del DANE (CIIU Rev. 4 A.C. 2020), lo parsee y pueble la tabla `codigos_ciiu`. Esto se ejecuta una sola vez al setup inicial del sistema. Considerar actualizar cada 1-2 años conforme el DANE publique nuevas resoluciones.

3. **Guardado automático:** Implementar guardado automático del borrador cada 30 segundos.

4. **Notificaciones por email:**
   - Participante agregado a equipo.
   - Anteproyecto enviado (a todos los miembros).
   - Solicitud de desarchivado al profesor.
   - Respuesta del profesor a solicitud de desarchivado.
   - Recordatorios antes de fechas límite.

5. **Recuperación de clave:** Código enviado al email institucional cargado en la lista.

6. **Bloqueo de cuenta:** 5 intentos fallidos → 15 min. 10 intentos en 24h → bloqueo permanente.

7. **Versionado de anteproyectos:** Considerar snapshots inmutables al envío.

8. **Exportación:** Profesores deben poder exportar anteproyectos a PDF/Word.

9. **MVP — alcance actual:** El sistema gestiona el ciclo completo del anteproyecto y la selección del proyecto definitivo. Los entregables posteriores del programa (avances, validación, plan financiero, presentación final) se construirán sobre el proyecto definitivo en futuras versiones del sistema, pero no son parte de este MVP.

---

**Fin del documento**
