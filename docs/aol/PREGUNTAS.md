# AoL — Preguntas y supuestos para Juan Manuel

Acumuladas durante la construcción del módulo (jerarquía: cerebro > especificación > mockup > **JMV decide**). Numeradas, con contexto y recomendación. Donde tuve que avanzar, dejé un supuesto marcado **[SUPUESTO APLICADO]** — confirmar o corregir.

---

**1. Mapeo cohorte de plataforma → `cohorte.codigo` del esquema AoL.** [SUPUESTO APLICADO]
La tabla `cohorte` del histórico usa `codigo` tipo `"FS 2014-2016"` / `"INT 2023-2025"`. Al firmar, se materializa la cohorte activa derivando el código de la etiqueta de la plataforma: `"MBA INT 24-26"` → `"INT 2024-2026"` (modalidad + años a 4 dígitos).
*Recomendación:* confirmar el formato exacto (¿así, o con otra convención de código?).

**2. Políticas RLS (§5).** [SUPUESTO APLICADO]
El §5 propone políticas de lectura para el rol `authenticated` con `auth.jwt() ->> 'rol_naves'`. Esta plataforma **no usa Supabase Auth**: todo el acceso a datos va por el backend Node con `service_role` (que valida el rol NAVES). Por eso dejé RLS **activada sin políticas** (niega acceso directo de anon/authenticated) — es más restrictivo que el ejemplo y consistente con el resto del sistema.
*Recomendación:* confirmar que la lectura solo-por-backend es lo deseado (lo es por seguridad).

**3. Definición del flag global `on_standard` de una calificación.** [SUPUESTO APLICADO]
El cerebro define *on standard = puntaje ≥ 2* **por trait**. Para el flag global de `aol_calificacion` usé `total ≥ 12` (promedio ≥ 2,0 sobre los 6 traits).
*Recomendación:* confirmar. Alternativas: "todos los traits ≥ 2", o "≥ N traits on standard".

**4. `autor` en `medicion`/`aol_calificacion`.** [SUPUESTO APLICADO]
Se guarda el identificador de autenticación (sub del JWT) del profesor que firma (trazable, R8). Las filas históricas parecen tener un nombre legible.
*Recomendación:* ¿prefiere guardar el nombre completo del profesor en vez del id?

**5. Extracción por trait (§7.3).** [SUPUESTO APLICADO]
La segmentación del BP por sección es **pragmática por anclas de palabras clave** (5.1, TAM/SAM/SOM, sección 8, canvas, etc.), no un parser estricto del índice. Pasa los fixtures (el paquete del trait 2 contiene TAM·SAM·SOM; el del trait 5 la sección 8 + el Excel).
*Recomendación:* calibrar las anclas con las primeras entregas reales (§10).

**6. Balance del modelo financiero.** [SUPUESTO APLICADO]
Algunos modelos (p. ej. los fixtures) no traen los **resultados de las fórmulas cacheados**, así que se agregó un mini-evaluador de fórmulas simples (`SUM(rango)` y ±) para poder verificar el cuadre `Activo − (Pasivo+Patrimonio) = 0`. Si aun así no se resuelve, queda `NO VERIFICABLE`.
*Recomendación:* confirmar tolerancia y nombres de hoja/etiquetas típicos de los modelos reales.

**7. "Entrega completa" = 4 archivos.** [SUPUESTO APLICADO]
Se considera completa con BP.pdf + one-pager + logo + modelo financiero .xlsx (los del campo contenedor). El pipeline solo consume el **BP.pdf** y el **Excel**; one-pager y logo cuentan para el estado de entrega pero no entran al juicio.
*Recomendación:* confirmar si one-pager/logo deben ser obligatorios para disparar el análisis, o basta BP + Excel.
