# Skill: Generador de Sitio Web NAVES

## Descripción

Esta skill genera un sitio web HTML completo y autónomo para una cohorte específica del programa NAVES (Executive MBA de INALDE Business School). A partir de las 7 fechas clave del cronograma, los datos de la cohorte y las credenciales de seguridad, produce un archivo `index.html` listo para publicar en Netlify u otro hosting estático.

El sitio resultante incluye:
- Diseño completo con identidad visual de INALDE (colores, tipografías, logos)
- Línea de tiempo con los 8 hitos principales
- Sección de preguntas frecuentes con 33 preguntas en 6 categorías
- Formulario de contacto conectado a Web3Forms
- Sistema de acceso protegido con clave (hash SHA-256)
- Protección anti-spam (honeypot invisible + hCaptcha)
- Diseño responsive (funciona en celular y desktop)

## Cuándo usar esta skill

Usar cuando se necesite:
- Generar el sitio web para una nueva cohorte NAVES
- Actualizar el sitio con fechas corregidas
- Crear una versión del sitio para otra modalidad (Intensivo ↔ Fin de Semana)

## Relación con otras skills

Esta skill **NO depende** de ninguna otra skill. Está diseñada para ser autónoma y simple.

**Flujo típico recomendado:**
1. Primero correr la skill `Programación NAVES` → genera el cronograma de 13 hitos
2. Luego correr esta skill con las 7 fechas relevantes del cronograma anterior

Pero también funciona sola si el usuario tiene las fechas a mano.

## Inputs requeridos

### Datos de la cohorte

| Input | Descripción | Ejemplo |
|-------|-------------|---------|
| Modalidad | "Intensivo" o "Fin de Semana" | "Intensivo" |
| Años de cohorte | Rango de años | "2024 — 2026" |
| Año de NAVES | Año en que se hace el trabajo de grado | "2026" |

### Las 8 fechas del cronograma

Estas fechas corresponden a los 8 hitos del sitio público. Se pueden mapear desde los 13 hitos de la skill `Programación NAVES`:

| # | Hito del sitio | Mapeo desde Skill 1 | Formato esperado |
|---|----------------|---------------------|------------------|
| 1 | Lanzamiento | Hito 1 (Kick Off) | Fecha única o rango corto |
| 2 | Entrega del anteproyecto | Hito 2 | Fecha única |
| 3 | Ventana Reunión 1 | Hito 4 INICIO → Hito 5 CIERRE | Rango de fechas |
| 4 | Ventana Reunión 2 | Hito 7 INICIO → Hito 8 CIERRE | Rango de fechas |
| 5 | Reunión 60 días antes | Hito 9 | Fecha única |
| 6 | Entrega final | Hito 10 | Fecha única |
| 7 | Reunión preparación presentación | Hito 11 | Fecha única |
| 8 | Presentaciones | Hito 12 + Hito 13 | Rango de 2 días |

### Credenciales de seguridad

| Input | Descripción | Ejemplo |
|-------|-------------|---------|
| Clave de acceso | Password que los participantes usarán para entrar al sitio | `Int2026NAVES` o `FS2026NAVES` |
| Clave Web3Forms | Access key del formulario de Web3Forms para esta cohorte | `1a9e51fd-2b8f-49b2-abc0-b992d3c6ca1a` |

**IMPORTANTE sobre Web3Forms:** Cada cohorte debe tener un formulario propio en Web3Forms para que los correos lleguen con asuntos distinguibles. El usuario debe crear el formulario ANTES de correr esta skill.

Para crear un formulario nuevo:
1. Entrar a https://web3forms.com/dashboard
2. Create new form → Nombrar "NAVES [Modalidad] [Año] - Preguntas"
3. Domain: `localhost` (puede cambiarse después)
4. Copiar la access key generada

## Outputs generados

1. **`index.html`** — Archivo HTML único y autónomo, listo para subir a Netlify. Todos los logos, estilos y scripts están embebidos o cargados desde CDN. Tamaño aproximado: 110 KB.

2. **Resumen de configuración** (mostrado al final) con:
   - URL sugerida para Netlify
   - Recordatorios de pasos post-generación

---

## Proceso de ejecución

### IMPORTANTE: Checkpoints obligatorios

Esta skill tiene **3 puntos de control** donde el agente debe detenerse y esperar confirmación del usuario antes de continuar. Nunca generar el output final sin haber pasado por los 3 checkpoints.

---

### Paso 1: Recolectar inputs

