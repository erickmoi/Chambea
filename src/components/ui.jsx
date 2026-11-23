import { useEffect, useMemo, useRef, useState } from 'react'
import Icono from './Icono'

export function Aviso({ aviso, onCerrar }) {
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(onCerrar, 3500)
    return () => clearTimeout(t)
  }, [aviso, onCerrar])
  if (!aviso) return null
  const color = aviso.tipo === 'error' ? 'bg-red-700' : 'bg-emerald-700'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top)+var(--espacio-arriba))] z-[60] flex justify-center px-4">
      <div
        key={aviso.texto}
        role={aviso.tipo === 'error' ? 'alert' : 'status'}
        onClick={onCerrar}
        className={`${color} animar-entrada pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg`}
      >
        <Icono n={aviso.tipo === 'error' ? 'alerta' : 'ok'} size={20} />
        {aviso.texto}
      </div>
    </div>
  )
}

// Esqueleto de carga genérico (lista de tarjetas)
export function Cargando({ filas = 4 }) {
  return (
    <div className="space-y-3 py-2" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="esqueleto h-16" />
      ))}
    </div>
  )
}

export function Vacio({ children }) {
  return <p className="animar-entrada py-8 text-center text-sm text-slate-500">{children}</p>
}

// Pila de ventanas abiertas: Escape cierra solo la de arriba
const pila = []
const ENFOCABLES = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export function Hoja({ titulo, icono, onCerrar, children, ancho = 'max-w-lg', encima = false }) {
  const caja = useRef(null)
  const cerrarRef = useRef(onCerrar)
  cerrarRef.current = onCerrar
  const idTitulo = useMemo(() => `hoja-${Math.random().toString(36).slice(2, 8)}`, [])

  useEffect(() => {
    const yo = {}
    pila.push(yo)
    const antes = document.activeElement
    const primero = caja.current?.querySelector('[data-autofoco]') || caja.current
    primero?.focus({ preventScroll: true })
    const tecla = (e) => {
      if (pila[pila.length - 1] !== yo) return
      if (e.key === 'Escape') { e.stopPropagation(); cerrarRef.current() }
      if (e.key === 'Tab' && caja.current) {
        // El foco no sale de la ventana
        const els = [...caja.current.querySelectorAll(ENFOCABLES)].filter((el) => el.offsetParent !== null)
        if (!els.length) return
        const [ini, fin] = [els[0], els[els.length - 1]]
        if (e.shiftKey && document.activeElement === ini) { e.preventDefault(); fin.focus() }
        else if (!e.shiftKey && document.activeElement === fin) { e.preventDefault(); ini.focus() }
      }
    }
    window.addEventListener('keydown', tecla)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', tecla)
      pila.splice(pila.indexOf(yo), 1)
      if (!pila.length) document.body.style.overflow = ''
      antes?.focus?.({ preventScroll: true })
    }
  }, [])

  return (
    <div className={`animar-fondo fixed inset-0 ${encima ? 'z-[55]' : 'z-40'} flex items-end justify-center bg-black/50 sm:items-center`} onClick={onCerrar}>
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className={`hoja-fondo animar-hoja max-h-[90vh] w-full ${ancho} overflow-y-auto rounded-t-3xl bg-superficie p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-2xl outline-none sm:rounded-3xl sm:pb-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto -mt-2 mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 id={idTitulo} className="flex items-center gap-2 text-lg font-bold text-slate-900">
            {icono && <Icono n={icono} size={24} className="text-marca-texto" />}{titulo}
          </h2>
          <button onClick={onCerrar} className="boton-icono text-slate-600" aria-label="Cerrar">
            <Icono n="cerrar" size={20} weight="bold" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------- Confirmaciones propias (en vez del confirm() del navegador) ----------
// Uso: if (await confirmar({ titulo, texto, boton: 'Deshacer', peligro: true })) { ... }
let abrirConfirmacion = null
export function confirmar(opciones) {
  return new Promise((resolver) => {
    if (!abrirConfirmacion) return resolver(window.confirm(opciones.texto || opciones.titulo))
    abrirConfirmacion({ ...opciones, resolver })
  })
}

export function RaizConfirmar() {
  const [c, setC] = useState(null)
  useEffect(() => { abrirConfirmacion = setC; return () => { abrirConfirmacion = null } }, [])
  if (!c) return null
  const fin = (si) => { c.resolver(si); setC(null) }
  return (
    <Hoja titulo={c.titulo || '¿Seguro?'} icono={c.icono || (c.peligro ? 'alerta' : 'info')} onCerrar={() => fin(false)} ancho="max-w-sm" encima>
      {c.texto && <p className="text-slate-700">{c.texto}</p>}
      <div className="mt-5 flex gap-2">
        <button className="btn-secundario flex-1" onClick={() => fin(false)}>{c.cancelar || 'Volver'}</button>
        <button data-autofoco className={`${c.peligro ? 'btn-peligro-solido' : 'btn-primario'} flex-1`} onClick={() => fin(true)}>{c.boton || 'Sí, continuar'}</button>
      </div>
    </Hoja>
  )
}

export function Contador({ valor, onMenos, onMas, maxAlcanzado }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onMenos}
        disabled={valor === 0}
        className="h-9 w-9 rounded-full bg-slate-100 text-lg font-bold text-slate-700 transition active:scale-90 disabled:opacity-30"
        aria-label="Quitar uno"
      >
        −
      </button>
      <span key={valor} className="animar-pop w-6 text-center font-semibold tabular-nums">{valor}</span>
      <button
        onClick={onMas}
        disabled={maxAlcanzado}
        className="h-9 w-9 rounded-full bg-marca text-lg font-bold text-sobre-marca transition active:scale-90 disabled:opacity-30"
        aria-label="Agregar uno"
      >
        +
      </button>
    </div>
  )
}

// Pantalla de éxito con check animado y confeti
const COLORES_CONFETI = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#a855f7', '#ec4899']
export function Exito({ texto, sub, onFin }) {
  useEffect(() => {
    const t = setTimeout(onFin, 1700)
    return () => clearTimeout(t)
  }, [onFin])

  const piezas = useMemo(
    () =>
      Array.from({ length: 36 }).map((_, i) => ({
        left: `${Math.random() * 100}%`,
        background: COLORES_CONFETI[i % COLORES_CONFETI.length],
        animationDelay: `${Math.random() * 0.25}s`,
        '--dx': `${(Math.random() - 0.5) * 120}px`,
        '--rot': `${360 + Math.random() * 540}deg`,
      })),
    [],
  )

  return (
    <div className="animar-fondo fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/30" onClick={onFin}>
      {piezas.map((s, i) => <span key={i} className="confeti" style={s} />)}
      <div className="animar-hoja flex flex-col items-center rounded-3xl bg-superficie px-10 py-8 shadow-2xl">
        <svg viewBox="0 0 52 52" className="h-20 w-20">
          <circle cx="26" cy="26" r="24" fill="var(--color-marca)" />
          <path className="check-trazo" d="M15 27 l7 7 l15 -16" fill="none" stroke="var(--color-sobre-marca)"
            strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-4 text-xl font-bold text-slate-900">{texto}</p>
        {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
      </div>
    </div>
  )
}

export function Interruptor({ activo, onCambio, etiqueta, ayuda, disabled }) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : ''}`}>
      <span>
        <span className="block font-medium text-slate-800">{etiqueta}</span>
        {ayuda && <span className="text-sm text-slate-500">{ayuda}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        disabled={disabled}
        onClick={() => onCambio(!activo)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${activo ? 'bg-marca' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${activo ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  )
}
