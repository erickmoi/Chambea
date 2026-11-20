// Cuenta y ajustes: datos, PIN, tema, instalar la app, ajustes del admin y versión
import { useCallback, useEffect, useState } from 'react'
import { supabase, mensajeError } from '../lib/supabase'
import { useAuth, esAdmin } from '../lib/auth'
import { rpc, telValido, limpiarTel, telBonito } from '../lib/datos'
import { pushSoportado, necesitaInstalar, estadoPush, activarPush, desactivarPush, probarPush } from '../lib/push'
import { aplicarModo, modoGuardado } from '../lib/tema'
import { plataforma, estaInstalada, puedeInstalarDirecto, instalarDirecto, alCambiarInstalable } from '../lib/instalar'
import { VERSION } from '../lib/version'
import CampoClave, { claveValida } from '../components/CampoClave'
import Icono from '../components/Icono'
import { Aviso } from '../components/ui'
import { Segmentado } from '../components/turnos'

const ROLES = { superadmin: 'Superadministrador', admin: 'Administración', usuario: 'Compañero' }

export default function MiCuenta({ onNovedades }) {
  const { cuenta, salir, recargarCuenta } = useAuth()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [modo, setModo] = useState(modoGuardado)
  const [aviso, setAviso] = useState(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])

  const funciones = [
    cuenta.es_supervisor && 'Supervisor (planilla)',
    cuenta.referencias_planilla && 'Referencias (planilla)',
    cuenta.referencias_sp && 'Referencias (SP)',
  ].filter(Boolean)

  const cambiarModo = (m) => { setModo(m); aplicarModo(m) }

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

      <section className="tarjeta space-y-3">
        <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icono n={modo === 'oscuro' ? 'luna' : 'sol'} size={20} />Apariencia</h2>
        <Segmentado valor={modo} onCambio={cambiarModo} opciones={[
          { id: 'sistema', texto: 'Sistema', icono: 'celular' }, { id: 'claro', texto: 'Claro', icono: 'sol' }, { id: 'oscuro', texto: 'Oscuro', icono: 'luna' },
        ]} />
      </section>

      <Notificaciones avisar={(texto, tipo = 'ok') => setAviso({ texto, tipo })} />
      <WhatsApp cuenta={cuenta} recargar={recargarCuenta} avisar={(texto, tipo = 'ok') => setAviso({ texto, tipo })} />
      <Instalar />

      <form onSubmit={cambiarPin} className="tarjeta space-y-3">
        <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="llave" size={20} />Cambiar mi PIN</h2>
        <CampoClave id="nuevo" autoComplete="new-password" placeholder="Nuevo PIN" value={pin} onChange={setPin} />
        <CampoClave id="nuevo2" autoComplete="new-password" placeholder="Repítelo" value={pin2} onChange={setPin2} />
        <button className="btn-primario w-full" disabled={guardando || !pin}>{guardando ? 'Guardando…' : 'Guardar PIN'}</button>
      </form>

      {esAdmin(cuenta) && <AjustesAdmin avisar={(texto, tipo = 'ok') => setAviso({ texto, tipo })} />}

      <button className="btn-peligro w-full" onClick={salir}><Icono n="salir" size={18} className="mr-1 -mt-0.5 align-middle" />Salir</button>
      <button className="mx-auto flex items-center gap-1.5 text-sm text-slate-500" onClick={onNovedades}>
        <Icono n="novedades" size={16} />Chambea v{VERSION} · Novedades
      </button>
    </div>
  )
}