1. Preguntar al usuario por la modalidad ("Intensivo" o "Fin de Semana")
2. Preguntar por años de cohorte y año de NAVES
3. Recibir las 8 fechas del cronograma. El usuario puede pegarlas en cualquier formato:
   - Formato A: Tabla limpia con nombre de hito y fecha
   - Formato B: Copia y pega del Excel de la Skill 1 (13 hitos, Claude filtra)
   - Formato C: Dictadas sueltas en lenguaje natural
4. Preguntar por la clave de acceso que tendrá el sitio
5. Preguntar por la clave de Web3Forms (verificar que el usuario ya creó el formulario)

---

### ⏸️ CHECKPOINT 1: Confirmación de parámetros de la cohorte

**Detenerse y mostrar al usuario:**

```
Entendí los siguientes parámetros. Por favor confirme:

COHORTE
- Modalidad: [Intensivo / Fin de Semana]
- Cohorte: MBA [Modalidad] [Años] (ej: MBA Intensivo 2024 — 2026)
- Año NAVES: [Año]

FECHAS DEL CRONOGRAMA (8 hitos)
1. Lanzamiento: [fecha/rango]
2. Entrega del anteproyecto: [fecha]
3. Ventana Reunión 1: [rango]
4. Ventana Reunión 2: [rango]
5. Reunión 60 días antes: [fecha]
6. Entrega final: [fecha]
7. Reunión preparación presentación: [fecha]
8. Presentaciones: [rango de 2 días]

DURACIÓN CALCULADA
- Desde anteproyecto hasta entrega final: [X días] (≈ [Y meses], ≈ [Z semanas])

CREDENCIALES
- Clave de acceso al sitio: [clave en texto plano] (se guardará solo el hash SHA-256)
- Web3Forms access key: [primeros 8 caracteres]...

¿Son correctos estos parámetros?
- Si son correctos, responda "Sí" o "Correcto"
- Si hay errores, indique qué debo corregir
```

**Esperar respuesta del usuario antes de continuar.**

Si el usuario indica correcciones:
1. Aplicar las correcciones indicadas
2. Volver a mostrar el resumen corregido
3. Pedir confirmación nuevamente

---

### Paso 2: Preparar los valores de reemplazo

1. Calcular la duración:
   - Días entre anteproyecto y entrega final
   - Convertir a meses (dividir entre 30, redondear)
   - Convertir a semanas (dividir entre 7, redondear)

2. Formatear las fechas en los 4 formatos necesarios para el template:
   - **Formato corto** (para timeline y tarjetas): "14 Noviembre", "12 — 13 Mayo", etc.
   - **Formato completo** (para tarjetas resumen): "14 Noviembre 2026", "12 — 13 Mayo 2026"
   - **Formato largo** (para respuestas Q&A en prosa): "14 de noviembre de 2026", "del 28 de mayo al 26 de junio de 2026"
   - **Formato COHORTE_FULL** (header): "MBA Intensivo 2024 — 2026"
   - **Formato COHORTE_FULL_DOT** (hero): "MBA Intensivo · 2024 — 2026"
   - **Formato COHORTE_CORTA** (variables JS): "INT 2026" o "FS 2026"
   - **Formato COHORTE_CORTA_EJEMPLO** (Q&A portada): "MBA INT 2024-2026" o "MBA FS 2024-2026"

3. Generar el hash SHA-256 de la clave de acceso (usando Python hashlib)

4. Generar un SESSION_KEY único por cohorte para el localStorage:
   - Formato: `naves[modalidad_corta][año]_access_granted`
   - Ejemplo: `navesint2026_access_granted` o `navesfs2026_access_granted`

---

### ⏸️ CHECKPOINT 2: Confirmación de formatos de texto

**Detenerse y mostrar al usuario:**

