// Modo claro / oscuro / sistema. Se guarda en este dispositivo.
let quitarEscucha = null

export function aplicarModo(modo = 'sistema') {
  const raiz = document.documentElement
  quitarEscucha?.()
  quitarEscucha = null
  const poner = (oscuro) => {
    raiz.classList.toggle('dark', oscuro)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#0a0f1c' : '#f8fafc')
  }
  if (modo === 'sistema') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    poner(mq.matches)
    const fn = (e) => poner(e.matches)
    mq.addEventListener('change', fn)
    quitarEscucha = () => mq.removeEventListener('change', fn)
  } else {
    poner(modo === 'oscuro')
  }
  try { localStorage.setItem('chambea.modo', modo) } catch { /* sin almacenamiento */ }
}

export const modoGuardado = () => {
  try { return localStorage.getItem('chambea.modo') || 'sistema' } catch { return 'sistema' }
}

export const temaInicial = () => aplicarModo(modoGuardado())

export const vibrar = (ms = 12) => {
  try { navigator.vibrate?.(ms) } catch { /* no disponible */ }
}
