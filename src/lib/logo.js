// Logo de la app: lo elige la administración (Admin → Ajustes) y se aplica a todos.
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

// Dentro de la app el cambio es inmediato. El ícono de inicio, la pestaña y el manifest
// los sirve la función "marca" (Netlify reenvía /marca/* y /manifest.webmanifest), así
// siempre coinciden con el logo elegido aunque la app se instale después.
export function aplicarLogo(id) {
  const k = valido(id)
  try { localStorage.setItem(CLAVE, k) } catch { /* nada */ }
  const icono = document.querySelector('link[rel="icon"]')
  if (icono) icono.href = `/icons/logos/${k}.svg`
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