```
Así se verán las fechas y textos en el sitio. Revise si están bien redactadas:

EN EL HEADER (barra superior):
  "[COHORTE_FULL]"
  Ejemplo: "MBA Intensivo 2024 — 2026"

EN EL HERO (sección principal):
  "[COHORTE_FULL_DOT]"
  Ejemplo: "MBA Intensivo · 2024 — 2026"

EN LA LÍNEA DE TIEMPO (fechas cortas):
  1. Lanzamiento: "[FECHA_LANZAMIENTO]"
  2. Anteproyecto: "[FECHA_ANTEPROYECTO]"
  3. Ventana R1: "[FECHA_VENTANA_R1]"
  4. Ventana R2: "[FECHA_VENTANA_R2]"
  5. 60 días antes: "[FECHA_60_DIAS]"
  6. Entrega final: "[FECHA_ENTREGA_FINAL]"
  7. Reunión preparación: "[FECHA_REUNION_PREP]"
  8. Presentaciones: "[FECHA_PRESENTACIONES]"

EN LAS RESPUESTAS Q&A (redacción formal):
  "El proceso va desde [FECHA_ANTEPROYECTO_LARGA] hasta [FECHA_ENTREGA_FINAL_LARGA],
   aproximadamente [DURACION_MESES] meses (unas [DURACION_SEMANAS] semanas)."
   
  "La entrega final es el [FECHA_ENTREGA_FINAL_LARGA], antes de las 7:59 AM."
  
  "Reunión 1 — en la ventana [FECHA_VENTANA_R1_LARGA]."
  "Reunión 2 — en la ventana [FECHA_VENTANA_R2_LARGA]."
  
  "Las presentaciones serán los días [FECHA_PRESENTACIONES_LARGA]."

¿Están bien redactadas? ¿Prefiere algún cambio en los formatos?
- Si están bien, responda "Correcto" para proseguir
- Si quiere ajustes, indique cuál
```

**Esperar respuesta del usuario antes de continuar.**

---

### Paso 3: Generar el HTML

1. Leer el archivo `template/template.html`
2. Reemplazar TODOS los placeholders con los valores preparados
3. Verificar que no quede ningún placeholder sin reemplazar (búsqueda de `{{...}}`)
4. Guardar el resultado como `/mnt/user-data/outputs/index.html`

---

### ⏸️ CHECKPOINT 3: Confirmación final antes de entregar

**Detenerse y mostrar al usuario:**

```
He generado el sitio web para [COHORTE_FULL]. 

Antes de entregarlo, verifique estos detalles:

✓ Cohorte: [COHORTE_FULL]
✓ 8 fechas del timeline aplicadas
✓ Respuestas Q&A actualizadas con las nuevas fechas
✓ Clave de acceso protegida con hash SHA-256
✓ Formulario conectado a Web3Forms
✓ Sesión única por cohorte (session_key: [SESSION_KEY])

TAMAÑO: [X] KB
UBICACIÓN: /mnt/user-data/outputs/index.html

¿Procedo a entregarle el archivo?
```

**Esperar respuesta del usuario antes de continuar.**

---

### Paso 4: Entregar y dar instrucciones post-generación

1. Llamar a `present_files` con el `index.html` generado Y con el archivo `og-image-naves.png` (que es fijo y está en los archivos de la skill)

2. Mostrar al usuario las instrucciones de publicación:

```
✅ SITIO GENERADO CORRECTAMENTE

Para publicarlo en Netlify (5 minutos):

IMPORTANTE: debe subir DOS archivos, no uno:
- index.html (el sitio)
- og-image-naves.png (imagen de previsualización para WhatsApp/redes)

PRIMERA VEZ:
1. Descargue ambos archivos (index.html + og-image-naves.png)
2. Póngalos en una carpeta nueva llamada como la cohorte
3. Vaya a https://app.netlify.com/drop
4. Arrastre la CARPETA COMPLETA (no los archivos sueltos) a la zona punteada
5. Reclame el sitio (cree cuenta si no tiene)
6. Renombre el subdominio a: naves-[modalidad]-[año]-inalde

ACTUALIZACIONES POSTERIORES:
1. Vaya a https://app.netlify.com → su sitio → pestaña "Deploys"
2. Arrastre la CARPETA con AMBOS archivos a la zona de drag & drop
3. Espere ~20 segundos

RECUERDE ENVIAR A LOS PARTICIPANTES:
- URL del sitio: https://[subdominio].netlify.app
- Clave de acceso: [la clave que definió]

VERIFICACIÓN RECOMENDADA:
- Abrir el sitio y probar con la clave
- Enviar una pregunta de prueba desde el formulario
- Pegar el link en un chat de WhatsApp — debe aparecer la imagen de previsualización
- Verificar que el correo llegue a juan.vicaria@inalde.edu.co
```

---

## Formatos de fecha - referencia detallada

El template necesita las fechas en varios formatos. Ejemplos concretos:

### FECHA_LANZAMIENTO (rango corto en tarjeta timeline)
- Si es rango: `"12 — 13 Mayo"` (con em dash, sin año)
- Si es fecha única: `"26 Enero"`

