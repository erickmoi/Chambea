// Armazón: navegación inferior (celular) o lateral (PC), campanita, enlaces directos y novedades
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useAuth, esAdmin } from './lib/auth'
import Login from './pages/Login.jsx'
import Pendiente from './pages/Pendiente.jsx'
import PedirWhatsApp from './pages/PedirWhatsApp.jsx'
import Inicio from './pages/Inicio.jsx'
import Calendario from './pages/Calendario.jsx'
import Bolsa from './pages/Bolsa.jsx'
import MiCuenta from './pages/MiCuenta.jsx'
import Solicitud from './components/Solicitud.jsx'
import { useAvisos, BotonAvisos, HojaNotificaciones } from './components/Avisos.jsx'
import Icono from './components/Icono'
import { Aviso, Cargando, Hoja, RaizConfirmar } from './components/ui'
import Recorrido, { recorridoVisto } from './components/Recorrido.jsx'
import { rpc } from './lib/datos'
import { useActualizacion, actualizarAhora } from './lib/actualizacion'
import { pantallaInicial } from './lib/tema'
import { NOVEDADES, hayNovedades, marcarNovedadesVistas } from './lib/version'

const Admin = lazy(() => import('./pages/admin/Admin.jsx'))

const VISTAS = ['inicio', 'horario', 'bolsa', 'admin', 'cuenta']
// Enlaces viejos (?vista=usuarios / importar) llevan a Administración
const vistaDe = (v) => (['usuarios', 'importar'].includes(v) ? 'admin' : VISTAS.includes(v) ? v : pantallaInicial())
const params = () => new URLSearchParams(window.location.search)

