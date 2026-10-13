# NAVES — Trabajo de grado del MBA de INALDE

Plataforma de la opción de grado NAVES (New Business Adventures) del MBA de
INALDE Business School: equipos, anteproyecto, selección del proyecto
definitivo, avances, proyecto final, actas firmadas y medición AoL.

Producción: **https://naves-inalde.com**

## Arquitectura

Tres servicios en el proyecto `naves` de EasyPanel, en el VPS del ecosistema
Netcloud. **NAVES tiene su propia base de datos aislada**: no comparte Supabase
con ningún otro sistema, y su configuración solo lleva lo que NAVES usa.

```
navegador ──► Cloudflare ──► Traefik (EasyPanel) ──► frontend  (nginx)
                                                       ├─ /        → la aplicación (React)
                                                       └─ /api/*   → backend (Express, puerto 3000, red interna)
                                                                       └──► bd (Supabase propio de NAVES)
navegador ──► Cloudflare ──► Traefik ──► bd (Kong :8000)   inicio de sesión y renovación del token
```

| Servicio | Tipo en EasyPanel | Origen | Qué es |
|---|---|---|---|
| `frontend` | app | este repo, carpeta `/frontend`, `Dockerfile` | React 18 + Vite + Tailwind, servido por nginx. nginx también reenvía `/api/*` al backend |
| `backend` | app | este repo, carpeta `/backend`, `Dockerfile` | Node 20 + Express + TypeScript. Toda la lógica: permisos, correos, PDF de actas, Excel, IA |
| `bd` | compose | plantilla `easypanel-io/compose`, rama `24-07-2026`, `/supabase/code` | Supabase autoalojado: Postgres 17, Auth (GoTrue), PostgREST, Storage, Kong |

Dominios: `naves-inalde.com` y `www.naves-inalde.com` → frontend;
`bdnaves.netcloudnetworking.cloud` → Kong de `bd`. Los dos pasan por
Cloudflare. El correo del dominio (Zoho: MX, SPF, DKIM) va sin proxy: no tocarlo.

### Por qué así

- **El navegador habla con el backend por el mismo dominio** (`/api` en nginx):
  sin CORS entre dominios y sin exponer el backend con un nombre propio.
- **El backend es el único que usa la llave `service_role`**, y solo en
  operaciones de administración. Lo que actúa en nombre de un usuario va con
  `supabaseForUser(jwt)` y respeta RLS. RLS es la barrera real.
- **Los permisos viven en la base**: `permisos_del_usuario` (RPC). El backend
  los consulta y los guarda 60 s por usuario (`auth/permissions.ts`). Tras
  cambiar roles, `invalidateUserPermisos` o esperar ese minuto.

## Autenticación

- **Participantes:** entran con la cédula. El frontend la convierte en un
  correo sintético (`<sha256(cédula)>@naves.local`) y con él inicia sesión en
  Supabase Auth. Clave inicial = la cédula; en el primer ingreso se obliga a
  cambiarla (`POST /api/auth/cambiar-clave-inicial`). El correo institucional
  real se guarda cifrado (`PII_ENCRYPTION_KEY`) para recuperación y avisos.
- **Profesores, panelistas y administración:** correo institucional real.
- El backend valida el JWT con `jose` contra el JWKS de Supabase
  (`/auth/v1/.well-known/jwks.json`); si el token es HS256 heredado, con
  `SUPABASE_JWT_SECRET`.
- El frontend renueva la sesión cada 10 min (`auth/store.ts`) para que un
  formulario largo no se pierda por un token vencido.

## Base de datos

- El esquema, RLS, funciones y auditoría están en **`backend/sql/`** (47
  archivos numerados). No hay ORM ni migraciones automáticas: se aplican a mano,
  en orden, por `POST https://bdnaves.netcloudnetworking.cloud/pg/query` con la
  llave `service_role`. Esa ruta **responde 200 aunque el SQL falle**: leer el
  cuerpo de la respuesta.
