// Cuentas sin WhatsApp: se pide una sola vez antes de entrar
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { rpc, telValido, limpiarTel } from '../lib/datos'
import Icono from '../components/Icono'

export default function PedirWhatsApp() {
  const { cuenta, recargarCuenta, salir } = useAuth()
  const [tel, setTel] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const guardar = async (e) => {
    e.preventDefault()
    if (!telValido(tel)) return setError('Escribe un número de 8 dígitos que empiece con 6 o 7.')
    setEnviando(true)
    try {
      await rpc('guardar_telefono', { p_telefono: limpiarTel(tel) })
      await recargarCuenta()
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={guardar} className="tarjeta animar-entrada w-full max-w-sm space-y-4 p-6">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Icono n="whatsapp" size={36} />
        </span>
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">Hola, {cuenta.nombre.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-slate-500">Agrega tu WhatsApp para que tus compañeros te escriban cuando te propongan o acepten un cambio.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-xl bg-slate-100 px-3 py-2.5 text-slate-600">+503</span>
          <input className="input mono" inputMode="tel" autoComplete="tel-national" maxLength={9} placeholder="7000-0000" autoFocus
            value={tel} onChange={(e) => { setTel(e.target.value.replace(/[^\d-]/g, '')); setError('') }} />
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primario w-full" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar y entrar'}</button>
        <button type="button" className="btn-secundario w-full" onClick={salir}>Salir</button>
      </form>
    </div>
  )
}