function WhatsApp({ cuenta, recargar, avisar }) {
  const [tel, setTel] = useState(cuenta.telefono || '')
  const [guardando, setGuardando] = useState(false)
  const cambio = limpiarTel(tel) !== cuenta.telefono
  const guardar = async () => {
    if (!telValido(tel)) return avisar('Escribe un número de 8 dígitos que empiece con 6 o 7.', 'error')
    setGuardando(true)
    try { await rpc('guardar_telefono', { p_telefono: limpiarTel(tel) }); await recargar(); avisar('WhatsApp actualizado ✅') }
    catch (e) { avisar(e.message, 'error') } finally { setGuardando(false) }
  }
  return (
    <section className="tarjeta space-y-3">
      <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="whatsapp" size={20} />Mi WhatsApp</h2>
      <div className="flex items-center gap-2">
        <span className="rounded-xl bg-slate-100 px-3 py-2.5 text-slate-600">+503</span>
        <input className="input mono" inputMode="tel" maxLength={9} placeholder={telBonito(cuenta.telefono) || '7000-0000'}
          value={tel} onChange={(e) => setTel(e.target.value.replace(/[^\d-]/g, ''))} />
      </div>
      {cambio && <button className="btn-primario w-full" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar número'}</button>}
      <p className="text-xs text-slate-500">Lo ven solo tus compañeros con cuenta, para escribirte sobre un cambio.</p>
    </section>
  )
}

function Notificaciones({ avisar }) {
  const [estado, setEstado] = useState('cargando')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { estadoPush().then(setEstado) }, [])
  if (!pushSoportado()) return null
  const activar = async () => {
    setOcupado(true)
    try { await activarPush(); setEstado('activo'); await probarPush().catch(() => {}); avisar('Avisos activados 🔔') }
    catch (e) { avisar(e.message, 'error') } finally { setOcupado(false) }
  }
  const apagar = async () => {
    setOcupado(true)
    try { await desactivarPush(); setEstado('inactivo'); avisar('Avisos desactivados en este dispositivo') }
    finally { setOcupado(false) }
  }
  return (
    <section className="tarjeta space-y-2">
      <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="notificaciones" size={20} />Avisos en el celular</h2>
      {necesitaInstalar() ? (
        <p className="text-sm text-slate-600">En iPhone, primero instala la app (abajo) y ábrela desde la pantalla de inicio.</p>
      ) : estado === 'bloqueado' ? (
        <p className="text-sm text-slate-600">Los bloqueaste en este navegador. Actívalos desde los ajustes del navegador para este sitio.</p>
      ) : estado === 'activo' ? (
        <div className="flex gap-2">
          <button className="btn-secundario flex-1" disabled={ocupado} onClick={() => probarPush().then(() => avisar('Prueba enviada'), (e) => avisar(e.message, 'error'))}>Probar</button>
          <button className="btn-peligro flex-1" disabled={ocupado} onClick={apagar}>Desactivar</button>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-600">Te avisamos al instante cuando te propongan un cambio o respondan tu solicitud.</p>
          <button className="btn-primario w-full" disabled={ocupado || estado === 'cargando'} onClick={activar}>Activar avisos</button>
        </>
      )}
    </section>
  )
}

function Instalar() {
  const [directo, setDirecto] = useState(puedeInstalarDirecto)
  useEffect(() => alCambiarInstalable(setDirecto), [])
  if (estaInstalada()) return null
  const p = plataforma()
  return (
    <section className="tarjeta space-y-2">
      <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="celular" size={20} />Instalar la app</h2>
      {directo ? (
        <button className="btn-primario w-full" onClick={instalarDirecto}>Instalar Chambea</button>
      ) : p === 'ios' ? (
        <p className="text-sm text-slate-600">En Safari toca <b>Compartir</b> <span aria-hidden="true">⬆️</span> y luego <b>Agregar a inicio</b>. Quedará como una app más.</p>
      ) : p === 'android' ? (
        <p className="text-sm text-slate-600">En Chrome toca el menú <b>⋮</b> y luego <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.</p>
      ) : (
        <p className="text-sm text-slate-600">En Chrome o Edge, usa el ícono de instalar en la barra de direcciones.</p>
      )}
    </section>
  )
}

function AjustesAdmin({ avisar }) {
  const [a, setA] = useState(null)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => {
    supabase.from('ajustes').select('max_horas_continuas, min_descanso_planilla_h').eq('id', 1).single().then(({ data }) => setA(data))
  }, [])
  if (!a) return null
  const guardar = async () => {
    setGuardando(true)
    try {
      await rpc('guardar_ajustes', { p_max_horas: a.max_horas_continuas, p_min_descanso_planilla_h: a.min_descanso_planilla_h })
      avisar('Ajustes guardados ✅')
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setGuardando(false)
    }
  }
  return (
    <section className="tarjeta space-y-3">
      <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="admin" size={20} />Reglas de cambios (admin)</h2>
      <label className="block text-sm text-slate-700">
        Descanso mínimo entre turnos de planilla
        <span className="block text-xs text-slate-500">Con menos horas se consideran "pegados" y no se sugieren.</span>
        <span className="mt-1 flex items-center gap-2">
          <input type="number" inputMode="numeric" min={0} max={24} className="input w-24" value={a.min_descanso_planilla_h}
            onChange={(e) => setA({ ...a, min_descanso_planilla_h: Number(e.target.value) })} /> horas
        </span>
      </label>
      <label className="block text-sm text-slate-700">
        Avisar jornadas de más de
        <span className="mt-1 flex items-center gap-2">
          <input type="number" inputMode="numeric" min={8} max={72} className="input w-24" value={a.max_horas_continuas}
            onChange={(e) => setA({ ...a, max_horas_continuas: Number(e.target.value) })} /> horas seguidas
        </span>
      </label>
      <button className="btn-primario w-full" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button>
    </section>
  )
}
