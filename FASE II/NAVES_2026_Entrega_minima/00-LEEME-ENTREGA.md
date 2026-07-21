# NAVES 2026 — Entrega al desarrollador

> ⚠️ **VERSIÓN MÍNIMA (solo código + documentación).** No incluye los one pagers
> (`sitio/pdfs/`) ni los logos (`sitio/logos/`) de los proyectos.
>
> **Salvedad importante:** la información de los proyectos y sus logos **no van
> hardcodeados**. En el sistema definitivo se toman de la **plataforma de gestión
> integral de trabajos de grado** de INALDE (ese formato ya diseñado es la fuente de verdad); el
> sitio NAVES los consume desde ahí. Ver las notas en `sitio/pdfs/` y `sitio/logos/`.
>
> Para el material actual completo, pida el ZIP `NAVES_2026_Entrega.zip`.

Sistema web del trabajo de grado **NAVES** (Executive MBA de INALDE Business School).
Este paquete contiene **todo el código, el motor generador, las plantillas y la documentación**.
Los **accesos a hosting y cuentas** (Netlify, JSONbin, EmailJS, Anthropic) se entregan por
invitación — ver `01-CREDENCIALES-Y-ACCESOS.md`.

> **Empiece por la documentación técnica** (`DOCUMENTACION_TECNICA.pdf` / `.md`): explica el
> sistema completo, sección por sección, en el orden real del flujo (primero se construye la
> base de datos, luego los archivos que la consumen).

---

## 1. Qué hay en este paquete

```
NAVES_2026_Entrega/
├── 00-LEEME-ENTREGA.md            ← este archivo
├── 01-CREDENCIALES-Y-ACCESOS.md   ← credenciales + a quién invitar (COMPARTIR EN PRIVADO)
├── DOCUMENTACION_TECNICA.pdf      ← documentación completa (empezar aquí)
├── DOCUMENTACION_TECNICA.md       ← misma doc, editable
│
├── sitio/                         ← lo que se publica en Netlify (navesfs.netlify.app)
│   ├── index.html                 ← base de datos de proyectos (posts, one pagers, programación)
│   ├── panelistas.html            ← panel de panelistas (confirmar asistencia + logística)
│   ├── admin.html                 ← panel del coordinador (logística, emails, export)
│   ├── programador.html           ← generador de cronograma + Excel de calificación
│   ├── generador-cohorte.html     ← PROTOTIPO en pausa (lector de calendario con IA)
│   ├── emailjs.min.js             ← librería EmailJS (envío de correos desde el cliente)
│   ├── netlify.toml               ← config de build/deploy de Netlify
│   ├── logos/                     ← logos de los 34 proyectos
│   ├── pdfs/                      ← one pagers (material fuente de cada proyecto)
│   └── netlify/functions/         ← funciones serverless (del prototipo de calendario)
│
└── motor/                         ← el generador que CONSTRUYE index.html
    ├── naves_generator.py         ← script principal (lee fuentes → genera index.html)
    ├── calcular-hitos-naves.py    ← motor de los 13 hitos del cronograma
    ├── template-website-naves.html← plantilla del sitio-cohorte (26 placeholders)
    ├── mapa-placeholders-website-naves.md
    ├── SKILL-website-naves.md      ← instrucciones del skill de generación del website
    ├── SKILL-programacion-naves.md ← instrucciones del skill de programación
    ├── README-website-naves.md
    └── Plantilla-Programacion-NAVES.xlsx
```

---

## 2. Arquitectura en una frase

Sitios **HTML estáticos sin back-end propio**, servidos por **Netlify**. La persistencia
(confirmaciones de panelistas, programación) se hace contra servicios externos gratuitos:
**JSONbin** (base de datos JSON) y **EmailJS** (envío de correos). El **motor Python** genera
`index.html` a partir de las fuentes (one pagers, calendario). Ver §2 de la doc técnica.

Flujo real (mismo orden de la documentación):
`naves_generator.py` (construye) → `index.html` (base de datos) → `panelistas.html` /
`admin.html` (consumen) → `programador.html` → *Generador de Cohorte* (en pausa).

---

## 3. Cómo correr el sitio localmente

Requiere Node y la CLI de Netlify (`npm i -g netlify-cli`).

```bash
cd sitio
netlify dev        # levanta el sitio + las funciones en local (http://localhost:8888)
```

O, para solo ver los HTML sin funciones, abrir `sitio/index.html` en el navegador
(los paneles con JSONbin/EmailJS funcionan igual porque llaman a las APIs por HTTPS).

## 4. Cómo desplegar a producción

El sitio productivo es **navesfs.netlify.app** (site id en `01-CREDENCIALES`).

```bash
cd sitio
netlify deploy                  # despliegue de PRUEBA (draft, URL temporal)
netlify deploy --prod           # despliegue a PRODUCCIÓN
```

> ⚠️ Al desplegar, confirme que apunta al sitio **navesfs** (no a otro). Ver §12 de la doc.

## 5. Cómo regenerar `index.html` con el motor

```bash
cd motor
python3 naves_generator.py      # revisar rutas de entrada al inicio del script
```

> ⚠️ **Requisito de diseño obligatorio** (§5.4 y §17.4b de la doc): los resúmenes y posts
> de LinkedIn de cada proyecto deben generarse **siempre por IA leyendo el one pager real**
> (con visión si el PDF es imagen), **nunca hardcodeados**. La versión actual del script
> tenía textos incrustados que causaron descripciones erróneas — esto se corrige en la
> migración a Supabase. No regenerar con la lógica vieja sin leer §5.4 antes.

---

## 6. Estado y pendientes (ver §16 y §17 de la doc)

- **Prototipo en pausa:** `generador-cohorte.html` + funciones Netlify — lector de calendario
  con IA. Se difirió por límites del plan de Netlify; se retoma en **Supabase**.
- **Migración recomendada:** a Supabase (Edge Functions con IA + visión). §17 tiene el plan
  y el orden de migración; §17.4b especifica la función `generar-descripciones`.
- **Deuda técnica conocida:** credenciales de JSONbin/EmailJS expuestas en el cliente (propio
  de un sitio estático). Al asumir el proyecto, **rotar** esas llaves y moverlas al back-end.
  Ver §13 (Limitaciones) de la doc.
