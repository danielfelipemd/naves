# Skill: Generador de Sitio Web NAVES

Skill para generar el sitio web de una cohorte NAVES a partir de las 7 fechas clave del cronograma.

## Estructura

```
skill-naves-website/
├── SKILL.md                         ← Instrucciones detalladas para Claude
├── README.md                         ← Este archivo
├── template/
│   └── template.html                 ← Plantilla HTML con placeholders
├── reference/
│   └── mapa-placeholders.md          ← Documentación de cada placeholder
└── examples/
    └── ejemplo-int-2026.html         ← Ejemplo funcional
```

## Cómo usar la skill

Abrir una conversación con Claude que tenga acceso a esta skill y decir, por ejemplo:

> "Genera el sitio web NAVES para MBA Intensivo 2027. Fechas: Lanzamiento 11-12 mayo, Anteproyecto 25 mayo..."

Claude ejecuta 3 checkpoints de confirmación:
1. **Parámetros** (cohorte, fechas, credenciales)
2. **Formatos de texto** (cómo quedarán las fechas en el sitio)
3. **Confirmación final** antes de generar

Al terminar entrega un `index.html` listo para subir a Netlify.

## Inputs que debe tener listos el usuario

**Antes de invocar la skill:**

1. Las 7 fechas del cronograma (puede salir de la skill `Programación NAVES`)
2. Una clave de acceso pensada (ej: `Int2026NAVES`, `FS2026NAVES`)
3. Un formulario creado en Web3Forms con su access key copiada

## Proceso completo para una nueva cohorte

```
┌─────────────────────────────┐
│ 1. Correr Skill 1           │
│    "Programación NAVES"      │
│    → Obtener 13 hitos       │
└─────────────────────────────┘
              ↓
┌─────────────────────────────┐
│ 2. Crear formulario en       │
│    Web3Forms para la cohorte │
│    → Copiar access key       │
└─────────────────────────────┘
              ↓
┌─────────────────────────────┐
│ 3. Correr Skill 2            │
│    "Sitio Web NAVES" (esta)  │
│    → Obtener index.html      │
└─────────────────────────────┘
              ↓
┌─────────────────────────────┐
│ 4. Subir index.html a        │
│    Netlify (drag & drop)     │
│    → URL pública             │
└─────────────────────────────┘
              ↓
┌─────────────────────────────┐
│ 5. Compartir URL + clave     │
│    con los participantes     │
└─────────────────────────────┘
```

## Características del sitio generado

- ✅ Diseño completo con identidad INALDE
- ✅ 33 preguntas frecuentes en 6 categorías
- ✅ Timeline con 7 hitos
- ✅ Formulario de contacto (Web3Forms)
- ✅ Pantalla de acceso con clave (SHA-256)
- ✅ Anti-spam (honeypot + hCaptcha)
- ✅ Responsive (móvil + desktop)
- ✅ Archivo único, autónomo (logos embebidos)
- ✅ ~110 KB de tamaño

## Placeholders del template

El template tiene 17 tipos de placeholders que cubren:
- Cohorte (5)
- Fechas en 3 formatos: corto, completo, largo (9)
- Duración calculada: meses y semanas (2)
- Seguridad: hash, session key, Web3Forms key (3)

Ver `reference/mapa-placeholders.md` para el detalle completo.

## Relación con otras skills

Esta skill es **independiente** de la skill `Programación NAVES`. Puede funcionar sola si el usuario tiene las fechas a mano, o encadenada después de ella.

La decisión de hacerla independiente sigue el principio UNIX: *do one thing well*.

- `Programación NAVES` = cálculo de fechas a partir de calendario
- Esta skill = generación de sitio web a partir de fechas

---

Creada por Juan Manuel Vicaría (INALDE Business School) en colaboración con Claude (Anthropic).
