# Skill: Programación NAVES

## Descripción

Esta skill calcula automáticamente el cronograma de hitos del programa NAVES (New Business Adventures) a partir de un calendario académico. Recibe como input una imagen o PDF del calendario con convenciones de colores, identifica las jornadas de clase y días especiales, y aplica las reglas de programación para generar las fechas de los 13 hitos del proceso.

## Cuándo usar esta skill

Usar cuando se necesite:
- Programar los hitos de NAVES para una nueva cohorte
- Verificar fechas calculadas contra un calendario académico
- Generar la base de datos de días hábiles para un semestre

## Inputs requeridos

| Input | Descripción | Ejemplo |
|-------|-------------|---------|
| Calendario académico | Imagen o PDF con convenciones de colores | Archivo del programa MBA |
| Tipo de programa | Modalidad del MBA | "Intensivo" o "Fin de Semana" |
| Fecha ancla | Primera fecha de presentaciones | 2026-11-24 (Intensivo) o 2026-06-12 (Fin de Semana) |
| Fecha Kick Off | Solo para Intensivo (Fin de Semana se calcula) | 2026-05-13 |

## Outputs generados

1. **Base de datos de días** (Excel): Una fila por cada día del período con columnas:
   - Fecha
   - Día de la semana
   - Día hábil (S/N)
   - Jornada de clase (S/N)
   - Disponible para reunión grupal (S/N)
   - Feriado nacional (S/N)
   - Evento/Nota

2. **Cronograma de hitos** (Excel): Los 13 hitos con fecha, día y hora calculados

---

## Convenciones de colores del calendario

| Color | Significado |
|-------|-------------|
| Amarillo | Jornada de clase |
| Rojo | Feriado nacional |
| Otros colores | Eventos especiales (Semana Internacional, Presentaciones, Grado) |

---

## Reglas de programación

### Reglas comunes (ambos programas)

| # | Hito | Regla de cálculo | Hora |
|---|------|------------------|------|
| 0a | Conformación grupo WhatsApp oficial | 1 día hábil antes del Kick Off | — |
| 0b | Entrega de notas técnicas e instrucciones | 1 día hábil antes del Kick Off | — |
| 1 | Kick Off / Lanzamiento | Intensivo: fecha fija / Fin de Semana: tercer lunes hábil de enero | 6:30 PM |
| 2 | Entrega anteproyecto | 13 días después del Kick Off | 7:59 AM |
| 3 | Publicación profesores asignados y sus agendas | 2 días hábiles después de entrega anteproyecto | 6:00 PM |
| 4 | Ventana Reunión 1 - INICIO | Día siguiente a publicación | 8:00 AM |
| 5 | Ventana Reunión 1 - CIERRE | 18 días hábiles después de publicación | 7:30 PM |
| 6 | Fecha límite cambios (modalidad/equipo/proyecto) | 1 día hábil después de cerrada ventana R1 | 6:00 PM |
| 7 | Ventana Reunión 2 - INICIO | 25 días hábiles después de cerrada ventana R1 | 8:00 AM |
| 8 | Ventana Reunión 2 - CIERRE | 9 días hábiles después de iniciada ventana R2 | 7:30 PM |
| 9 | Reunión grupal "60 días antes" | 60 días calendario antes de entrega final (ajustar a día hábil, no jornada clase) | 6:30 PM |
| 10 | Entrega final documentos (BP + Resumen + Logo) | Ver reglas por programa | 7:59 AM |
| 11 | Reunión preparación presentación | Siguiente día hábil después de la entrega final (Hito 10). Confirmar con el usuario antes de fijar. | 6:30 PM |
| 12 | Primera jornada presentaciones (ANCLA) | Fecha fija | — |
| 13 | Segunda jornada presentaciones | Día siguiente al ancla | — |

### Reglas diferentes por programa

| Aspecto | INTENSIVO | FIN DE SEMANA |
|---------|-----------|---------------|
| Jornadas de clase | Lunes, Martes, Miércoles | Viernes y Sábado |
| Período trabajo de grado | Julio - Noviembre | Enero - Junio |
| Semana Santa | N/A (no aplica en su período) | NO hábil (toda la semana) |
| Kick Off | Fecha fija definida por el usuario | Tercer lunes hábil de enero. Si es festivo → jueves de esa semana |
| Reunión preparación presentación | Siguiente día hábil después de la entrega final (Hito 10). Presentar al usuario y confirmar. | Siguiente día hábil después de la entrega final (Hito 10). Presentar al usuario y confirmar. |
| Entrega final documentos | 1 día hábil antes de reunión preparación | 10 días calendario antes del ancla |

