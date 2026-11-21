// ¿Hay una versión nueva publicada? Compara la huella de esta app con /version.json
import { useEffect, useState } from 'react'

/* global __VERSION__ */
const ESTA = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev'

async function versionPublicada() {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()).version
  } catch { return null }
}

export function useActualizacion() {
  const [hay, setHay] = useState(false)
  useEffect(() => {
    if (!import.meta.env.PROD) return
    const revisar = async () => {
      const v = await versionPublicada()
      if (v && v !== ESTA) setHay(true)
    }
    revisar()
    const t = setInterval(revisar, 15 * 60_000)
    const alVolver = () => document.visibilityState === 'visible' && revisar()
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [])
  return hay
}

export async function actualizarAhora() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
  } catch { /* nada */ }
  window.location.reload()
}
