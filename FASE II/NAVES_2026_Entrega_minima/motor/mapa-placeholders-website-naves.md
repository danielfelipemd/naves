# Mapa de Placeholders — Template NAVES

Este documento lista todos los placeholders que hay que reemplazar en el template.

## Placeholders de cohorte (datos generales)

| Placeholder | Descripción | Ejemplo |
|-------------|-------------|---------|
| `{{ANIO}}` | Año de NAVES (año del trabajo de grado) | `2026` |
| `{{MODALIDAD}}` | Modalidad del MBA (para el title del navegador) | `Intensivo`, `Fin de Semana` |
| `{{COHORTE_CORTA}}` | Cohorte en formato corto (para variables JS y asuntos de correo) | `INT 2026`, `FS 2026` |
| `{{COHORTE_FULL}}` | Cohorte completa (header) | `MBA Intensivo 2024 — 2026` |
| `{{COHORTE_FULL_DOT}}` | Cohorte con separador de punto (hero) | `MBA Intensivo · 2024 — 2026` |
| `{{COHORTE_CORTA_EJEMPLO}}` | Ejemplo de cohorte para Q&A portada | `MBA INT 2024-2026` |

## Placeholders de fechas — Formato corto (timeline)

| Placeholder | Dónde aparece | Ejemplo |
|-------------|---------------|---------|
| `{{FECHA_LANZAMIENTO}}` | Timeline (tarjeta izquierda) | `12 — 13 Mayo` |
| `{{FECHA_ANTEPROYECTO}}` | Timeline | `26 Mayo` |
| `{{FECHA_VENTANA_R1}}` | Timeline + tarjeta resumen | `28 Mayo — 26 Junio` |
| `{{FECHA_VENTANA_R2}}` | Timeline + tarjeta resumen | `6 — 19 Agosto` |
| `{{FECHA_60_DIAS}}` | Timeline + tarjeta resumen | `15 Septiembre` |
| `{{FECHA_ENTREGA_FINAL}}` | Timeline + tarjeta resumen | `14 Noviembre` |
| `{{FECHA_PRESENTACIONES}}` | Timeline + tarjeta resumen | `24 — 25 Noviembre` |

## Placeholders de fechas — Formato completo (tarjetas resumen)

| Placeholder | Dónde aparece | Ejemplo |
|-------------|---------------|---------|
| `{{FECHA_LANZAMIENTO_COMPLETA}}` | Tarjeta "Los 7 hitos" | `12 — 13 Mayo 2026` |
| `{{FECHA_ANTEPROYECTO_COMPLETA}}` | Tarjeta "Los 7 hitos" | `26 Mayo 2026` |

## Placeholders de fechas — Formato largo (respuestas Q&A)

Estos van en prosa, meses en minúscula.

| Placeholder | Ejemplo |
|-------------|---------|
| `{{FECHA_ANTEPROYECTO_LARGA}}` | `26 de mayo de 2026` |
| `{{FECHA_ENTREGA_FINAL_LARGA}}` | `14 de noviembre de 2026` |
| `{{FECHA_VENTANA_R1_LARGA}}` | `del 28 de mayo al 26 de junio de 2026` |
| `{{FECHA_VENTANA_R2_LARGA}}` | `del 6 al 19 de agosto de 2026` |
| `{{FECHA_PRESENTACIONES_LARGA}}` | `24 y 25 de noviembre de 2026` |

## Placeholders calculados (duración)

| Placeholder | Cálculo | Ejemplo |
|-------------|---------|---------|
| `{{DURACION_MESES}}` | (FECHA_ENTREGA_FINAL − FECHA_ANTEPROYECTO) en meses redondeados | `6` |
| `{{DURACION_SEMANAS}}` | (FECHA_ENTREGA_FINAL − FECHA_ANTEPROYECTO) en semanas redondeadas | `25` |

## Placeholders de seguridad

| Placeholder | Descripción | Ejemplo |
|-------------|-------------|---------|
| `{{ACCESS_HASH_SHA256}}` | Hash SHA-256 de la clave de acceso | `8e205329f16daafe72e758ed5e2625ba64bdca5f8e8c2d42185ed761f4edd2e7` |
| `{{SESSION_KEY}}` | Clave única en localStorage por cohorte | `navesint2026_access_granted` |
| `{{WEB3FORMS_KEY}}` | Access key del formulario Web3Forms de la cohorte | `1a9e51fd-2b8f-49b2-abc0-b992d3c6ca1a` |

## Cómo generar el hash SHA-256

Desde Python:
```python
import hashlib
clave = "Int2026NAVES"  # La clave en texto plano
hash_sha256 = hashlib.sha256(clave.encode()).hexdigest()
# Resultado: 8e205329f16daafe72e758ed5e2625ba64bdca5f8e8c2d42185ed761f4edd2e7
```

## Cómo generar el SESSION_KEY

Formato: `naves[modalidad_corta][año]_access_granted`

Ejemplos:
- Intensivo 2026 → `navesint2026_access_granted`
- Fin de Semana 2026 → `navesfs2026_access_granted`
- Intensivo 2027 → `navesint2027_access_granted`

## Checklist antes de generar el HTML

Antes de aplicar los reemplazos, verificar que se tienen TODOS estos valores:

- [ ] `ANIO`
- [ ] `MODALIDAD`
- [ ] `COHORTE_CORTA`
- [ ] `COHORTE_FULL`
- [ ] `COHORTE_FULL_DOT`
- [ ] `COHORTE_CORTA_EJEMPLO`
- [ ] `FECHA_LANZAMIENTO`
- [ ] `FECHA_LANZAMIENTO_COMPLETA`
- [ ] `FECHA_ANTEPROYECTO`
- [ ] `FECHA_ANTEPROYECTO_COMPLETA`
- [ ] `FECHA_ANTEPROYECTO_LARGA`
- [ ] `FECHA_VENTANA_R1`
- [ ] `FECHA_VENTANA_R1_LARGA`
- [ ] `FECHA_VENTANA_R2`
- [ ] `FECHA_VENTANA_R2_LARGA`
- [ ] `FECHA_60_DIAS`
- [ ] `FECHA_ENTREGA_FINAL`
- [ ] `FECHA_ENTREGA_FINAL_LARGA`
- [ ] `FECHA_PRESENTACIONES`
- [ ] `FECHA_PRESENTACIONES_LARGA`
- [ ] `DURACION_MESES`
- [ ] `DURACION_SEMANAS`
- [ ] `ACCESS_HASH_SHA256`
- [ ] `SESSION_KEY`
- [ ] `WEB3FORMS_KEY`

Total: **24 valores** que producen los 17 placeholders únicos (algunos placeholders aparecen varias veces en el template).