### Reglas de ajuste

1. **Día hábil** = Lunes a Viernes
2. **Festivos SÍ cuentan como hábiles**, EXCEPTO Semana Santa para Fin de Semana
3. Si un hito cae en **fin de semana** → Ajustar al **SIGUIENTE** día hábil
4. Si un hito cae en **jornada de clase** → Ajustar al **SIGUIENTE** día hábil que NO sea jornada
5. Las reglas 3 y 4 aplican especialmente a **reuniones grupales** (las que son a las 6:30 PM)

---

## Proceso de ejecución

### IMPORTANTE: Checkpoints obligatorios

Esta skill tiene **3 puntos de control** donde el agente debe detenerse y esperar confirmación del usuario antes de continuar. Nunca generar el output final sin haber pasado por los 3 checkpoints.

---

### Paso 1: Leer el calendario

1. Recibir la imagen o PDF del calendario académico
2. Identificar el año y período (según tipo de programa)
3. Extraer por color:
   - **Amarillo**: Jornadas de clase → marcar como "Jornada Clase = S"
   - **Rojo**: Feriados nacionales → marcar como "Feriado = S"
   - **Semana Santa** (solo Fin de Semana): Marcar toda la semana como "Día Hábil = N"

---

### ⏸️ CHECKPOINT 1: Confirmación de extracción del calendario

**Detenerse y mostrar al usuario:**

```
He extraído la siguiente información del calendario:

JORNADAS DE CLASE (amarillo):
- Enero: [fechas]
- Febrero: [fechas]
- ... [todos los meses relevantes]

FERIADOS NACIONALES (rojo):
- [lista de fechas]

SEMANA SANTA (solo si aplica para Fin de Semana):
- Del [fecha] al [fecha]

EVENTOS ESPECIALES:
- Semana Internacional: [fechas]
- Presentaciones NAVES: [fechas]
- Grado: [fecha]

¿Es correcta esta extracción? 
- Si es correcta, responda "Sí" o "Correcto"
- Si hay errores, indique qué debo corregir (ej: "Falta el feriado del 12 de octubre" o "El 17 de agosto no es jornada de clase")
```

**Esperar respuesta del usuario antes de continuar.**

Si el usuario indica correcciones:
1. Aplicar las correcciones indicadas
2. Volver a mostrar el resumen corregido
3. Pedir confirmación nuevamente

---

### Paso 2: Construir base de datos de días

1. Crear una fila por cada día del período
2. Calcular automáticamente:
   - Día de la semana
   - Día hábil (L-V = S, S-D = N, Semana Santa para FS = N)
   - Disponible para reunión grupal (Día hábil = S AND Jornada clase = N)

---

### ⏸️ CHECKPOINT 2: Confirmación de parámetros del programa

**Detenerse y mostrar al usuario:**

```
Voy a calcular el cronograma de hitos con estos parámetros:

PROGRAMA: [Intensivo / Fin de Semana]

FECHAS CLAVE:
- Kick Off: [fecha] ([día de la semana])
- Ancla (primera presentación): [fecha] ([día de la semana])

PERÍODO DE CÁLCULO:
- Desde: [fecha inicio]
- Hasta: [fecha fin]

REGLAS QUE VOY A APLICAR:
- Jornadas de clase: [Lunes/Martes/Miércoles ó Viernes/Sábado]
- Semana Santa cuenta como hábil: [Sí / No]
- Reunión preparación: [5 días hábiles antes del ancla ó Lunes anterior al ancla]
- Entrega final: [1 día hábil antes de reunión prep. ó 10 días calendario antes del ancla]

¿Son correctos estos parámetros?
- Si son correctos, responda "Sí" o "Correcto"
- Si hay errores, indique qué debo corregir
```

**Esperar respuesta del usuario antes de continuar.**

Si el usuario indica correcciones:
1. Aplicar las correcciones indicadas
2. Volver a mostrar los parámetros corregidos
3. Pedir confirmación nuevamente

