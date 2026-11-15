# Chambea

Bolsa de cambios de turno entre compañeros de triaje: **Planilla** y **Servicios Profesionales (SP)**.
Los acuerdos se registran aquí; el trámite con jefatura sigue en físico.

- Frontend: React + Vite + Tailwind (PWA) · Netlify
- Backend: Supabase (Postgres + Auth). Toda escritura pasa por funciones; las tablas solo se leen con RLS.

## Estructura
- `supabase/migrations/` — esquema, reglas y funciones (aplicadas en el proyecto Chambea).
- `src/lib/importador.js` — lee el .xlsx oficial (hojas PLANILLA y SP TRIAGE).
- `src/pages/admin/Importar.jsx` — pantalla para cargar el horario con vista previa.

## Probar el importador sin la app
```
npm install
npm run probar-importador -- ruta/al/HORARIO.xlsx
```
