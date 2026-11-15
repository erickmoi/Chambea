import { useState } from 'react'
import { supabase, emailDe, normalizarUsuario, mensajeError } from '../lib/supabase'
import { entrarConClave } from '../lib/acceso'
import CampoClave, { claveValida } from '../components/CampoClave'
import Icono from '../components/Icono'

export default function Login() {
  const [modo, setModo] = useState('entrar') // 'entrar' | 'crear'
  const [usuario, setUsuario] = useState('')
  const [nombre, setNombre] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setError('')
    const u = normalizarUsuario(usuario)
    if (!/^[a-z0-9._]{3,30}$/.test(u))
      return setError('El usuario debe tener de 3 a 30 letras, números, punto o guion bajo (sin espacios).')
    if (modo === 'crear') {
      const problema = claveValida(pin)
      if (problema) return setError(problema)
      if (nombre.trim().split(/\s+/).length < 2) return setError('Escribe tu nombre completo, como aparece en el horario.')
      if (pin !== pin2) return setError('Los PIN no coinciden. Escríbelo igual las dos veces.')
    } else if (pin.length < 6) return setError('Escribe tu PIN completo.')

    setEnviando(true)
    try {
      if (modo === 'crear') {
        const { data, error } = await supabase.auth.signUp({
          email: emailDe(u),
          password: pin,
          options: { data: { usuario: u, nombre: nombre.trim() } },
        })
        if (error) {
          if (/already|registered|exists/i.test(error.message)) throw new Error('Ese usuario ya existe. Elige otro.')
          throw error
        }
        if (!data.session) throw new Error('La cuenta se creó, pero falta desactivar "Confirm email" en Supabase. Avisa a la administración.')
      } else {
        await entrarConClave(u, pin)
      }
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-marca to-marca-oscuro px-4">
      <div className="animar-entrada w-full max-w-sm rounded-3xl bg-superficie p-6 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="animar-pop flex h-16 w-16 items-center justify-center rounded-2xl bg-marca-claro text-marca-texto">
            <Icono n="cambio" size={38} />
          </span>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Chambea</h1>
          <p className="text-sm text-slate-500">Cambios de turno entre compañeros</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          {['entrar', 'crear'].map((m) => (
            <button key={m} type="button" onClick={() => { setModo(m); setError('') }}
              className={`rounded-lg py-2 ${modo === m ? 'bg-superficie text-marca-texto shadow' : 'text-slate-500'}`}>
              {m === 'entrar' ? 'Entrar' : 'Crear cuenta'}
            </button>
          ))}
        </div>

        <form onSubmit={enviar} className="space-y-4">
          <div>
            <label className="etiqueta" htmlFor="usuario">Usuario</label>
            <input id="usuario" className="input" autoCapitalize="none" autoCorrect="off" autoComplete="username"
              placeholder="ej. maria.lopez" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          </div>
          {modo === 'crear' && (
            <div>
              <label className="etiqueta" htmlFor="nombre">Nombre completo (como aparece en el horario)</label>
              <input id="nombre" className="input" maxLength={80} autoComplete="name" placeholder="ej. María José López Pérez"
                value={nombre} onChange={(e) => setNombre(e.target.value)} />
              <p className="mt-1 text-xs text-slate-500">Con esto te enlazamos a tus turnos.</p>
            </div>
          )}
          <div>
            <label className="etiqueta" htmlFor="pin">{modo === 'crear' ? 'PIN de 6 números (o contraseña)' : 'PIN o contraseña'}</label>
            <CampoClave id="pin" autoComplete={modo === 'crear' ? 'new-password' : 'current-password'} value={pin} onChange={setPin} />
            <p className="mt-1 text-xs text-slate-500">Toca <b>ABC</b> para escribir letras.</p>
          </div>
          {modo === 'crear' && (
            <div>
              <label className="etiqueta" htmlFor="pin2">Repítelo</label>
              <CampoClave id="pin2" autoComplete="new-password" value={pin2} onChange={setPin2} />
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="submit" disabled={enviando} className="btn-primario w-full">
            {enviando ? 'Un momento…' : modo === 'entrar' ? 'Entrar' : 'Crear mi cuenta'}
          </button>
          <p className="text-center text-xs text-slate-500">
            {modo === 'crear'
              ? 'La administración aprobará tu cuenta antes de que puedas usarla.'
              : '¿Olvidaste tu PIN? Pide a la administración que lo restablezca.'}
          </p>
        </form>
      </div>
    </div>
  )
}
