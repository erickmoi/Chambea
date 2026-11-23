// Deslizar con el dedo a izquierda/derecha para cambiar de mes, semana o sección.
// Ignora gestos verticales, los que empiezan en algo que ya se desplaza de lado (filas de chips, tablas anchas)
// y los que empiezan cerca del borde de la pantalla (gesto de "atrás" del sistema).
import { useEffect, useRef } from 'react'
import { vibrar } from './tema'

function seDesplazaDeLado(el, raiz) {
  for (let n = el; n && n !== raiz; n = n.parentElement) {
    if (n.dataset?.sinDeslizar !== undefined) return true
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

// onSiguiente: dedo hacia la izquierda · onAnterior: dedo hacia la derecha
// Devuelve el ref que va en el contenedor
export function useDeslizar({ onSiguiente, onAnterior, activo = true }) {
  const ref = useRef(null)
  const fn = useRef({ onSiguiente, onAnterior })
  fn.current = { onSiguiente, onAnterior }

  useEffect(() => {
    const raiz = ref.current
    if (!raiz || !activo) return
    let x0 = 0, y0 = 0, t0 = 0, vale = false

    const inicio = (e) => {
      if (e.touches.length !== 1) { vale = false; return }
      const t = e.touches[0]
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now()
      vale = t.clientX > 24 && t.clientX < window.innerWidth - 24 && !seDesplazaDeLado(e.target, raiz)
    }
    const fin = (e) => {
      if (!vale) return
      vale = false
      const t = e.changedTouches[0]
      const dx = t.clientX - x0, dy = t.clientY - y0
      const rapido = Date.now() - t0 < 600
      if (Math.abs(dx) < (rapido ? 50 : 90) || Math.abs(dx) < Math.abs(dy) * 1.6) return
      if (dx < 0 && fn.current.onSiguiente) { vibrar(8); fn.current.onSiguiente() }
      if (dx > 0 && fn.current.onAnterior) { vibrar(8); fn.current.onAnterior() }
    }
    const cancelar = () => { vale = false }

    raiz.addEventListener('touchstart', inicio, { passive: true })
    raiz.addEventListener('touchend', fin, { passive: true })
    raiz.addEventListener('touchcancel', cancelar, { passive: true })
    return () => {
      raiz.removeEventListener('touchstart', inicio)
      raiz.removeEventListener('touchend', fin)
      raiz.removeEventListener('touchcancel', cancelar)
    }
  }, [activo])

  return ref
}

// Clase de animación según hacia dónde se avanzó: 1 = siguiente, -1 = anterior
export const claseDeslizar = (dir) => (dir > 0 ? 'entrar-der' : dir < 0 ? 'entrar-izq' : 'animar-entrada')
