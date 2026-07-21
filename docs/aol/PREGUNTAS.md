# AoL — Decisiones de integración (resueltas con el desarrollador)

Los 7 puntos que quedaron abiertos al construir el módulo se resolvieron el 21-jul-2026 entre el desarrollador y el asistente (Juan Manuel no es técnico; las decisiones cuidan la seguridad y lo óptimo para el sistema). Estado: **RESUELTO**.

1. **Mapeo cohorte de plataforma → `cohorte.codigo` del esquema AoL.** ✅ RESUELTO
   Se deriva el código de la etiqueta de la plataforma: `"MBA INT 24-26"` → `"INT 2024-2026"` (modalidad + años a 4 dígitos). Confirmado.

2. **Políticas RLS.** ✅ RESUELTO
   La RLS está **activa y funcionando**. En esta plataforma ningún usuario accede directo a la base: todo pasa por el backend, que valida el rol NAVES y recién ahí lee (con `service_role`). Por eso las tablas AoL tienen RLS que **niega el acceso directo** de anon/authenticated (nadie externo lee, ni con la llave pública) y el permiso de lectura lo aplica el backend según el rol. Es más seguro que abrir lectura directa.

3. **`on_standard` global de una calificación.** ✅ RESUELTO
   Lo define el profesor con los 6 puntajes; el sistema lo deriva de ahí (`total ≥ 12` = promedio ≥ 2,0). Se mantiene, sin cambios.

4. **`autor` en `medicion`/`aol_calificacion`.** ✅ RESUELTO — CAMBIADO
   Se guarda el **nombre completo del profesor** (el identificador no lo conoce nadie salvo el sistema). Se resuelve server-side desde la BD (`profesores`/`participantes_lista`), no se confía en el cliente.

5. **Extracción por trait.** ✅ RESUELTO
   Segmentación pragmática por anclas de palabras clave (pasa los fixtures). Se calibrará con las primeras entregas reales.

6. **Chequeos del modelo financiero.** ✅ RESUELTO
   Los **12 chequeos** salen de la tabla `criterio_modelo_financiero` (dimensión A interna / B coherencia BP) que ya trae el paquete; la IA los marca OK/ALERTA. El cuadre del balance del quick-screen viene del cerebro (§7.2). Se añadió un mini-evaluador de fórmulas simples solo como refuerzo para modelos sin resultados cacheados.

7. **"Entrega completa" = 4 archivos.** ✅ RESUELTO
   BP.pdf + one-pager + logo + modelo financiero .xlsx. El pipeline consume BP.pdf + Excel; one-pager y logo cuentan para el estado de entrega. Confirmado.
