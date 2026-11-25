// Sonido de Chambea cuando llega un aviso con la app abierta: un solo tono breve y suave (se genera, sin archivos).
// Con la app cerrada suena el tono del celular.
const CLAVE = 'chambea.sonido'
export const sonidoActivo = () => { try { return localStorage.getItem(CLAVE) !== '0' } catch { return true } }
export const guardarSonido = (si) => { try { localStorage.setItem(CLAVE, si ? '1' : '0') } catch { /* nada */ } }

let ctx = null
const audio = () => {
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)() } catch { return null }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}
// Los navegadores solo dejan sonar después de un toque: se prepara el audio con el primer toque en la app
export function prepararSonido() {
  window.addEventListener('pointerdown', () => audio(), { once: true })
}

let ultimo = 0
export function sonar(forzar = false) {
  if (!forzar && !sonidoActivo()) return
  if (Date.now() - ultimo < 1500) return // nunca dos veces seguidas
  ultimo = Date.now()
  const c = audio()
  if (!c) return
  // Una nota tipo campanita (con un armónico suave), ~0.4 s
  const t = c.currentTime
  for (const [frec, vol] of [[988, 0.16], [1976, 0.04]]) {
    const o = c.createOscillator(); const g = c.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(frec, t)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.45)
  }
  try { navigator.vibrate?.(150) } catch { /* no disponible */ }
}
