import { useCallback, useState } from 'react'
import { supabase, mensajeError } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import CampoClave, { claveValida } from '../components/CampoClave'
import Icono from '../components/Icono'
import { Aviso } from '../components/ui'

const ROLES = { superadmin: 'Superadministrador', admin: 'Administración', usuario: 'Compañero' }

export default function MiCuenta() {
  const { cuenta, salir } = useAuth()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])

  const funciones = [
    cuenta.es_supervisor && 'Supervisor (planilla)',
    cuenta.referencias_planilla && 'Referencias (planilla)',
    cuenta.referencias_sp && 'Referencias (SP)',
  ].filter(Boolean)

  const cambiarPin = async (e) => {
    e.preventDefault()
    const problema = claveValida(pin)
    if (problema) return setAviso({ tipo: 'error', texto: problema })
    if (pin !== pin2) return setAviso({ tipo: 'error', texto: 'Los PIN no coinciden.' })
    setGuardando(true)
    const { error } = await supabase.auth.updateUser({ password: pin })
    setGuardando(false)
    if (error) return setAviso({ tipo: 'error', texto: mensajeError(error) })
    setPin('')
    setPin2('')
    setAviso({ tipo: 'ok', texto: 'PIN actualizado ✅' })
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      <section className="tarjeta space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Icono n="cuenta" size={26} className="text-marca-texto" />{cuenta.nombre}</h1>
        <p className="text-sm text-slate-500">@{cuenta.usuario} · {ROLES[cuenta.rol]}</p>
        <p className="pt-2 text-sm text-slate-700">En el horario: <b>{cuenta.persona ?? '—'}</b></p>
        {funciones.length > 0 && <p className="text-sm text-slate-700">Funciones: {funciones.join(' · ')}</p>}
      </section>

      <form onSubmit={cambiarPin} className="tarjeta space-y-3">
        <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="llave" size={20} />Cambiar mi PIN</h2>
        <CampoClave id="nuevo" autoComplete="new-password" placeholder="Nuevo PIN" value={pin} onChange={setPin} />
        <CampoClave id="nuevo2" autoComplete="new-password" placeholder="Repítelo" value={pin2} onChange={setPin2} />
        <button className="btn-primario w-full" disabled={guardando || !pin}>{guardando ? 'Guardando…' : 'Guardar PIN'}</button>
      </form>

      <button className="btn-peligro w-full" onClick={salir}><Icono n="salir" size={18} className="mr-1 -mt-0.5 align-middle" />Salir</button>
    </div>
  )
}
