import { useState } from 'react'
import { supabase, mensajeError } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import Icono from '../components/Icono'

// Cuenta creada pero sin enlazar a un nombre del horario (o desactivada)
export default function Pendiente() {
  const { cuenta, recargarCuenta, salir } = useAuth()
  const [nombre, setNombre] = useState(cuenta?.nombre ?? '')
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const desactivada = cuenta && !cuenta.activo

  const enlazar = async (e) => {
    e.preventDefault()
    setMensaje('')
    setEnviando(true)
    try {
      const { data, error } = await supabase.rpc('reclamar_nombre', { p_nombre: nombre })
      if (error) throw error
      if (data.ok) return await recargarCuenta()
      setMensaje(data.motivo === 'ya_tiene_cuenta'
        ? 'Ese nombre ya tiene una cuenta. Si no es tuya, avisa a la administración.'
        : `No encontré ese nombre en el horario. Revísalo y vuelve a intentar (te quedan ${data.restantes}).`)
    } catch (err) {
      setMensaje(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="tarjeta animar-entrada w-full max-w-sm space-y-4 p-6">
        <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${desactivada ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
          <Icono n={desactivada ? 'prohibido' : 'enlace'} size={36} />
        </span>
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">
            {desactivada ? 'Cuenta desactivada' : 'Falta un paso'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {desactivada
              ? 'Habla con la administración si crees que es un error.'
              : 'No encontré tu nombre en el horario. Escríbelo completo, tal como aparece en la hoja de turnos.'}
          </p>
        </div>

        {!desactivada && (
          <form onSubmit={enlazar} className="space-y-3">
            <input className="input" maxLength={80} autoComplete="name" placeholder="ej. María José López Pérez"
              value={nombre} onChange={(e) => setNombre(e.target.value)} />
            {mensaje && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{mensaje}</p>}
            <button className="btn-primario w-full" disabled={enviando || !nombre.trim()}>
              {enviando ? 'Buscando…' : 'Buscar mi nombre'}
            </button>
          </form>
        )}
        <button className="btn-secundario w-full" onClick={salir}>
          <Icono n="salir" size={18} className="mr-1 -mt-0.5 align-middle" />Salir
        </button>
      </div>
    </div>
  )
}
