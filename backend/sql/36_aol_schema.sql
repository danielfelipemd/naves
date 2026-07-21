-- =====================================================================
-- 36_aol_schema.sql — Esquema del módulo AoL (solo ESTRUCTURA, sin datos).
--
-- Réplica del esquema del proyecto aol-naves (14 tablas + vista v_resumen + RLS)
-- en el Supabase de la plataforma (opción B). Los DATOS históricos (369
-- estudiantes, 2.202 mediciones) NO se incluyen aquí para no duplicar PII en el
-- repo: ya están aplicados en la BD y viven en el repo privado aol-naves-paquete
-- (migración 20260719000001_aol_schema_y_datos.sql). Ver 37_aol_operacion.sql
-- para las tablas que escribe la plataforma.
-- =====================================================================

-- =============================================================
-- Módulo AoL NAVES — esquema completo v1.0 (julio 2026)
-- Generado desde aol_naves.db (histórico 2014-2025) + cerebro v1.0
-- =============================================================

create table cohorte (
  id bigint primary key,
  codigo text unique not null,
  modalidad text not null check (modalidad in ('FS','INT')),
  anio_inicio int, anio_fin int, anio_medicion int,
  fuente_archivo text, tiene_detalle_individual boolean, notas text
);
create table learning_objective (
  id bigint primary key, codigo text unique not null,
  nombre_en text, nombre_es text
);
create table criterio (
  id bigint primary key,
  lo_id bigint references learning_objective(id),
  orden int, nombre_en text, nombre_corto text,
  fuente_ia text  -- dónde debe mirar la IA (índice + sección del BP)
);
create table rubrica_nivel (
  id bigint primary key,
  criterio_id bigint references criterio(id),
  puntaje int check (puntaje between 1 and 3),
  descripcion text
);
create table proyecto (
  id bigint primary key,
  cohorte_id bigint references cohorte(id),
  titulo text
);
create table estudiante (
  id bigint primary key,
  cohorte_id bigint references cohorte(id),
  nombres text, apellidos text, nombre_completo text, nombre_normalizado text,
  proyecto_id bigint references proyecto(id),
  nota_final text
);
create table medicion (
  id bigint primary key,
  estudiante_id bigint references estudiante(id),
  criterio_id bigint references criterio(id),
  puntaje numeric,
  -- campos nuevos para la plataforma (histórico queda null):
  origen text check (origen in ('ia_sugerida','ia_confirmada','manual') or origen is null),
  autor text, creado_en timestamptz default now(),
  version_cerebro text, version_rubrica text
);
create table agregado_cohorte (
  id bigint primary key,
  cohorte_id bigint references cohorte(id),
  criterio_id bigint, lo_id bigint, nivel text, n numeric, pct numeric, fuente text
);
create table accion_mejora (
  id bigint primary key,
  anio text, cohorte_codigo text, descripcion text, fuente text,
  lo_id bigint references learning_objective(id),
  criterio_id bigint references criterio(id),
  tipo text check (tipo in ('trait','proceso') or tipo is null)
);
create table aacsb_tabla (
  id bigint primary key,
  tipo_medida text, competencia text, target text,
  how_assessed text, where_assessed text, when_assessed text,
  resultados text, anio text
);
create table conclusion_ciclo (
  id bigint primary key,
  anio int, cohorte_codigo text, goal_pct numeric, resumen text, fuente text
);
create table criterio_modelo_financiero (
  id bigint primary key,
  dimension text, orden int, item text, detalle text, fuente text
);
create table nota_calidad (
  id bigint primary key, descripcion text
);
-- el cerebro versionado: la plataforma lo lee de aquí en cada corrida (regla R5)
create table cerebro_documento (
  id bigint generated always as identity primary key,
  nombre text not null,
  version text not null,
  contenido_md text not null,
  vigente boolean default true,
  creado_en timestamptz default now(),
  unique (nombre, version)
);

