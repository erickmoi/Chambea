# Chambea

Bolsa de cambios de turno entre compañeros de triaje: **Planilla** y **Servicios Profesionales (SP)**.
Los acuerdos se registran aquí; el trámite con jefatura sigue en físico.

- Frontend: React + Vite + Tailwind (PWA) · Netlify
- Backend: Supabase (Postgres + Auth). Toda escritura pasa por funciones; las tablas solo se leen con RLS.

## Funciones
- Registro con usuario, PIN y WhatsApp; enlace automático con el nombre del horario.
- Mi horario (agenda, semana, mes), exportar a .ics/.csv, caché sin conexión.
- Buscar con quién cambiar (sin turnos de planilla pegados) y propuesta directa.
- Bolsa: permuta, ceder, pedir cobertura y "busco turno"; deshacer cambios.
- Avisos en la app, push en el celular (Edge Function `push`) y WhatsApp.
- Admin: usuarios, funciones de cada persona, cargar horario con historial de archivos.

## Estructura
- `supabase/migrations/` — esquema, reglas y funciones (aplicadas en el proyecto Chambea).
- `src/lib/importador.js` — lee el .xlsx oficial (hojas PLANILLA y SP TRIAGE).
- `src/pages/admin/Importar.jsx` — pantalla para cargar el horario con vista previa.

## Probar el importador sin la app
```
npm install
npm run probar-importador -- ruta/al/HORARIO.xlsx
```
