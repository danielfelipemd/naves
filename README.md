# NAVES — Anteproyecto INALDE Business School

Sistema para gestionar el anteproyecto del MBA de INALDE Business School (NAVES — New Business Adventures).

## Arquitectura

```
Frontend (React + Vite + Nginx)  ──┐
                                    │
                                    ├──>  Supabase (Postgres + Auth + RLS + Storage)
                                    │
Backend  (Node + Express + TS)    ──┘
```

3 contenedores en EasyPanel server `147.79.74.179`, proyecto `naves`. Comunicación interna via red Docker.

## Estructura

```
backend/    Node + Express + TS — API completa: auth, CRUD, ingesta Excel, sábana, emails
frontend/   React + Vite + Tailwind — UI con identidad INALDE (rojo, dorado, Montserrat)
backend/sql/  Migraciones de schema, RLS y auditoría
```

## Auth

- **Participantes:** login con cédula. La cédula se convierte a email sintético `<sha256(cedula)>@naves.local` que se usa contra Supabase Auth. El email institucional real se guarda encriptado para recuperación de clave y notificaciones.
- **Profesores y super admin:** login con email institucional real.

## Variables de entorno

Ver `.env.example` en cada subcarpeta. Los secretos del Supabase compartido se encuentran en el panel de EasyPanel del proyecto `n8n/supabase`.