create view v_resumen as
  select c.codigo as cohorte, c.anio_medicion, cr.nombre_corto as criterio,
         lo.codigo as lo, count(m.id) as n,
         round(100.0*sum(case when m.puntaje>=2 then 1 else 0 end)/count(m.id),1) as pct_on_standard,
         sum(case when m.puntaje>=3 then 1 else 0 end) as excede,
         sum(case when m.puntaje=2 then 1 else 0 end) as cumple,
         sum(case when m.puntaje<2 then 1 else 0 end) as no_cumple
  from medicion m
  join estudiante e on e.id=m.estudiante_id
  join cohorte c on c.id=e.cohorte_id
  join criterio cr on cr.id=m.criterio_id
  join learning_objective lo on lo.id=cr.lo_id
  group by c.id, c.codigo, c.anio_medicion, cr.id, cr.nombre_corto, lo.codigo;

  origen: Rúbricas AoL NAVES).
- **[BP]** "Nueva estructura del Business Plan", nota técnica vigente INT 2024-2026
  (índice sugerido de 9 secciones + instrucciones de entrega de 4 documentos).
- **[FIN]** CN-I-078 "Cómo armar los números de NAVES" (Dávila & Tovar) — construcción del P&G,
  balance, flujo de caja, punto de equilibrio e indicadores.
- **[AACSB]** `AACSB-2026-lenguaje-AoL.md` — Estándar 5 y vocabulario oficial 2026. Los informes
  usan ese lenguaje.

**Marco AACSB:** la medición NAVES es una **direct measure** del competency goal
**Entrepreneurship**, con **target de 80% de learners on standard por trait**. On standard =
puntaje ≥ 2.

---

## 1. Escala, anclas y regla de evidencia

| Puntaje | Etiqueta | Ancla de decisión |
|---|---|---|
| 1 | No cumple el estándar | El trait está ausente, gravemente deficiente o no es localizable en las secciones donde debe estar. |
| 2 | Cumple el estándar | El trait está presente, completo en lo esencial y bien ejecutado, sin llegar a sobresaliente. |
| 3 | Excede el estándar | El trait está ejecutado con profundidad extra verificable: múltiples escenarios, análisis adicional, rigor superior. **El 3 se gana con evidencia, nunca por estilo o redacción.** |

**Regla de evidencia:** todo puntaje se ancla a una **cita textual localizable** (página/sección del
Business Plan, hoja/celda del Excel). Si la evidencia esperada no aparece donde la estructura [BP]
dice que debe estar, ni en el resto del documento, el puntaje **baja** y la ausencia **se declara**.

**Salida por trait (esquema fijo, R3):**
`puntaje (1-3)` + `razon` + `evidencia (cita literal)` + `ubicacion (página/sección u hoja/celda)` +
`sugerencia (obligatoria si puntaje ≤ 2)` + `confianza (alta/media/baja)`.

---

## 2. ⚡ Quick screen y compuertas (determinísticas — no las decide el LLM)

Antes de puntuar trait alguno, el **sistema** (código, no modelo) verifica:

1. **Entrega completa (4 archivos):** Business Plan (PDF), One Pager (PDF), logo (JPG) y modelo
   financiero (Excel) en el campo contenedor. **Falta alguno ⇒ compuerta: no se califica; se
   notifica.** [BP]
2. **Límite de páginas:** BP ≤ 25 páginas incluyendo tablas, anexos y referencias. Exceso ⇒ se
   declara en el informe (incumplimiento de instrucciones). [BP]
3. **Tabla de contenido presente** en el BP (es la puerta de entrada de toda la lectura por
   secciones). Ausente ⇒ compuerta: revisión humana antes de calificar. [BP]
4. **Declaración de uso de IA** presente en la sección de referencias (si utilizó, en qué secciones,
   qué herramienta, con qué propósito). Su ausencia o imprecisión es **falta grave** y se declara. [BP]
5. **Modelo financiero con fórmulas visibles y sin protección.** Un Excel de puros valores pegados
   ⇒ compuerta: se marca "no verificable" y exige revisión humana. [BP][FIN]
6. **Chequeo del balance:** Activo − (Pasivo + Patrimonio) = 0 en todos los períodos — se computa
   desde el Excel, no se le pregunta al modelo. Descuadre ⇒ alerta grave en el trait 5. [FIN]

