// Logo de la app: lo elige la administración (Admin → Ajustes) y se aplica a todos.
// Cambia el ícono dentro de la app, la pestaña del navegador, el ícono de inicio del iPhone
// y el manifest (Android lo toma al instalar o al actualizar la app instalada).
import { useEffect, useState } from 'react'

export const LOGOS = [
  { id: 'A', texto: 'Calendario con reloj' },
  { id: 'B', texto: 'Reloj de permuta' },
  { id: 'C', texto: 'Cronómetro' },
  { id: 'D', texto: 'Calendario de permuta' },
  { id: 'E', texto: 'Día y noche' },
]
const CLAVE = 'chambea.logo'
const EVENTO = 'chambea:logo'
const valido = (id) => (LOGOS.some((l) => l.id === id) ? id : 'A')

export const logoGuardado = () => { try { return valido(localStorage.getItem(CLAVE)) } catch { return 'A' } }
export const rutaLogo = (id, tam = '192') => `/icons/logos/${valido(id)}-${tam}.png`

function ponerEnlace(rel, href, extra = {}) {
  let el = document.querySelector(`link[rel="${rel}"]`)
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el) }
  el.href = href
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v)
}

let manifestUrl = null
export function aplicarLogo(id) {
  const k = valido(id)
  try { localStorage.setItem(CLAVE, k) } catch { /* nada */ }
  ponerEnlace('icon', `/icons/logos/${k}.svg`, { type: 'image/svg+xml' })
  ponerEnlace('apple-touch-icon', rutaLogo(k, 'apple'), { sizes: '180x180' })
  // Manifest: el logo A es el del archivo normal; los demás van en un manifest generado
  if (k === 'A') { ponerEnlace('manifest', '/manifest.webmanifest'); window.dispatchEvent(new CustomEvent(EVENTO, { detail: k })); return }
  try {
    const o = window.location.origin
    const manifest = {
      name: 'Chambea · Cambios de turno', short_name: 'Chambea', id: '/', lang: 'es',
      start_url: `${o}/`, scope: `${o}/`, display: 'standalone', orientation: 'portrait',
      background_color: '#f8fafc', theme_color: '#f8fafc',
      icons: [
        { src: `${o}${rutaLogo(k, '192')}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `${o}${rutaLogo(k, '512')}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `${o}${rutaLogo(k, 'maskable')}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
    if (manifestUrl) URL.revokeObjectURL(manifestUrl)
    manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }))
    ponerEnlace('manifest', manifestUrl)
  } catch { /* se queda el manifest normal */ }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: k }))
}

// Logo dentro de la app (se actualiza al cambiarlo)
export function useLogo() {
  const [k, setK] = useState(logoGuardado)
  useEffect(() => {
    const fn = (e) => setK(e.detail)
    window.addEventListener(EVENTO, fn)
    return () => window.removeEventListener(EVENTO, fn)
  }, [])
  return rutaLogo(k)
}
