import { useState } from 'react'
import { useAuth } from '../lib/auth'
import Icono from '../components/Icono'

// Cuenta creada pero aún no aprobada (o desactivada)
export default function Pendiente() {
  const { cuenta, recargarCuenta, salir } = useAuth()
  const [revisando, setRevisando] = useState(false)
  const desactivada = cuenta && !cuenta.activo

  const revisar = async () => {
    setRevisando(true)
    await recargarCuenta()
    setRevisando(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="tarjeta animar-entrada w-full max-w-sm space-y-4 p-6 text-center">
        <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${desactivada ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
          <Icono n={desactivada ? 'prohibido' : 'espera'} size={36} className={desactivada ? '' : 'animar-latido'} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {desactivada ? 'Cuenta desactivada' : `¡Hola, ${cuenta?.nombre?.split(' ')[0] ?? ''}!`}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {desactivada
              ? 'Habla con la administración si crees que es un error.'
              : 'Tu cuenta está esperando aprobación. Cuando la administración la apruebe y la enlace con tu nombre del horario, podrás entrar.'}
          </p>
        </div>
        {!desactivada && (
          <button className="btn-primario w-full" disabled={revisando} onClick={revisar}>
            {revisando ? 'Revisando…' : 'Ya me aprobaron, revisar'}
          </button>
        )}
        <button className="btn-secundario w-full" onClick={salir}>
          <Icono n="salir" size={18} className="mr-1 -mt-0.5 align-middle" />Salir
        </button>
      </div>
    </div>
  )
}