---

## 3. 🔒 Protocolo de confiabilidad R1–R8 (adaptado de NACRA)

- **R1 — Verificación de citas (candado principal):** toda `evidencia` se verifica **por substring**
  contra el PDF/Excel de ESTA entrega. Cita no encontrada literalmente ⇒ el ítem se **rechaza
  automáticamente** y se rehace. Nunca afirmar un defecto específico sin cita que lo confirme en
  ESTE archivo (lección del caso CAMINA: razonar de memoria produce hallazgos específicos,
  confiados y falsos).
- **R2 — Lo mecánico se computa:** compuertas del §2, conteo de páginas, cuadre del balance,
  detección de fórmulas vs. valores pegados. El LLM no "opina" sobre nada calculable.
- **R3 — Salida estructurada + temperatura 0:** JSON con esquema fijo del §1; sin prosa libre fuera
  del esquema.
- **R4 — Separar LEER de JUZGAR:** etapa 1 extrae del BP/Excel las citas relevantes a cada trait
  (según el campo "dónde mira" de cada uno); etapa 2 puntúa **solo sobre lo extraído**.
- **R5 — El cerebro va SIEMPRE en el contexto:** se pasa este documento completo en cada corrida.
  Prohibido puntuar por conocimiento general del modelo.
- **R6 — Confianza + segunda pasada:** cada trait lleva `confianza`; una segunda pasada revalida R1
  y R2. Se marcan para revisión obligatoria: confianza baja, compuertas tocadas, discrepancias
  entre pasadas.
- **R7 — Humano en el lazo:** la sugerencia IA jamás se convierte en calificación sin el clic del
  profesor. Nada se guarda en firme sin su confirmación.
- **R8 — Trazabilidad:** cada calificación registra versión del cerebro, archivos evaluados (hash),
  citas usadas, autor y fecha. Auditable y reproducible.

---

## 4. LO1 — Be able to discover new business opportunities

### Trait 1 · Descubrir la oportunidad de negocio

- **Qué evalúa:** que el trabajo identifique una oportunidad de negocio real, claramente descrita,
  situada en un entorno específico y justificada. [RUB]
- **Dónde mira la IA:** índice del BP + sección **5 «El mercado, la oportunidad y la competencia»**,
  en particular **5.1 Descripción cualitativa de la oportunidad**; apoyo en 1.2 (resumen ejecutivo:
  "¿cuál es la oportunidad y de qué tamaño es?"). [BP]
- **Qué extrae (R4):** párrafos donde se enuncia la oportunidad; el contexto/entorno declarado; la
  justificación (dolor del cliente, vacío del mercado, cambio regulatorio o tecnológico).
- **Nivel 3 — Excede:** identifica **múltiples** oportunidades o ángulos de la oportunidad en
  diversos entornos, respaldadas por un **análisis estructurado** (comparación entre alternativas,
  criterios de selección explícitos, por qué esta y no otra). [RUB]
- **Nivel 2 — Cumple:** una oportunidad clara en un entorno particular con justificación básica
  pero verificable. [RUB]
- **Nivel 1 — No cumple:** no se identifica oportunidad con claridad; se describe un producto sin
  el vacío de mercado que lo justifica; la "oportunidad" es una afirmación sin entorno ni sustento. [RUB]
- **Señales rojas:** oportunidad definida como "a la gente le gustaría…" sin evidencia; confusión
  entre idea de producto y oportunidad de mercado; entorno genérico ("el mundo", "Latinoamérica")
  sin delimitación.
- **Sugerencia típica:** delimitar el entorno (geografía/segmento/canal), enunciar el dolor o vacío
  concreto y contrastar al menos una alternativa de oportunidad descartada.

### Trait 2 · Formular la oportunidad adecuadamente

- **Qué evalúa:** que la oportunidad esté **dimensionada** — presentada en términos numéricos y
  cualitativos. [RUB]
- **Dónde mira la IA:** índice + **5.2 TAM · SAM · SOM**; apoyo en 5.1 y en el One Pager
  (número ancla). [BP]