- PostgREST corta toda respuesta en 1000 filas sin avisar. Para listas que
  pueden crecer, usar `backend/src/lib/traerTodasLasFilas.ts`.
- Archivos (anteproyectos, trabajos de grado): bucket privado
  `trabajos-grado`, servido siempre con URL firmada. Hasta 25 MB por archivo
  (nginx admite 30 MB por el sobrecosto del multipart).

## Variables de entorno

Los valores viven en EasyPanel, nunca en el repo. Los ejemplos con los nombres
están en `backend/.env.example` y `frontend/.env.example`.

| Servicio | Variables |
|---|---|
| `frontend` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (se incrustan al construir: cambiarlas exige redesplegar) |
| `backend` | ver `backend/.env.example`, con lo que hace cada una |
| `bd` | solo las de la plantilla de Supabase. Nada de otros sistemas: el 13/10/2026 se quitaron 8 variables copiadas de CommerceAdmin (MATIAS, Mercado Pago, SMTP duplicadas) y el pool dejó de llamarse `commerceadmin` |

## Despliegue

Un push a `main` **no despliega**. Se despliega a mano, y en este orden:

1. **`backend`** primero (el frontend nuevo puede llamar rutas nuevas).
2. **`frontend`** cuando el backend ya responde.

`scripts/deploy-sequential.sh` hace los dos pasos con la API de EasyPanel y
espera a que cada uno responda. `--comprobar` solo verifica el acceso, sin
desplegar.

Ojo: EasyPanel a veces acepta la orden y no construye. Si tras unos minutos se
sigue viendo la versión anterior, relanzar.

`bd` no se redespliega con el código: es la base de producción. Solo hace falta
al cambiar su configuración, y antes hay que comprobar que las imágenes de la
plantilla son las mismas que están corriendo.

## Límites conocidos

- **Límite de intentos** (`server.ts`), por persona y por hora, solo en rutas
  públicas: 200 en `/api/auth/verificar-cedula`, 100 en `/api/auth/recovery`
  (y `/confirm`), 5000 en `/api/ciiu`. Las rutas con sesión no tienen límite:
  las protege el token. La IP real sale de `CF-Connecting-IP`
  (`lib/ip-cliente.ts`), no de `req.ip`: delante hay tres saltos (Cloudflare,
  Traefik, nginx) y `req.ip` es la de Traefik, igual para todos. Los topes
  asumen una cohorte entera entrando desde la misma red del campus. El contador
  vive en memoria: reiniciar el backend lo pone en cero.
- El login de participantes solo consulta `verificar-cedula` cuando la clave
  falla (para decir si la cédula no está inscrita), y el perfil (`/auth/me`)
  no se vuelve a pedir en cada renovación del token.
- El backend habla con la base por la red interna (`SUPABASE_INTERNAL_URL`).
  Si al arrancar no responde en 3 s, usa el dominio público y lo dice en
  `GET /api/health` → `supabase: "publica"`.
- `bd` sale de la plantilla genérica de EasyPanel y no de un repo propio
  (`naves-supabase`), como los demás sistemas del ecosistema.
- Peticiones del frontend: 15 s de espera máxima (`lib/api.ts`). nginx da 120 s
  a las subidas.

## Estructura

```
backend/          API Express (routes/ por dominio, services/ con la lógica pesada)
backend/sql/      esquema, RLS, funciones y auditoría, numerados
frontend/         aplicación React (pages/ partido por rol: admin, participante, profesor, panelista, publico)
scripts/          despliegue
docs/manual/          manual de usuario
docs/Emails_Sistema_NAVES.docx   textos de los correos que envía el sistema
docs/plan/            plan de desarrollo
docs/informe/         informes de avance, auditoría y costos
docs/aol/             preguntas del módulo AoL
docs/tecnica/         documentación técnica del panel de evaluación y la programación
docs/historico/       documentos de diseño anteriores a la implementación (no describen el sistema actual)
docs/insumos-inalde/  documentos recibidos de INALDE
```
