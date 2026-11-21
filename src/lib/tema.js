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

// ---------- Preferencias de este dispositivo: tamaño de letra y vibración ----------
const leer = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }

export const letraGuardada = () => leer('chambea.letra', 'normal')
export function aplicarLetra(tam = 'normal') {
  document.documentElement.classList.toggle('letra-grande', tam === 'grande')
  guardar('chambea.letra', tam)
}

export const vibracionActiva = () => leer('chambea.vibrar', '1') === '1'
export const guardarVibracion = (si) => guardar('chambea.vibrar', si ? '1' : '0')

// Color principal de la app
export const ACENTOS = [
  { id: 'verde', texto: 'Verde', color: '#0f5f52' },
  { id: 'azul', texto: 'Azul', color: '#1d4ed8' },
  { id: 'vino', texto: 'Vino', color: '#9f1239' },
  { id: 'naranja', texto: 'Naranja', color: '#c2410c' },
  { id: 'grafito', texto: 'Grafito', color: '#334155' },
]
export const acentoGuardado = () => leer('chambea.acento', 'verde')
export function aplicarAcento(id = 'verde') {
  const a = ACENTOS.find((x) => x.id === id) || ACENTOS[0]
  document.documentElement.style.setProperty('--color-marca', a.color)
  guardar('chambea.acento', a.id)
}

// Menos movimiento (además de lo que pida el sistema)
export const animacionesGuardadas = () => leer('chambea.animaciones', '1') === '1'
export function aplicarAnimaciones(si = true) {
  document.documentElement.classList.toggle('sin-animaciones', !si)
  guardar('chambea.animaciones', si ? '1' : '0')
}

// Pantalla al abrir la app y si se ven las pausas en las tarjetas del horario
export const pantallaInicial = () => leer('chambea.pantalla', 'inicio')
export const guardarPantallaInicial = (v) => guardar('chambea.pantalla', v)
export const pausasVisibles = () => leer('chambea.pausas', '1') === '1'
export const guardarPausasVisibles = (si) => guardar('chambea.pausas', si ? '1' : '0')

export const temaInicial = () => {
  aplicarModo(modoGuardado()); aplicarLetra(letraGuardada()); aplicarAcento(acentoGuardado()); aplicarAnimaciones(animacionesGuardadas())
}

export const vibrar = (ms = 12) => {
  if (!vibracionActiva()) return
  try { navigator.vibrate?.(ms) } catch { /* no disponible */ }
}