export default function App() {
  const { session, cuenta, cargando } = useAuth()
  const [vista, setVista] = useState(() => vistaDe(params().get('vista')))
  const [verResumen, setVerResumen] = useState(false)
  const [adminInicial, setAdminInicial] = useState(null)
  const [recorrido, setRecorrido] = useState(false)
  const [pendientes, setPendientes] = useState(0)
  const nuevaVersion = useActualizacion()
  const [solicitud, setSolicitud] = useState(() => Number(params().get('solicitud')) || null)
  const [aviso, setAviso] = useState(null)
  const [verAvisos, setVerAvisos] = useState(false)
  const [novedades, setNovedades] = useState(false)
  const [recarga, setRecarga] = useState(0)
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)
  const listo = !!(session && cuenta?.activo && cuenta?.aprobado)
  const alNuevoAviso = useRef(null)
  const { lista, cargar: recargarAvisos, sinLeer } = useAvisos(listo, alNuevoAviso)

  // Cuántas cosas me toca responder (número en la pestaña Permutas)
  const cargarPendientes = useCallback(() => {
    if (!listo) return
    rpc('pendientes').then((p) => setPendientes(p.length), () => {})
  }, [listo])
  useEffect(() => {
    cargarPendientes()
    alNuevoAviso.current = () => { cargarPendientes(); setRecarga((n) => n + 1) }
  }, [cargarPendientes])

  const avisar = useCallback((texto, tipo = 'ok') => setAviso({ texto, tipo }), [])
  const cerrarAviso = useCallback(() => setAviso(null), [])

  // La URL refleja la vista y la solicitud abierta (para enlaces de avisos y WhatsApp)
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('vista')
    url.searchParams.delete('solicitud')
    if (vista !== 'inicio') url.searchParams.set('vista', vista)
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

  useEffect(() => {
    if (!listo || !cuenta?.telefono) return
    if (!recorridoVisto()) setRecorrido(true)
    else if (hayNovedades()) setNovedades(true)
  }, [listo, cuenta?.telefono])

  if (cargando) return <div className="mx-auto max-w-lg p-6"><Cargando /></div>
  if (!session) return <Login />
  if (!listo) return <Pendiente />
  if (!cuenta.telefono) return <PedirWhatsApp />

  const admin = esAdmin(cuenta)
  const actual = vista === 'admin' && !admin ? 'inicio' : vista
  const pestanas = [
    { id: 'inicio', texto: 'Inicio', icono: 'inicio' },
    { id: 'horario', texto: 'Horario', icono: 'calendario' },
    { id: 'bolsa', texto: 'Permutas', icono: 'cambio', cuenta: pendientes },
    ...(admin ? [{ id: 'admin', texto: 'Admin', icono: 'seguridad' }] : []),
    { id: 'cuenta', texto: 'Cuenta', icono: 'cuenta' },
  ]
  const ir = (v, opciones = {}) => { setVerResumen(!!opciones.resumen); setAdminInicial(opciones.admin || null); setVista(v) }

  const irA = (url) => {
    setVerAvisos(false)
    if (!url) return
    const p = new URL(url, window.location.origin).searchParams
    if (p.get('solicitud')) setSolicitud(Number(p.get('solicitud')))
    else if (p.get('vista')) setVista(vistaDe(p.get('vista')))
    else setVista('inicio')
  }
  const alCambiar = () => { setRecarga((n) => n + 1); recargarAvisos(); cargarPendientes() }

  return (
    <div className="min-h-screen pb-24 md:pb-0 md:pl-60">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      <RaizConfirmar />
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-xl focus:bg-superficie focus:px-4 focus:py-2 focus:shadow-lg">Saltar al contenido</a>

      {/* Navegación lateral en PC */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-superficie p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icons/icono-192.png" alt="" className="h-9 w-9 rounded-xl" />
          <span className="text-xl font-bold tracking-tight text-slate-900">Chambea</span>
        </div>
        <nav aria-label="Secciones">
          {pestanas.map((p) => (
            <button key={p.id} onClick={() => ir(p.id)} aria-current={actual === p.id ? 'page' : undefined}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-medium transition ${actual === p.id ? 'bg-marca-claro text-marca-texto' : 'text-slate-700 hover:bg-slate-100'}`}>
              <Icono n={p.icono} size={22} />{p.texto}
              {p.cuenta > 0 && <span className="ml-auto rounded-full bg-red-600 px-2 text-xs font-bold leading-5 text-white" aria-label={`${p.cuenta} pendientes`}>{p.cuenta}</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto truncate px-2 text-sm text-slate-500">{cuenta.nombre}</div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-superficie/90 px-4 pt-[calc(0.5rem+env(safe-area-inset-top)+var(--espacio-arriba))] pb-2 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <img src="/icons/icono-192.png" alt="" className="h-8 w-8 rounded-lg md:hidden" />
          <span className="text-lg font-bold tracking-tight text-slate-900 md:hidden">Chambea</span>
          <span className="ml-auto" />
          <BotonAvisos sinLeer={sinLeer} onClick={() => setVerAvisos(true)} />
        </div>
      </header>

      {nuevaVersion && (
        <div role="status" className="flex items-center justify-center gap-3 bg-marca px-4 py-2 text-sm font-medium text-sobre-marca">
          <Icono n="cohete" size={18} />Hay una versión nueva de Chambea
          <button className="rounded-full bg-sobre-marca/20 px-3 py-1 font-semibold" onClick={actualizarAhora}>Actualizar</button>
        </div>
      )}
      {!enLinea && (
        <p className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <Icono n="sinRed" size={18} />Sin conexión. Puedes ver tu horario guardado.
        </p>
      )}

      <main id="contenido" key={actual} className="animar-entrada">
        <Suspense fallback={<div className="mx-auto max-w-lg p-6"><Cargando /></div>}>
          {actual === 'inicio' && <Inicio cuenta={cuenta} avisar={avisar} onAbrirSolicitud={setSolicitud} onIr={ir} recarga={recarga} />}
          {actual === 'horario' && <Calendario cuenta={cuenta} avisar={avisar} onAbrirSolicitud={setSolicitud} verResumen={verResumen} />}
          {actual === 'bolsa' && <Bolsa cuenta={cuenta} avisar={avisar} onAbrirSolicitud={setSolicitud} recarga={recarga} pendientes={pendientes} />}
          {actual === 'admin' && <Admin inicial={adminInicial} />}
          {actual === 'cuenta' && <MiCuenta onNovedades={() => setNovedades(true)} onRecorrido={() => setRecorrido(true)} onIr={ir} />}
        </Suspense>
      </main>

      {/* Navegación inferior en el celular */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-superficie/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-2xl">
          {pestanas.map((p) => (
            <button key={p.id} onClick={() => ir(p.id)} aria-current={actual === p.id ? 'page' : undefined}
              className={`flex min-h-14 flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold transition ${actual === p.id ? 'text-marca-texto' : 'text-slate-600'}`}>
              <span className={`relative rounded-full px-4 py-1 transition-all duration-200 ${actual === p.id ? 'scale-105 bg-marca-claro' : ''}`}>
                <Icono n={p.icono} size={22} />
                {p.cuenta > 0 && (
                  <span key={p.cuenta} className="animar-pop absolute -top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-superficie">
                    {p.cuenta > 9 ? '9+' : p.cuenta}<span className="sr-only"> pendientes</span>
                  </span>
                )}
              </span>
              {p.texto}
            </button>
          ))}
        </div>
      </nav>

      {solicitud && (
        <Solicitud id={solicitud} cuenta={cuenta} avisar={avisar} onCambio={alCambiar} onCerrar={() => setSolicitud(null)} />
      )}
      {recorrido && <Recorrido onCerrar={() => { setRecorrido(false); if (hayNovedades()) setNovedades(true) }} />}
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