---

### Paso 3: Calcular hitos hacia adelante (desde Kick Off)

```
Kick Off (fecha dada o calculada)
    ↓ -1 día hábil = WhatsApp + Notas técnicas
    ↓ +13 días = Entrega anteproyecto
    ↓ +2 días hábiles = Publicación profesores
    ↓ +1 día = Ventana R1 INICIO
    ↓ +18 días hábiles desde publicación = Ventana R1 CIERRE
    ↓ +1 día hábil = Fecha límite cambios
    ↓ +25 días hábiles = Ventana R2 INICIO
    ↓ +9 días hábiles = Ventana R2 CIERRE
```

### Paso 4: Calcular hitos hacia atrás (desde Ancla)

**Para INTENSIVO:**
```
ANCLA (primera presentación)
    ↑ +1 día = Segunda jornada
    ↑ -1 día hábil = Entrega final (Hito 10)
    ↑ +1 día hábil desde Hito 10 = Reunión preparación (Hito 11) → CONFIRMAR CON USUARIO
    ↑ -60 días calendario = Reunión "60 días antes" (ajustar si jornada clase o fin de semana)
```

**Para FIN DE SEMANA:**
```
ANCLA (primer viernes de presentaciones)
    ↑ +1 día = Segunda jornada
    ↑ -10 días calendario = Entrega final (Hito 10)
    ↑ +1 día hábil desde Hito 10 = Reunión preparación (Hito 11) → CONFIRMAR CON USUARIO
    ↑ -60 días calendario = Reunión "60 días antes" (ajustar si jornada clase o fin de semana)
```

**Mensaje al usuario para confirmar Hito 11:**
```
Estoy programando la reunión de preparación para el [fecha], que es el siguiente día hábil 
después de la entrega de trabajos. ¿Está bien, o prefieres otro día?
```
Esperar respuesta antes de fijar la fecha definitiva del Hito 11.

### Paso 5: Verificar y ajustar

1. Revisar cada hito calculado contra la base de datos de días
2. Si cae en fin de semana → mover al siguiente día hábil
3. Si cae en jornada de clase (para reuniones grupales) → mover al siguiente día hábil que no sea jornada
4. Documentar cualquier ajuste realizado

---

### ⏸️ CHECKPOINT 3: Confirmación del cronograma calculado

**Detenerse y mostrar al usuario:**

```
He calculado el siguiente cronograma de hitos:

| # | Hito | Fecha | Día | Hora | Ajuste aplicado |
|---|------|-------|-----|------|-----------------|
| 0a | Conformación grupo WhatsApp | [fecha] | [día] | — | [ninguno / descripción] |
| 0b | Entrega notas técnicas | [fecha] | [día] | — | [ninguno / descripción] |
| 1 | Kick Off | [fecha] | [día] | 6:30 PM | [ninguno / descripción] |
| 2 | Entrega anteproyecto | [fecha] | [día] | 7:59 AM | [ninguno / descripción] |
| 3 | Publicación profesores y agendas | [fecha] | [día] | 6:00 PM | [ninguno / descripción] |
| 4 | Ventana R1 - INICIO | [fecha] | [día] | 8:00 AM | [ninguno / descripción] |
| 5 | Ventana R1 - CIERRE | [fecha] | [día] | 7:30 PM | [ninguno / descripción] |
| 6 | Fecha límite cambios | [fecha] | [día] | 6:00 PM | [ninguno / descripción] |
| 7 | Ventana R2 - INICIO | [fecha] | [día] | 8:00 AM | [ninguno / descripción] |
| 8 | Ventana R2 - CIERRE | [fecha] | [día] | 7:30 PM | [ninguno / descripción] |
| 9 | Reunión "60 días antes" | [fecha] | [día] | 6:30 PM | [ninguno / descripción] |
| 10 | Entrega final documentos | [fecha] | [día] | 7:59 AM | [ninguno / descripción] |
| 11 | Reunión preparación | [fecha] | [día] | 6:30 PM | [ninguno / descripción] |
| 12 | Primera jornada presentaciones | [fecha] | [día] | — | ANCLA |
| 13 | Segunda jornada presentaciones | [fecha] | [día] | — | [ninguno / descripción] |

AJUSTES REALIZADOS:
- [Lista de ajustes automáticos, ej: "Hito #10 movido de sábado 14/11 a lunes 16/11"]

¿Es correcto este cronograma?
- Si es correcto, responda "Aprobar" o "Sí"
- Si necesita ajustes, indique cuál hito y qué fecha debería tener (ej: "El hito #9 debe ser el 14 de septiembre, no el 15")
```