- **Qué extrae:** cifras de TAM/SAM/SOM con sus recortes y fuentes; categorías cualitativas del
  dimensionamiento; escenarios si existen.
- **Nivel 3 — Excede:** formula la oportunidad con **varios escenarios**, combinando datos
  cuantitativos detallados (TAM/SAM/SOM con metodología de recorte explícita y fuentes) y análisis
  cualitativo sólido. [RUB]
- **Nivel 2 — Cumple:** datos básicos que dimensionan la oportunidad (al menos SOM defendible) más
  categorías cualitativas adecuadas. [RUB]
- **Nivel 1 — No cumple:** no presenta la oportunidad en términos numéricos ni cualitativos; cifras
  sin fuente ni recorte; TAM inflado sin camino al SOM. [RUB]
- **Señales rojas:** mercado total citado como si fuera el alcanzable; recortes sin criterio
  (porcentajes arbitrarios); cifras sin unidad ni período; fuentes no verificables.
- **Coherencia cruzada obligatoria:** el SOM declarado aquí debe soportar las cantidades (Q)
  proyectadas en el modelo financiero (ver §6.B.2).
- **Sugerencia típica:** explicitar la metodología de recorte TAM→SAM→SOM con fuentes; expresar
  cada cifra con unidad y período; construir al menos dos escenarios de captura.

### Trait 3 · Realizar una investigación de mercado

- **Qué evalúa:** que exista investigación de mercado real: objetivos de investigación definidos,
  estudio diseñado y ejecutado, información relevante obtenida. [RUB]
- **Dónde mira la IA:** índice + **5.3 Análisis de los competidores**, **5.4 Posición relativa /
  mapa de posicionamiento**, y **6.1–6.4** (perfil de clientes, segmentación, precios, proyecciones
  de consumo). [BP]
- **Qué extrae:** objetivos de investigación; metodología (encuestas, entrevistas, fuentes
  secundarias) con tamaños de muestra; hallazgos usados en decisiones del plan; análisis de
  competidores y posicionamiento.
- **Nivel 3 — Excede:** investigación **sólida** que incorpora variables del entorno y **análisis
  competitivo** completo (competidores identificados, posición relativa mapeada) y cuyos hallazgos
  alimentan decisiones visibles del plan (precio, canal, segmento). [RUB]
- **Nivel 2 — Cumple:** objetivos definidos + un estudio ejecutado (p. ej. encuestas con n
  declarado, entrevistas) con información relevante. [RUB]
- **Nivel 1 — No cumple:** no hay investigación o es deficiente: afirmaciones sobre el cliente sin
  trabajo de campo ni fuentes; competidores ignorados. [RUB]
- **Señales rojas:** "encuestamos a personas" sin n, instrumento ni fecha; hallazgos que no se usan
  en ninguna decisión del plan; ausencia total de competidores ("no tenemos competencia").
- **Sugerencia típica:** declarar objetivos, instrumento, muestra y fechas; mapear competidores y
  posición relativa; conectar cada hallazgo con una decisión del plan.

---

## 5. LO2 — Be able to document a business plan

### Trait 4 · Elaborar un plan de negocios sólido

- **Qué evalúa:** que el documento sea un plan de negocios completo y estructurado, con los
  elementos indispensables. [RUB]
- **Dónde mira la IA:** **tabla de contenido completa** del trabajo contrastada con el **índice
  sugerido de 9 secciones** de la nota técnica: 1 Resumen ejecutivo · 2 Presentación del equipo ·
  3 Concepto del negocio · 4 La nueva empresa en su sector · 5 Mercado, oportunidad y competencia ·
  6 Clientes y plan comercial · 7 Operaciones · 8 Aspectos económicos · 9 Contingencias. [BP]
- **Qué extrae:** la tabla de contenido; presencia y desarrollo real de cada numeral principal
  (los subnumerales son opcionales según el proyecto [BP]); el hilo lógico entre secciones.
