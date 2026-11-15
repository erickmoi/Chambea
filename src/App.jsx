// Armazón de la app. Las pantallas de Mi horario y Bolsa llegan en el Paso 4.
import { lazy, Suspense, useEffect, useState } from 'react'
import { useAuth, esAdmin } from './lib/auth'
import Login from './pages/Login.jsx'
import Pendiente from './pages/Pendiente.jsx'
import MiCuenta from './pages/MiCuenta.jsx'
import Icono from './components/Icono'
import { Cargando } from './components/ui'

const Usuarios = lazy(() => import('./pages/admin/Usuarios.jsx'))
const Importar = lazy(() => import('./pages/admin/Importar.jsx'))

const VISTAS_ADMIN = ['usuarios', 'importar']

function vistaDeUrl() {
  return new URLSearchParams(window.location.search).get('vista') || 'inicio'
}

export default function App() {
  const { session, cuenta, cargando } = useAuth()
  const [vista, setVista] = useState(vistaDeUrl)

  // La vista vive en la URL (?vista=...) para que los enlaces de las notificaciones funcionen
  useEffect(() => {
    const url = new URL(window.location.href)
    if (vista === 'inicio') url.searchParams.delete('vista')
    else url.searchParams.set('vista', vista)
    window.history.replaceState(null, '', url)
  }, [vista])

  if (cargando) return <div className="mx-auto max-w-lg p-6"><Cargando /></div>
  if (!session) return <Login />
  if (!cuenta || !cuenta.activo || !cuenta.aprobado) return <Pendiente />

  const admin = esAdmin(cuenta)
  const actual = VISTAS_ADMIN.includes(vista) && !admin ? 'inicio' : vista
  const pestanas = [
    { id: 'inicio', texto: 'Inicio', icono: 'inicio' },
    ...(admin ? [{ id: 'usuarios', texto: 'Usuarios', icono: 'usuarios' }, { id: 'importar', texto: 'Horario', icono: 'excel' }] : []),
    { id: 'cuenta', texto: 'Mi cuenta', icono: 'cuenta' },
  ]

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-superficie/90 px-4 pt-[calc(0.75rem+env(safe-area-inset-top)+var(--espacio-arriba))] pb-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <Icono n="cambio" size={24} className="text-marca-texto" />
          <span className="text-lg font-bold text-slate-900">Chambea</span>
          <span className="ml-auto truncate text-sm text-slate-500">{cuenta.nombre.split(' ')[0]}</span>
        </div>
      </header>

      <main>
        <Suspense fallback={<div className="mx-auto max-w-lg p-6"><Cargando /></div>}>
          {actual === 'inicio' && <Inicio cuenta={cuenta} />}
          {actual === 'usuarios' && <Usuarios />}
          {actual === 'importar' && <Importar />}
          {actual === 'cuenta' && <MiCuenta />}
        </Suspense>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-superficie/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl">
          {pestanas.map((p) => (
            <button key={p.id} onClick={() => setVista(p.id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition ${actual === p.id ? 'text-marca-texto' : 'text-slate-500'}`}>
              <span className={`rounded-full px-4 py-1 transition ${actual === p.id ? 'bg-marca-claro' : ''}`}>
                <Icono n={p.icono} size={22} />
              </span>
              {p.texto}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

// Provisional hasta el Paso 4 (Mi horario + Bolsa)
function Inicio({ cuenta }) {
  return (
    <div className="mx-auto max-w-lg p-4">
      <div className="tarjeta animar-entrada space-y-2 text-center">
        <p className="text-lg font-bold text-slate-900">¡Hola, {cuenta.nombre.split(' ')[0]}! 👋</p>
        <p className="text-sm text-slate-500">Tu cuenta está lista y enlazada a <b>{cuenta.persona}</b>.</p>
        <p className="text-sm text-slate-500">Pronto verás aquí tu horario y la bolsa de cambios.</p>
      </div>
    </div>
  )
}