**Esperar respuesta del usuario antes de continuar.**

Si el usuario indica correcciones:
1. Aplicar las correcciones indicadas
2. Recalcular hitos dependientes si es necesario
3. Volver a mostrar el cronograma completo
4. Pedir confirmación nuevamente

---

### Paso 6: Generar outputs (SOLO después de aprobar Checkpoint 3)

1. Guardar base de datos de días como hoja Excel
2. Guardar cronograma de hitos como hoja Excel
3. Incluir hoja de reglas como referencia
4. Confirmar al usuario que los archivos están listos

---

## Cálculo del Kick Off para Fin de Semana

```
Enero del año:
1. Identificar todos los lunes del mes
2. Excluir lunes festivos
3. Contar: 1er lunes hábil, 2do lunes hábil, 3er lunes hábil
4. Si el 3er lunes hábil es festivo → usar el jueves de esa misma semana
5. Resultado = fecha del Kick Off
```

**Ejemplo 2026:**
- Lunes 5 enero = 1er lunes hábil
- Lunes 12 enero = festivo (no cuenta)
- Lunes 19 enero = 2do lunes hábil
- Lunes 26 enero = 3er lunes hábil → **Kick Off = 26 de enero 2026**

---

## Ejemplo de uso

**Input:**
```
Tipo de programa: Intensivo
Calendario: [imagen del calendario MBA Intensivo 2026]
Fecha ancla: 2026-11-24
Fecha Kick Off: 2026-05-13
```

**Output (cronograma de hitos):**

| # | Hito | Fecha | Día | Hora |
|---|------|-------|-----|------|
| 0a | Conformación grupo WhatsApp | 2026-05-12 | Martes | — |
| 0b | Entrega notas técnicas | 2026-05-12 | Martes | — |
| 1 | Kick Off | 2026-05-13 | Miércoles | 6:30 PM |
| 2 | Entrega anteproyecto | 2026-05-26 | Martes | 7:59 AM |
| 3 | Publicación profesores y agendas | 2026-05-28 | Jueves | 6:00 PM |
| 4 | Ventana R1 - INICIO | 2026-05-29 | Viernes | 8:00 AM |
| 5 | Ventana R1 - CIERRE | 2026-06-25 | Jueves | 7:30 PM |
| 6 | Fecha límite cambios | 2026-06-26 | Viernes | 6:00 PM |
| 7 | Ventana R2 - INICIO | 2026-08-06 | Jueves | 8:00 AM |
| 8 | Ventana R2 - CIERRE | 2026-08-19 | Miércoles | 7:30 PM |
| 9 | Reunión "60 días antes" | 2026-09-15 | Martes | 6:30 PM |
| 10 | Entrega final documentos | 2026-11-14 | Sábado → **2026-11-16 Lunes** | 7:59 AM |
| 11 | Reunión preparación | 2026-11-17 | Martes | 6:30 PM |
| 12 | Primera jornada presentaciones | 2026-11-24 | Martes | — |
| 13 | Segunda jornada presentaciones | 2026-11-25 | Miércoles | — |

---

## Notas importantes

1. **Los programas MBA se llaman "Intensivo" y "Fin de Semana"** (nunca "FS", nunca "Full Session")

2. **Ambas modalidades duran 2 años**. La diferencia está en el momento del segundo año en que hacen el trabajo de grado.

3. **Los festivos cambian cada año** — siempre extraerlos del calendario proporcionado, no usar lista fija.

4. **Semana Santa** varía cada año — identificarla en el calendario (usualmente marcada en gris o con indicación especial).

5. **Verificar siempre** que las fechas calculadas no caigan en jornadas de clase para reuniones grupales.

---

## Archivos relacionados

- `templates/base_calendario.xlsx` — Plantilla vacía para base de datos de días
- `examples/ejemplo_intensivo_2026.xlsx` — Ejemplo calculado para referencia
- `examples/ejemplo_finsemana_2026.xlsx` — Ejemplo calculado para referencia