- **Nivel 3 — Excede:** desarrolla **más de un plan / estrategias alternativas para diferentes
  escenarios** (p. ej. plan base + plan de contingencia articulado con la sección 9), manteniendo
  coherencia interna completa. [RUB]
- **Nivel 2 — Cumple:** plan estructurado con los numerales principales presentes y desarrollados,
  coherente de principio a fin. [RUB]
- **Nivel 1 — No cumple:** documento incompleto (numerales principales ausentes), desordenado o que
  no constituye un plan (es un ensayo, un pitch extendido o un informe descriptivo). [RUB]
- **Señales rojas:** secciones del índice que existen como título pero están vacías o son relleno;
  contradicciones entre secciones (el segmento de 6.2 no es el del 5.2; el precio de 6.3 no es el
  del modelo); sección 9 (contingencias) ausente — es el numeral que más se omite.
- **Sugerencia típica:** completar los numerales ausentes; resolver contradicciones entre
  secciones; si aspira a exceder, articular escenarios alternativos con la sección 9.

### Trait 5 · Desarrollar un plan financiero sostenible

- **Qué evalúa:** que el plan financiero exista, esté completo y sea sostenible: ingresos, costos y
  proyecciones a varios años, con un modelo que lo respalde. [RUB]
- **Dónde mira la IA:** índice + **sección 8 «Aspectos económicos» (8.1–8.7)** del BP **+ el modelo
  financiero en Excel** entregado en el campo contenedor (fórmulas visibles). [BP][FIN]
- **Qué extrae:** supuestos del modelo (8.1); punto de equilibrio (8.2); flujo de caja (8.3);
  estados proyectados (8.4); flujo del inversionista (8.5); escenarios (8.6); financiación (8.7).
  Del Excel: la estructura completa según [FIN] (ver §6.A).
- **Nivel 3 — Excede:** plan financiero detallado con **múltiples escenarios, análisis de
  rentabilidad y sensibilidad financiera** (escenarios en 8.6 + modelo con sensibilidad real,
  indicadores ROE/ROA/ROIC interpretados, no solo calculados). [RUB][FIN]
- **Nivel 2 — Cumple:** plan con ingresos, costos y proyecciones a varios años; punto de
  equilibrio; modelo financiero que respalda las cifras. [RUB]
- **Nivel 1 — No cumple:** sin plan financiero o sin proyecciones detalladas; cifras del documento
  sin modelo que las respalde; modelo que no abre o de puros valores pegados. [RUB]
- **Señales rojas [FIN §7]:** modelo que crece "por inflación"; ventas exponenciales sin lógica
  comercial (contrastar con 6.4); resultados positivos inmediatos que maquillan las zonas grises
  ("es mejor que el modelo refleje los puntos débiles a que la realidad los desnude"); utilidad
  neta en madurez por debajo de la rentabilidad esperada por el inversionista.
- **Este trait se alimenta de los 12 chequeos del §6.** Las alertas de coherencia interna golpean
  aquí; las de coherencia con el documento golpean aquí y en el trait 4.
- **Sugerencia típica:** construir los tres estados conectados según CN-I-078; agregar escenarios y
  sensibilidad; conciliar toda cifra del documento con el Excel.

### Trait 6 · Estructurar un modelo de negocio coherente

- **Qué evalúa:** que el modelo de negocio esté claramente planteado: cómo se crea, entrega y
  captura valor; fuente(s) de ingresos y su viabilidad. [RUB]
