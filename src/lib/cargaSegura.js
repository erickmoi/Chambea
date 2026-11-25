// Carga de pantallas por partes (lazy) a prueba de actualizaciones:
// si después de publicar una versión nueva la pieza vieja ya no existe, recarga la app una vez.
import { lazy } from 'react'

const CLAVE = 'chambea.recargaPorVersion'

export function lazySeguro(importar) {
  return lazy(async () => {
    try {
      const m = await importar()
      try { sessionStorage.removeItem(CLAVE) } catch { /* nada */ }
      return m
    } catch (e) {
      let ultima = 0
      try { ultima = Number(sessionStorage.getItem(CLAVE) || 0) } catch { /* nada */ }
      if (Date.now() - ultima > 30000) {
        try { sessionStorage.setItem(CLAVE, String(Date.now())) } catch { /* nada */ }
        // Borra la caché del service worker para traer la versión nueva completa
        try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))) } catch { /* nada */ }
        window.location.reload()
        return new Promise(() => {}) // espera la recarga
      }
      throw e
    }
  })
}
