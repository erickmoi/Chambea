// Armazón: navegación inferior (celular) o lateral (PC), campanita, enlaces directos y novedades
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useAuth, esAdmin } from './lib/auth'
import Login from './pages/Login.jsx'
import Pendiente from './pages/Pendiente.jsx'
import Calendario from './pages/Calendario.jsx'
import Bolsa from './pages/Bolsa.jsx'
import MiCuenta from './pages/MiCuenta.jsx'
import Solicitud from './components/Solicitud.jsx'
import { useAvisos, BotonAvisos, HojaNotificaciones } from './components/Avisos.jsx'
import Icono from './components/Icono'
import { Aviso, Cargando, Hoja } from './components/ui'
import { NOVEDADES, hayNovedades, marcarNovedadesVistas } from './lib/version'

const Usuarios = lazy(() => import('./pages/admin/Usuarios.jsx'))
const Importar = lazy(() => import('./pages/admin/Importar.jsx'))

const VISTAS_ADMIN = ['usuarios', 'importar']
const params = () => new URLSearchParams(window.location.search)

export default function App() {
  const { session, cuenta, cargando } = useAuth()
  const [vista, setVista] = useState(() => params().get('vista') || 'horario')
  const [solicitud, setSolicitud] = useState(() => Number(params().get('solicitud')) || null)
  const [aviso, setAviso] = useState(null)
  const [verAvisos, setVerAvisos] = useState(false)
  const [novedades, setNovedades] = useState(false)
  const [recarga, setRecarga] = useState(0)
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)
  const listo = !!(session && cuenta?.activo && cuenta?.aprobado)
  const { lista, cargar: recargarAvisos, sinLeer } = useAvisos(listo)

  const avisar = useCallback((texto, tipo = 'ok') => setAviso({ texto, tipo }), [])
  const cerrarAviso = useCallback(() => setAviso(null), [])

  // La URL refleja la vista y la solicitud abierta (para enlaces de avisos y WhatsApp)
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('vista')
    url.searchParams.delete('solicitud')
    if (vista !== 'horario') url.searchParams.set('vista', vista)
    if (solicitud) url.searchParams.set('solicitud', solicitud)
    window.history.replaceState(null, '', url)
  }, [vista, solicitud])

  useEffect(() => {
    const on = () => setEnLinea(true)
    const off = () => setEnLinea(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => { if (listo && hayNovedades()) setNovedades(true) }, [listo])

  if (cargando) return <div className="mx-auto max-w-lg p-6"><Cargando /></div>
  if (!session) return <Login />
  if (!listo) return <Pendiente />

  const admin = esAdmin(cuenta)
  const actual = VISTAS_ADMIN.includes(vista) && !admin ? 'horario' : vista
  const pestanas = [
    { id: 'horario', texto: 'Horario', icono: 'calendario' },
    { id: 'bolsa', texto: 'Bolsa', icono: 'cambio' },
    ...(admin ? [{ id: 'usuarios', texto: 'Usuarios', icono: 'usuarios' }, { id: 'importar', texto: 'Cargar', icono: 'excel' }] : []),
    { id: 'cuenta', texto: 'Cuenta', icono: 'cuenta' },
  ]

  const irA = (url) => {
    setVerAvisos(false)
    if (!url) return
    const p = new URL(url, window.location.origin).searchParams
    if (p.get('solicitud')) setSolicitud(Number(p.get('solicitud')))
    else if (p.get('vista')) setVista(p.get('vista'))
    else setVista('horario')
  }
  const alCambiar = () => { setRecarga((n) => n + 1); recargarAvisos() }

  return (
    <div className="min-h-screen pb-24 md:pb-0 md:pl-60">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />

      {/* Navegación lateral en PC */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-superficie p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icons/icon-192.png" alt="" className="h-9 w-9 rounded-xl" />
          <span className="text-xl font-bold tracking-tight text-slate-900">Chambea</span>
        </div>
        {pestanas.map((p) => (
          <button key={p.id} onClick={() => setVista(p.id)}
            className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left font-medium transition ${actual === p.id ? 'bg-marca-claro text-marca-texto' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icono n={p.icono} size={22} />{p.texto}
          </button>
        ))}
        <div className="mt-auto truncate px-2 text-sm text-slate-500">{cuenta.nombre}</div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-superficie/90 px-4 pt-[calc(0.5rem+env(safe-area-inset-top)+var(--espacio-arriba))] pb-2 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg md:hidden" />
          <span className="text-lg font-bold tracking-tight text-slate-900 md:hidden">Chambea</span>
          <span className="ml-auto" />
          <BotonAvisos sinLeer={sinLeer} onClick={() => setVerAvisos(true)} />
        </div>
      </header>

      {!enLinea && (
        <p className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <Icono n="sinRed" size={18} />Sin conexión. Puedes ver tu horario guardado.
        </p>
      )}

      <main key={actual} className="animar-entrada">
        <Suspense fallback={<div className="mx-auto max-w-lg p-6"><Cargando /></div>}>
          {actual === 'horario' && <Calendario cuenta={cuenta} avisar={avisar} onAbrirSolicitud={setSolicitud} />}
          {actual === 'bolsa' && <Bolsa cuenta={cuenta} avisar={avisar} onAbrirSolicitud={setSolicitud} recarga={recarga} />}
          {actual === 'usuarios' && <Usuarios />}
          {actual === 'importar' && <Importar />}
          {actual === 'cuenta' && <MiCuenta onNovedades={() => setNovedades(true)} />}
        </Suspense>
      </main>

      {/* Navegación inferior en el celular */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-superficie/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-2xl">
          {pestanas.map((p) => (
            <button key={p.id} onClick={() => setVista(p.id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition ${actual === p.id ? 'text-marca-texto' : 'text-slate-500'}`}>
              <span className={`rounded-full px-4 py-1 transition-all duration-200 ${actual === p.id ? 'scale-105 bg-marca-claro' : ''}`}>
                <Icono n={p.icono} size={22} />
              </span>
              {p.texto}
            </button>
          ))}
        </div>
      </nav>

      {solicitud && (
        <Solicitud id={solicitud} cuenta={cuenta} avisar={avisar} onCambio={alCambiar} onCerrar={() => setSolicitud(null)} />
      )}
      {verAvisos && <HojaNotificaciones lista={lista} recargar={recargarAvisos} onIr={irA} onCerrar={() => setVerAvisos(false)} />}
      {novedades && (
        <Hoja titulo="Novedades" icono="novedades" onCerrar={() => { marcarNovedadesVistas(); setNovedades(false) }}>
          {NOVEDADES.map((n) => (
            <div key={n.version} className="mb-4">
              <p className="font-semibold text-slate-900">{n.titulo} <span className="mono text-xs text-slate-500">v{n.version}</span></p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{n.puntos.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ))}
          <button className="btn-primario w-full" onClick={() => { marcarNovedadesVistas(); setNovedades(false) }}>¡Entendido!</button>
        </Hoja>
      )}
    </div>
  )
}