- **Dónde mira la IA:** índice + **sección 3 «El concepto del negocio»** (3.1 Canvas · 3.2 oferta
  de valor · 3.3 producto/servicio y diferenciación); apoyo en 1.1 (resumen: "¿cuál es el modelo de
  negocio?"). [BP]
- **Qué extrae:** el Canvas y sus bloques; la oferta de valor; la(s) fuente(s) de ingresos; la
  diferenciación; señales de escalabilidad.
- **Nivel 3 — Excede:** modelo **integral** con **diversas fuentes de ingresos** y **oportunidades
  de escalabilidad** identificadas y argumentadas (no listadas: argumentadas con el mercado de la
  sección 5 y los números de la 8). [RUB]
- **Nivel 2 — Cumple:** modelo claro con la fuente principal de ingresos identificada y su
  viabilidad argumentada. [RUB]
- **Nivel 1 — No cumple:** modelo incoherente o ausente: no se entiende quién paga, por qué ni
  cómo; Canvas de plantilla sin conexión con el resto del plan. [RUB]
- **Señales rojas:** bloques del Canvas contradictorios con las secciones 5-7; "escalabilidad"
  declarada sin mecanismo; fuente de ingresos que no aparece en el P&G del modelo financiero.
- **Coherencia cruzada obligatoria:** cada fuente de ingresos del Canvas debe existir como línea de
  ingreso en el P&G del Excel (ver §6.B).
- **Sugerencia típica:** alinear el Canvas con mercado y números; argumentar la viabilidad de cada
  fuente de ingresos; si aspira a exceder, desarrollar fuentes adicionales con su reflejo
  financiero.

---

## 6. Lectura del modelo financiero (Excel del campo contenedor)

La IA lee el Excel en **dos dimensiones** (12 chequeos; tabla `criterio_modelo_financiero`).
Resultado por chequeo: `OK / ALERTA / NO VERIFICABLE` + evidencia (hoja/celda) + nota.

### A · Coherencia interna [FIN]

1. **P&G completo y encadenado:** Ingresos = P×Q → costo de ventas (CV×Q + CF) → margen bruto →
   gastos operacionales (admón. y ventas) → EBITDA → depreciación → EBIT → intereses (tasa × deuda)
   → impuestos (tasa × UAI) → utilidad neta. Fórmulas encadenadas, sin saltos ni valores pegados.
2. **Balance y su chequeo:** activo corriente por días (caja necesaria, CxC, inventario), activo
   fijo neto; pasivo (CxP por días, deuda financiera vía NOF vs. fondo de maniobra); patrimonio
   (capital + resultados). **Activo − (Pasivo + Patrimonio) = 0** en todos los períodos (computado
   por R2).
3. **Flujo de caja libre:** FCL = NOPAT + depreciación ± ΔNOF − CAPEX; impuestos operacionales
   sobre EBIT; NOF del período 0 = 0; ΔNOF = NOF anterior − NOF actual.
4. **Margen de contribución y punto de equilibrio:** MC = ventas − costos variables, visible por
   producto del portafolio; PE = costos fijos / margen de contribución.
5. **Indicadores:** ROE (utilidad neta / patrimonio — preferible saldo inicial), ROA, ROIC
   calculados; en madurez, utilidad neta ≥ rentabilidad esperada × patrimonio invertido.
6. **Supuestos críticos y tendencias:** sin crecimiento por inflación; sin ventas exponenciales
   injustificadas; el modelo refleja los puntos débiles en vez de maquillarlos.

### B · Coherencia con el Business Plan [BP]+[FIN]

1. **Precios y cantidades:** P y Q del modelo = precios/descuentos/márgenes (6.3) y proyecciones de
   consumo/ventas (6.4) del documento.
2. **Mercado:** las Q proyectadas son alcanzables frente al SOM declarado en 5.2 (calcular Q/SOM y
   declarar el porcentaje).
3. **Costos y estructura operacional:** costos y gastos del modelo reflejan el plan de operaciones
   (7: talento, producción/entrega, logística).
4. **CAPEX e inversiones:** coherentes con 7.2 (incluye I+D y software como activo [FIN §2]).
5. **Cifras citadas en el documento:** todo número reportado en la sección 8 y en el resumen
   ejecutivo (1.3) — punto de equilibrio, VPN, inversión, financiación — coincide con el Excel.
   Divergencia ⇒ ALERTA con ambas cifras citadas.
6. **Escenarios y financiación:** los escenarios de 8.6 existen en el modelo; la financiación
   requerida y sus fuentes (8.7) cuadran con deuda + capital del balance.

---

## 7. Párrafo de calificación del trabajo

Al terminar los 6 traits, el calificador redacta un **párrafo corto por trabajo** (borrador IA,
editable por el profesor, se guarda con la calificación):

- **Contenido:** qué tanto cumple cada trait de la rúbrica (los 6, en orden, sin omitir ninguno),
  las alertas relevantes del modelo financiero, y el cierre con la calificación sugerida
  (total /18 y on/below standard).
- **Estilo:** 5-8 frases, tono profesional de informe AoL, lenguaje AACSB donde aplique
  (on standard, target, direct measure), sin adjetivos vacíos, cada afirmación respaldada por la
  evidencia ya verificada (no introduce hechos nuevos).
- **Prohibido:** mencionar traits sin haberlos evaluado; suavizar una compuerta o alerta grave;
  emitir la calificación como definitiva (siempre "sugerida" hasta la firma del profesor).

---

## 8. Esquema de salida (JSON, R3)

```json
{
  "version_cerebro": "1.0",
  "archivos": {"bp_pdf": "<hash>", "modelo_xlsx": "<hash>"},
  "quick_screen": {"entrega_completa": true, "paginas": 25, "toc": true,
                   "declaracion_ia": true, "formulas_visibles": true, "balance_cuadra": true},
  "traits": [
    {"trait": 1, "puntaje": 2, "razon": "...", "evidencia": "cita literal",
     "ubicacion": "p. 8 / secc. 5.1", "sugerencia": "...", "confianza": "alta"}
  ],
  "modelo_financiero": {
    "interna": [{"chequeo": 1, "estado": "OK", "evidencia": "hoja P&G", "nota": "..."}],
    "coherencia_bp": [{"chequeo": 5, "estado": "ALERTA", "evidencia": "p. 22 vs hoja Flujo", "nota": "..."}]
  },
  "parrafo": "...",
  "total": 14, "on_standard": true
}
```

---

## 9. Closing the loop — reglas de las acciones de mejora

- **Toda curricular intervention apunta a un trait y su LO específicos.** No se registran acciones
  genéricas: cada fila de `accion_mejora` lleva `lo_id` y `criterio_id` (trait). Una iniciativa que
  toca varios traits se registra como varias acciones, una por trait.
- **Consistencia en los informes (obligatoria):** todo informe presenta el ciclo con la tríada
  **acción → trait/LO → resultado observado en la siguiente medición** (el delta del trait). Esa es
  la evidencia de "loop is closed" de la Tabla 5-1. Una acción sin trait declarado o un delta sin
  acción que lo explique rompen la consistencia del reporte.
- **Acciones de proceso** (plataforma, website, instrumentación) se marcan como tales
  (`tipo = proceso`) y complementan, pero **no sustituyen**, las acciones por trait: en cada ciclo
  debe existir al menos una intervención dirigida a un trait concreto.
- **Madurez no exime:** cuando un trait está sistemáticamente por encima del target (80% on
  standard en las últimas mediciones), **igual se formula acción de mejora**. Opciones legítimas en
  estado maduro: (a) mover la distribución de «cumple» hacia «excede» (target interno sobre el
  nivel 3); (b) elevar la exigencia del trait vía rúbrica o entregable (p. ej. exigir el modelo
  financiero, reducir páginas); (c) refinar el instrumento o la evidencia con que se mide; (d)
  cerrar brechas entre modalidades (FS vs. INT, Estándar 5.2). La acción se registra igual, con su
  trait/LO, y su efecto se lee en la siguiente medición.

---

## 10. Versionamiento y calibración

- Este cerebro se versiona (v1.0, v1.1, …); cada calificación registra la versión usada (R8).
- **Calibración:** en lugar de un gold standard, los traits se describen de manera exhaustiva
  (§4-§5). La severidad se calibra revisando con el profesor las primeras corridas reales de la
  cohorte y ajustando las descripciones (verde/rojo/anclas) de este documento — nunca ajustando
  prompts sueltos por fuera del cerebro.
- Cambios de rúbrica, de estructura del BP o de la nota financiera ⇒ nueva versión del cerebro y
  sincronización con las tablas `rubrica_nivel`, `criterio.fuente_ia` y
  `criterio_modelo_financiero` de la base de datos.
');

  **on standard = puntaje ≥ 2**) aplicada al Business Plan, su modelo financiero y la presentación.