### FECHA_ANTEPROYECTO (fecha corta en timeline)
- `"26 Mayo"` (sin año)

### FECHA_VENTANA_R1 / FECHA_VENTANA_R2 (rango con meses distintos)
- Formato: `"28 Mayo — 26 Junio"` (con em dash)

### FECHA_60_DIAS / FECHA_ENTREGA_FINAL / FECHA_REUNION_PREP (fecha corta)
- `"15 Septiembre"`, `"14 Noviembre"`, `"17 Noviembre"`

### FECHA_PRESENTACIONES (2 días consecutivos)
- `"24 — 25 Noviembre"` (si mismo mes)
- `"30 — 31 Octubre"` (si cruza meses se puede usar `"30 Octubre — 1 Noviembre"`)

### FECHA_*_COMPLETA (para tarjetas resumen)
- Lanzamiento: `"12 — 13 Mayo 2026"`
- Anteproyecto: `"26 Mayo 2026"`

### FECHA_*_LARGA (redacción formal para Q&A)
- Anteproyecto: `"26 de mayo de 2026"`
- Entrega final: `"14 de noviembre de 2026"`
- Ventana R1: `"del 28 de mayo al 26 de junio de 2026"`
- Ventana R2: `"del 6 al 19 de agosto de 2026"`
- Presentaciones: `"24 y 25 de noviembre de 2026"`

**Regla:** meses en minúscula cuando van en prosa (formato largo). En timeline y tarjetas van en mayúscula inicial (convención del sitio actual).

---

## Ejemplo de uso completo

**Input:**

```
Modalidad: Intensivo
Cohorte: MBA Intensivo 2024 — 2026
Año NAVES: 2026

Fechas:
- Lanzamiento: 12-13 Mayo 2026
- Anteproyecto: 26 Mayo 2026
- Ventana R1: 28 Mayo - 26 Junio 2026
- Ventana R2: 6 - 19 Agosto 2026
- 60 días antes: 15 Septiembre 2026
- Entrega final: 14 Noviembre 2026
- Reunión preparación presentación: 17 Noviembre 2026
- Presentaciones: 24-25 Noviembre 2026

Clave de acceso: Int2026NAVES
Clave Web3Forms: 1a9e51fd-2b8f-49b2-abc0-b992d3c6ca1a
```

**Output:** Archivo `index.html` personalizado para esta cohorte, listo para subir a Netlify.

---

## Notas importantes

1. **No modificar el template.html directamente.** Si se necesita cambiar algún texto de las 33 preguntas o la estructura del sitio, hacerlo en el template y regenerar.

2. **Las 33 preguntas y sus respuestas son fijas.** Solo cambian las fechas dentro de ellas. Si el usuario pide agregar/modificar una pregunta, actualizar el template directamente.

3. **La clave de acceso queda en hash SHA-256.** Nunca queda en texto plano en el código. Pero cualquier persona con acceso al HTML puede intentar ataques de diccionario, así que la clave debe ser distinta por cohorte.

4. **Web3Forms plan gratuito** tiene límite de 250 envíos/mes y bloquea subdominios gratuitos (netlify.app) para envíos masivos. Para cohortes grandes o uso intensivo, considerar plan Pro.

5. **El session_key debe ser único por cohorte** para que un participante que entró al sitio de una cohorte no tenga acceso automático al de otra.

6. **Logos INALDE embebidos:** El template incluye los logos como data URI base64. No hay que subir archivos adicionales al hosting.

7. **Favicon embebido:** El template incluye el favicon del cohete NAVES (fondo negro, cohete blanco) embebido en base64. Es el mismo para todas las cohortes. Se inserta automáticamente; no requiere placeholder ni input del usuario.

8. **Imagen de previsualización (Open Graph):** El template incluye meta tags Open Graph que apuntan a `og-image-naves.png`. Este archivo NO está embebido en el HTML — se sirve como archivo separado junto al `index.html`. **Al publicar en Netlify, se deben subir ambos archivos** (el `index.html` y el `og-image-naves.png`) en la misma carpeta/deploy. La imagen es fija para todas las cohortes.

---

## Archivos relacionados

- `template/template.html` — Plantilla HTML con 17 tipos de placeholders (~110 KB)
- `examples/ejemplo-int-2026.html` — Sitio generado de referencia (MBA Intensivo 2024-2026)
- `reference/mapa-placeholders.md` — Documentación detallada de cada placeholder
