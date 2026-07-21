# Credenciales y accesos — NAVES 2026

> ⚠️ **CONFIDENCIAL.** Este archivo contiene llaves y accesos. Compártalo con el desarrollador
> por un canal privado (no lo suba a repositorios públicos ni lo mande a listas de correo).
> Cuando el desarrollador asuma el proyecto, **rote todas estas llaves**.

---

## A. Hosting — Netlify

- **Sitio en producción:** https://navesfs.netlify.app
- **Site ID:** `ad350064-29db-474f-bbaa-3eafbbb11b48`
- **Publica:** carpeta `sitio/` (raíz `.`) · **Funciones:** `netlify/functions`
- **Variable de entorno (secreta):** `ANTHROPIC_API_KEY` — está configurada en Netlify
  (Site settings → Environment variables). **No está en el código** y no debe estarlo.
  La usa la función del lector de calendario (prototipo en pausa).

### Cómo invitar al desarrollador (queda como colaborador, usted sigue de dueño)
1. Entre a https://app.netlify.com → equipo/cuenta que contiene el sitio *navesfs*.
2. **Team → Members → Invite members** e ingrese el correo del desarrollador.
   - (Invitar miembros de equipo puede requerir plan pago. Alternativa: en el sitio,
     compartir acceso, o transferir el sitio si prefiere — pero eso es entregar la propiedad.)
3. Pídale que instale la CLI: `npm i -g netlify-cli` y haga `netlify login`.

---

## B. Base de datos — JSONbin.io  (https://jsonbin.io)

- **Master Key:** `$2a$10$qBXsMcldU3zo7WzTazFhWeOrAvogSvSHw7bvSUBGWonD7zbLdj9hG`
- **Bins:**
  - Logística de panelistas: `6a2874d6f5f4af5e29d436aa`
  - Programación: `6a2f33e2da38895dfec095a4`
  - (Resultados del lector de calendario — prototipo)
- Esta Master Key hoy está **incrustada en el cliente** (`panelistas.html`, `admin.html`,
  `programador.html`) y en las funciones. Es una limitación conocida del sitio estático.

### Cómo dar acceso
- JSONbin no tiene "colaboradores": comparta la cuenta (usuario/clave) por canal privado,
  **o** cree bins nuevos bajo la cuenta del desarrollador y migre los datos.
- **Recomendado al asumir:** generar una Master Key nueva y actualizar los archivos.

---

## C. Correos — EmailJS  (https://dashboard.emailjs.com)

- **Public Key:** `LKIjrtq_CeLR_3Do6`
- **Service ID:** `service_6g8bgqk`
- **Template ID:** `template_jow68si`
- Se usan en `panelistas.html` y `admin.html` para enviar confirmaciones.

### Cómo dar acceso
- Comparta la cuenta de EmailJS por canal privado, o el desarrollador crea su propio
  service/template y actualiza esos tres IDs en el código.

---

## D. IA — Anthropic (Claude)  (https://console.anthropic.com)

- La API key vive **solo** como variable de entorno `ANTHROPIC_API_KEY` en Netlify
  (ver sección A). **Nunca** ha estado en el código ni debe estarlo.
- Modelo usado por el prototipo: `claude-opus-4-8`.
- Para dar acceso: en la consola de Anthropic, invite al desarrollador a la organización,
  o genere una API key nueva para él y actualice la variable de entorno en Netlify.

---

## E. Dominio (si aplica)

- La documentación menciona `naves-inalde.com` como destino de la plataforma integrada
  (§16). Si el dominio está registrado, dé acceso al panel del registrador / DNS.

---

## Checklist de entrega

- [ ] Enviar el ZIP con el código y la documentación (canal normal).
- [ ] Enviar este archivo por canal privado.
- [ ] Netlify: invitar al desarrollador (sección A).
- [ ] JSONbin: compartir cuenta o migrar bins (sección B).
- [ ] EmailJS: compartir cuenta o migrar service/template (sección C).
- [ ] Anthropic: invitar a la organización o entregar API key (sección D).
- [ ] Al terminar la transición: **rotar todas las llaves** de este documento.