- **Target:** 80% de learners on standard por trait.
- **Remediación (5.1.C):** cada medición bajo target genera acciones registradas en `accion_mejora`.
- **Closing the loop (5.1.F):** el dashboard cruza las acciones del período anterior con los deltas
  de la medición vigente; el informe parcial anual documenta el ciclo.
- **Equivalencia (5.2):** comparación FS vs. INT en el dashboard histórico.
- **Participación docente (5.1.G):** los profesores califican en la plataforma (la IA solo sugiere);
  el registro de quién calificó queda en la tabla `medicion`.

### Frases de estilo para informes (lenguaje AACSB)
- "…direct measure tied to the Entrepreneurship competency goal…"
- "…learners performing on standard against the 80% target…"
- "…curricular interventions were implemented and the loop was closed in the following cycle…"
- "…evidence of remediation where learning objectives were not achieved…"
- En español, conservar los términos de arte en inglés: *competency goal, learning objective,
  trait, direct measure, target, on standard, closing the loop, curricular intervention*.
');

compuertas determinísticas (entrega completa, fórmulas visibles, cuadre del balance); fuentes
normativas (rúbrica oficial, estructura del BP, CN-I-078); trazabilidad R8.

---

## 📦 Paquete de archivo por cohorte (obligatorio)

Al cerrar la medición, el sistema exporta a la **carpeta de AoL** (`AOL NAVES FINAL/{cohorte}/`)
el paquete completo — el histórico sigue viviendo en la carpeta, auditable e independiente de la
plataforma:

1. **`Reporte AoL {cohorte}.docx`** — este documento.
2. **`{cohorte} DATOS BRUTOS.xlsx`** — los datos crudos de la medición, mismo formato de los
   Excel históricos y del `AoL_Maestro.xlsx`:
   - Hoja *Mediciones*: una fila por **estudiante × trait × puntaje** (con proyecto y LO).
   - Hoja *Estudiantes*: integrantes, proyecto, nota final del curso.
   - Hoja *Resumen*: % on standard y distribución por trait.
   - Hoja *Párrafos*: el párrafo de calificación firmado de cada trabajo.
   - Hoja *Quick screen*: resultado de las compuertas por trabajo.
3. **`{cohorte} trazabilidad.json`** — versión del cerebro y de la rúbrica, hashes de los archivos
   evaluados, autor y fecha de cada calificación (R8).

**Regla:** ningún ciclo se considera cerrado hasta que el paquete esté en la carpeta. La base de
datos de la plataforma es la fuente operativa; **la carpeta de AoL es el archivo permanente**.

## 📈 Registro histórico acumulado (pantalla Export AACSB)

Además del paquete, al cerrar el ciclo el sistema **alimenta automáticamente el registro
longitudinal** (tabla `conclusion_ciclo`): agrega la fila del ciclo con año, cohorte, % on standard
del goal y el **resumen general de la conclusión** — tomado de la lectura de closing the loop del
reporte (sección 6), condensada a 2-3 frases. Este acumulado, visible bajo la tabla de export
AACSB, es el insumo directo del SER y de cualquier reporte de acreditación: la historia completa
del proceso se lee ahí sin reconstruirla de los Word individuales. El histórico 2022-2025 quedó
precargado desde los informes existentes.
');

-- Seguridad por defecto: RLS activa sin políticas (solo service_role lee/escribe).
-- El desarrollador agrega políticas según los roles de la plataforma (Director, profesor, comité, calidad).
alter table cohorte enable row level security;
alter table learning_objective enable row level security;
alter table criterio enable row level security;
alter table rubrica_nivel enable row level security;
alter table proyecto enable row level security;
alter table estudiante enable row level security;
alter table medicion enable row level security;
alter table agregado_cohorte enable row level security;
alter table accion_mejora enable row level security;
alter table aacsb_tabla enable row level security;
alter table conclusion_ciclo enable row level security;
alter table criterio_modelo_financiero enable row level security;
alter table nota_calidad enable row level security;
alter table cerebro_documento enable row level security;
