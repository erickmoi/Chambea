import { useEffect, useState } from 'react'
import { supabase, emailDe, normalizarUsuario, mensajeError } from '../lib/supabase'
import { telValido, limpiarTel } from '../lib/datos'
import { entrarConClave } from '../lib/acceso'
import CampoClave, { claveValida } from '../components/CampoClave'
import Icono from '../components/Icono'
import { useLogo } from '../lib/logo'

// Lo que hace Chambea, rotando en la portada
const FRASES = [
  { icono: 'calendario', titulo: 'Tu horario siempre al día', texto: 'Sincronizado con la hoja oficial, con almuerzo, cena y descanso.' },
  { icono: 'cambio', titulo: 'Permutas en un toque', texto: 'Te decimos qué turnos te sirven sin quedar pegado.' },
  { icono: 'huella', titulo: 'Nunca olvides marcar', texto: 'Recordatorios de GeoVictoria y de la hoja de asistencia.' },
  { icono: 'equipo', titulo: '¿Quién está de turno?', texto: 'Ve a tu equipo de planilla y de servicios profesionales.' },
]
// Íconos que flotan en el fondo
const FONDO = [
  ['sol', '8%', '12%', 34, 0], ['luna', '82%', '9%', 30, 2], ['calendario', '12%', '72%', 38, 4], ['cambio', '78%', '64%', 36, 1],
  ['reloj', '46%', '6%', 26, 3], ['tarde', '88%', '38%', 28, 5], ['cafe', '4%', '44%', 26, 2.5], ['huella', '60%', '86%', 30, 1.5],
]

export default function Login() {
  const [modo, setModo] = useState('entrar') // 'entrar' | 'crear'
  const [usuario, setUsuario] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setError('')
    const u = normalizarUsuario(usuario)
    if (!/^[a-z0-9._]{3,30}$/.test(u))
      return setError('El usuario debe tener de 3 a 30 letras o números (puede llevar punto o guion bajo).')
    if (modo === 'crear') {
      const problema = claveValida(pin)
      if (problema) return setError(problema)
      if (nombre.trim().split(/\s+/).length < 2) return setError('Escribe tu nombre completo, como aparece en el horario.')
      if (!telValido(telefono)) return setError('Escribe tu número de WhatsApp de 8 dígitos (empieza con 6 o 7).')
      if (pin !== pin2) return setError('Los PIN no coinciden. Escríbelo igual las dos veces.')
    } else if (!pin) return setError('Escribe tu PIN.')

    setEnviando(true)
    try {
      if (modo === 'crear') {
        const { data, error } = await supabase.auth.signUp({
          email: emailDe(u),
          password: pin,
          options: { data: { usuario: u, nombre: nombre.trim(), telefono: limpiarTel(telefono) } },
        })
        if (error) {
          if (/already|registered|exists/i.test(error.message)) throw new Error('Ese usuario ya existe. Elige otro.')
          if (error.code === 'weak_password' || /password/i.test(error.message))
            throw new Error('Supabase rechazó ese PIN por débil. Prueba con otro distinto (no 123456).')
          throw error
        }
        if (!data.session) throw new Error('La cuenta se creó, pero no se pudo iniciar sesión. Intenta entrar con tu usuario y PIN.')
      } else {
        await entrarConClave(u, pin)
      }
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  const logo = useLogo()
  const [frase, setFrase] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrase((i) => (i + 1) % FRASES.length), 3500)
    return () => clearInterval(t)
  }, [])
  const f = FRASES[frase]

  return (
    <div className="portada relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-8 md:flex-row md:gap-16">
      {/* Fondo vivo: íconos flotando */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {FONDO.map(([ic, x, y, t, d]) => (
          <span key={ic + x} className="flotar absolute text-white/15" style={{ left: x, top: y, animationDelay: `${d}s` }}>
            <Icono n={ic} size={t} />
          </span>
        ))}
      </div>

      {/* Portada */}
      <div className="relative z-10 mb-6 flex max-w-sm flex-col items-center text-center text-white md:mb-0 md:items-start md:text-left">
        {/* /marca/192.png siempre trae el logo que eligió la administración (aunque nadie haya iniciado sesión en este celular) */}
        <img src="/marca/192.png" onError={(e) => { if (!e.currentTarget.src.endsWith(logo)) e.currentTarget.src = logo }}
          alt="" className="levitar h-20 w-20 rounded-3xl shadow-2xl ring-4 ring-white/20 md:h-24 md:w-24" />
        <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">Chambea</h1>
        <p className="text-lg font-medium text-white/85">Gestión de turnos</p>
        <div key={frase} className="animar-entrada mt-5 hidden w-full items-start gap-3 rounded-2xl bg-white/10 p-4 text-left backdrop-blur md:flex">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15"><Icono n={f.icono} size={24} /></span>
          <span>
            <span className="block font-semibold">{f.titulo}</span>
            <span className="block text-sm text-white/80">{f.texto}</span>
          </span>
        </div>
        <p key={'m' + frase} className="animar-entrada mt-3 flex items-center gap-2 text-sm text-white/85 md:hidden">
          <Icono n={f.icono} size={18} />{f.titulo}
        </p>
        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          {FRASES.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === frase ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`} />)}
        </div>
      </div>

      <div className="animar-hoja relative z-10 w-full max-w-sm rounded-3xl bg-superficie p-6 shadow-2xl">
        <div role="tablist" aria-label="Entrar o crear cuenta" className="relative mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          <span aria-hidden="true" className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-superficie shadow transition-transform duration-300 ${modo === 'crear' ? 'translate-x-full' : ''}`} />
          {['entrar', 'crear'].map((m) => (
            <button key={m} type="button" role="tab" aria-selected={modo === m} onClick={() => { setModo(m); setError('') }}
              className={`relative rounded-lg py-2 transition-colors ${modo === m ? 'text-marca-texto' : 'text-slate-500'}`}>
              {m === 'entrar' ? 'Entrar' : 'Crear cuenta'}
            </button>
          ))}
        </div>

        <form key={modo} onSubmit={enviar} className="animar-entrada space-y-4">          <div>
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
          {modo === 'crear' && (
            <div>
              <label className="etiqueta" htmlFor="tel">WhatsApp</label>
              <div className="flex items-center gap-2">
                <span className="rounded-xl bg-slate-100 px-3 py-2.5 text-slate-600">+503</span>
                <input id="tel" className="input mono" inputMode="tel" autoComplete="tel-national" maxLength={9} placeholder="7000-0000"
                  value={telefono} onChange={(e) => setTelefono(e.target.value.replace(/[^\d-]/g, ''))} />
              </div>
              <p className="mt-1 text-xs text-slate-500">Para que tus compañeros te escriban sobre los cambios.</p>
            </div>
          )}
          <div>
            <label className="etiqueta" htmlFor="pin">{modo === 'crear' ? 'PIN o contraseña (mínimo 6, pueden ser solo números)' : 'PIN o contraseña'}</label>
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
              ? 'Si tu nombre coincide con el horario, entras de una vez.'
              : '¿Olvidaste tu PIN? Pide a la administración que lo restablezca.'}
          </p>
        </form>
      </div>
    </div>
  )
}
