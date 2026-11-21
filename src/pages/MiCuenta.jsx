// Cuenta y ajustes personales (solo para quien los cambia). Los ajustes generales del admin están en Admin → Ajustes.
import { useCallback, useEffect, useState } from 'react'
import { supabase, mensajeError } from '../lib/supabase'
import { useAuth, esAdmin } from '../lib/auth'
import { rpc, telValido, limpiarTel, telBonito } from '../lib/datos'
import { pushSoportado, necesitaInstalar, estadoPush, activarPush, desactivarPush, probarPush } from '../lib/push'
import {
  aplicarModo, modoGuardado, aplicarLetra, letraGuardada, vibracionActiva, guardarVibracion, vibrar, ACENTOS, acentoGuardado, aplicarAcento,
  animacionesGuardadas, aplicarAnimaciones, pantallaInicial, guardarPantallaInicial, pausasVisibles, guardarPausasVisibles,
} from '../lib/tema'
import { es24h, usar24h } from '../lib/fechas'
import { LOGOS, aplicarLogo } from '../lib/logo'
import { plataforma, estaInstalada, puedeInstalarDirecto, instalarDirecto, alCambiarInstalable } from '../lib/instalar'
import { VERSION } from '../lib/version'
import CampoClave, { claveValida } from '../components/CampoClave'
import Icono from '../components/Icono'
import { Aviso, Interruptor } from '../components/ui'
import { Segmentado } from '../components/turnos'

const ROLES = { superadmin: 'Superadministrador', admin: 'Administración', usuario: 'Compañero' }

export default function MiCuenta({ onNovedades, onRecorrido, onIr }) {
  const { cuenta, salir, recargarCuenta } = useAuth()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])

  const funciones = [
    cuenta.es_supervisor && 'Supervisor (planilla)',
    cuenta.referencias_planilla && 'Referencias (planilla)',
    cuenta.referencias_sp && 'Referencias (Servicios Profesionales)',
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
    setAviso({ tipo: 'ok', texto: 'PIN actualizado' })
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

      {esAdmin(cuenta) && (
        <button onClick={() => onIr('admin', { admin: 'ajustes' })}
          className="flex w-full items-center gap-3 rounded-2xl bg-marca-claro p-4 text-left ring-1 ring-marca/30">
          <Icono n="seguridad" size={26} className="text-marca-texto" />
          <span className="flex-1"><b className="block text-slate-900">Ajustes generales</b><span className="text-sm text-slate-700">Registro, reglas de permutas, GeoVictoria y anuncios para todo el equipo.</span></span>
          <Icono n="siguiente" size={18} className="text-marca-texto" />
        </button>
      )}

      <Grupo titulo="Mis ajustes" sub="Solo cambian la app para ti.">
        <Apariencia />
        <MiHorario />
        <Notificaciones avisar={(texto, tipo = 'ok') => setAviso({ texto, tipo })} />
        <AvisosPersonales cuenta={cuenta} recargar={recargarCuenta} avisar={(texto, tipo = 'ok') => setAviso({ texto, tipo })} />
        <WhatsApp cuenta={cuenta} recargar={recargarCuenta} avisar={(texto, tipo = 'ok') => setAviso({ texto, tipo })} />
        <Instalar />
      </Grupo>

      <Grupo titulo="Seguridad">
      <form onSubmit={cambiarPin} className="tarjeta space-y-3">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="llave" size={20} />Cambiar mi PIN</h3>
        <CampoClave id="nuevo" autoComplete="new-password" placeholder="Nuevo PIN" value={pin} onChange={setPin} />
        <CampoClave id="nuevo2" autoComplete="new-password" placeholder="Repítelo" value={pin2} onChange={setPin2} />
        <button className="btn-primario w-full" disabled={guardando || !pin}>{guardando ? 'Guardando…' : 'Guardar PIN'}</button>
      </form>
      </Grupo>

      <button className="btn-secundario flex w-full items-center justify-center gap-2" onClick={onRecorrido}>
        <Icono n="info" size={18} />Ver otra vez cómo funciona Chambea
      </button>
      <button className="btn-peligro w-full" onClick={salir}><Icono n="salir" size={18} className="mr-1 -mt-0.5 align-middle" />Salir</button>
      <button className="mx-auto flex min-h-11 items-center gap-1.5 text-sm text-slate-600" onClick={onNovedades}>
        <Icono n="novedades" size={16} />Chambea v{VERSION} · Novedades
      </button>
    </div>
  )
}

function Grupo({ titulo, sub, children }) {
  return (
    <section className="space-y-3 pt-2">
      <header className="px-1">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">{titulo}</h2>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </header>
      {children}
    </section>
  )
}

function Apariencia() {
  const [modo, setModo] = useState(modoGuardado)
  const [acento, setAcento] = useState(acentoGuardado)
  const [letra, setLetra] = useState(letraGuardada)
  const [anim, setAnim] = useState(animacionesGuardadas)
  const [vib, setVib] = useState(vibracionActiva)
  return (
    <section className="tarjeta space-y-4">
      <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n={modo === 'oscuro' ? 'luna' : 'sol'} size={20} />Apariencia y accesibilidad</h3>
      <div>
        <span className="etiqueta">Tema</span>
        <Segmentado etiqueta="Tema" valor={modo} onCambio={(m) => { setModo(m); aplicarModo(m) }} opciones={[
          { id: 'sistema', texto: 'Sistema', icono: 'celular' }, { id: 'claro', texto: 'Claro', icono: 'sol' }, { id: 'oscuro', texto: 'Oscuro', icono: 'luna' },
        ]} />
      </div>
      <div>
        <span className="etiqueta" id="et-color">Color principal</span>
        <div role="radiogroup" aria-labelledby="et-color" className="flex flex-wrap gap-2">
          {ACENTOS.map((a) => (
            <button key={a.id} role="radio" aria-checked={acento === a.id} onClick={() => { setAcento(a.id); aplicarAcento(a.id) }}
              className={`flex min-h-10 items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 text-sm font-semibold ring-1 transition ${acento === a.id ? 'ring-2 ring-slate-900' : 'ring-slate-200'}`}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: a.color }}>
                {acento === a.id && <Icono n="check" size={16} />}
              </span>{a.texto}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="etiqueta">Tamaño de letra</span>
        <Segmentado etiqueta="Tamaño de letra" valor={letra} onCambio={(v) => { setLetra(v); aplicarLetra(v) }} opciones={[
          { id: 'normal', texto: 'Normal' }, { id: 'grande', texto: <span className="text-base">Grande</span> },
        ]} />
      </div>
      <Interruptor activo={anim} etiqueta="Animaciones" ayuda="Apágalas si prefieres que nada se mueva."
        onCambio={(v) => { setAnim(v); aplicarAnimaciones(v) }} />
      <Interruptor activo={vib} etiqueta="Vibrar al tocar" ayuda="Una vibración corta al confirmar acciones."
        onCambio={(v) => { setVib(v); guardarVibracion(v); if (v) vibrar(30) }} />
    </section>
  )
}

function MiHorario() {
  const [pantalla, setPantalla] = useState(pantallaInicial)
  const [h24, setH24] = useState(es24h)
  const [pausas, setPausas] = useState(pausasVisibles)
  const [vista, setVista] = useState(() => { try { return localStorage.getItem('chambea.vista') || 'agenda' } catch { return 'agenda' } })
  return (
    <section className="tarjeta space-y-4">
      <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="calendario" size={20} />Mi horario</h3>
      <div>
        <span className="etiqueta">Al abrir la app, mostrar</span>
        <Segmentado etiqueta="Pantalla al abrir" valor={pantalla} onCambio={(v) => { setPantalla(v); guardarPantallaInicial(v) }} opciones={[
          { id: 'inicio', texto: 'Inicio' }, { id: 'horario', texto: 'Horario' }, { id: 'bolsa', texto: 'Permutas' },
        ]} />
      </div>
      <div>
        <span className="etiqueta">Vista del horario</span>
        <Segmentado etiqueta="Vista del horario" valor={vista} onCambio={(v) => { setVista(v); try { localStorage.setItem('chambea.vista', v) } catch { /* nada */ } }} opciones={[
          { id: 'agenda', texto: 'Agenda' }, { id: 'semana', texto: 'Semana' }, { id: 'mes', texto: 'Mes' },
        ]} />
      </div>
      <div>
        <span className="etiqueta">Formato de hora</span>
        <Segmentado etiqueta="Formato de hora" valor={h24 ? '24' : '12'} onCambio={(v) => { setH24(v === '24'); usar24h(v === '24') }} opciones={[
          { id: '12', texto: '7 AM – 7 PM' }, { id: '24', texto: '07:00 – 19:00' },
        ]} />
      </div>
      <Interruptor activo={pausas} etiqueta="Ver comida y descanso en el horario" ayuda="En Inicio siempre se muestran."
        onCambio={(v) => { setPausas(v); guardarPausasVisibles(v) }} />
    </section>
  )
}

function AvisosPersonales({ cuenta, recargar, avisar }) {
  const [p, setP] = useState({
    recordar_marcaje: cuenta.recordar_marcaje !== false,
    marcaje_min: cuenta.marcaje_min || 15,
    avisar_bolsa: cuenta.avisar_bolsa !== false,
  })
  const cambiar = async (campo, valor) => {
    const antes = p
    setP({ ...p, [campo]: valor })
    try { await rpc('guardar_preferencias', { p: { [campo]: valor } }); await recargar() }
    catch (e) { setP(antes); avisar(e.message, 'error') }
  }
  return (
    <section className="tarjeta space-y-4">
      <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="campanaSuena" size={20} />Qué me avisan</h3>
      <Interruptor activo={p.recordar_marcaje} onCambio={(v) => cambiar('recordar_marcaje', v)}
        etiqueta={<span className="flex items-center gap-2"><Icono n="huella" size={18} className="text-marca-texto" />Marcar en GeoVictoria</span>}
        ayuda="Antes de cada turno de planilla." />
      {p.recordar_marcaje && (
        <div>
          <span className="etiqueta">¿Cuántos minutos antes?</span>
          <Segmentado etiqueta="Minutos antes" valor={String(p.marcaje_min)} onCambio={(v) => cambiar('marcaje_min', Number(v))}
            opciones={[5, 10, 15, 20, 30].map((m) => ({ id: String(m), texto: `${m}` }))} />
        </div>
      )}
      <Interruptor activo={p.avisar_bolsa} onCambio={(v) => cambiar('avisar_bolsa', v)}
        etiqueta="Nuevas permutas y donaciones" ayuda="Cuando un compañero publica un turno que puedes tomar. Las propuestas para ti siempre te llegan." />
    </section>
  )
}

function WhatsApp({ cuenta, recargar, avisar }) {
  const [tel, setTel] = useState(cuenta.telefono || '')
  const [guardando, setGuardando] = useState(false)
  const cambio = limpiarTel(tel) !== cuenta.telefono
  const guardar = async () => {
    if (!telValido(tel)) return avisar('Escribe un número de 8 dígitos que empiece con 6 o 7.', 'error')
    setGuardando(true)
    try { await rpc('guardar_telefono', { p_telefono: limpiarTel(tel) }); await recargar(); avisar('WhatsApp actualizado') }
    catch (e) { avisar(e.message, 'error') } finally { setGuardando(false) }
  }
  return (
    <section className="tarjeta space-y-3">
      <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="whatsapp" size={20} />Mi WhatsApp</h3>
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
    try { await activarPush(); setEstado('activo'); await probarPush().catch(() => {}); avisar('Avisos activados') }
    catch (e) { avisar(e.message, 'error') } finally { setOcupado(false) }
  }
  const apagar = async () => {
    setOcupado(true)
    try { await desactivarPush(); setEstado('inactivo'); avisar('Avisos desactivados en este dispositivo') }
    finally { setOcupado(false) }
  }
  return (
    <section className="tarjeta space-y-2">
      <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="notificaciones" size={20} />Avisos en el celular</h3>
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
      <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="celular" size={20} />Instalar la app</h3>
      {directo ? (
        <button className="btn-primario w-full" onClick={instalarDirecto}>Instalar Chambea</button>
      ) : p === 'ios' ? (
        <p className="text-sm text-slate-600">En Safari toca <b>Compartir</b> <Icono n="compartir" size={16} className="inline-block align-text-bottom" /> y luego <b>Agregar a inicio</b>. Quedará como una app más.</p>
      ) : p === 'android' ? (
        <p className="text-sm text-slate-600">En Chrome toca el menú <b>⋮</b> y luego <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.</p>
      ) : (
        <p className="text-sm text-slate-600">En Chrome o Edge, usa el ícono de instalar en la barra de direcciones.</p>
      )}
    </section>
  )
}

// Ajustes generales (solo admin): afectan a todo el equipo
export function AjustesAdmin({ avisar }) {
  const [a, setA] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [cambios, setCambios] = useState({})
  useEffect(() => {
    supabase.from('ajustes').select('*').eq('id', 1).single().then(({ data }) => setA(data))
  }, [])
  if (!a) return null
  const poner = (campo, valor) => { setA({ ...a, [campo]: valor }); setCambios({ ...cambios, [campo]: valor }) }
  const guardar = async () => {
    setGuardando(true)
    try {
      await rpc('guardar_ajustes_generales', { p: cambios })
      if (cambios.logo) aplicarLogo(cambios.logo)
      setCambios({})
      avisar('Ajustes generales guardados')
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setGuardando(false)
    }
  }
  const hay = Object.keys(cambios).length > 0
  return (
    <div className="space-y-4 pb-20">
      <p className="text-sm text-slate-600">Estos ajustes aplican a <b>todo el equipo</b>. Cada quien tiene además sus ajustes personales en Cuenta.</p>

      <section className="tarjeta space-y-3">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="novedades" size={20} />Logo de la app</h3>
        <p className="text-xs text-slate-500">Lo ve todo el equipo, también en el ícono de inicio. Quien ya instaló la app ve el nuevo ícono al quitarla y volver a agregarla (en iPhone) o al actualizarse sola (en Android).</p>
        <div role="radiogroup" aria-label="Logo de la app" className="grid grid-cols-5 gap-2">
          {LOGOS.map((l) => (
            <button key={l.id} role="radio" aria-checked={a.logo === l.id} aria-label={l.texto} onClick={() => poner('logo', l.id)}
              className={`flex flex-col items-center gap-1 rounded-2xl p-1.5 text-[11px] font-semibold leading-tight text-slate-700 transition active:scale-95 ${a.logo === l.id ? 'bg-marca-claro ring-2 ring-marca' : 'ring-1 ring-slate-200'}`}>
              <img src={`/icons/logos/${l.id}.svg`} alt="" className="aspect-square w-full rounded-xl" />
              <span className="line-clamp-2 text-center">{l.texto}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="tarjeta space-y-4">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="usuarios" size={20} />Cuentas</h3>
        <Interruptor activo={a.registro_abierto} onCambio={(v) => poner('registro_abierto', v)} etiqueta="Registro abierto"
          ayuda={a.registro_abierto ? 'Cualquiera con el enlace se registra y queda listo si su nombre está en el horario.' : 'Las cuentas nuevas esperan tu aprobación en Usuarios.'} />
        <div>
          <span className="etiqueta">¿Quién puede corregir turnos?</span>
          <Segmentado etiqueta="Quién corrige turnos" valor={a.edicion_turnos} onCambio={(v) => poner('edicion_turnos', v)} opciones={[
            { id: 'todos', texto: 'Cada quien los suyos' }, { id: 'admin', texto: 'Solo administración' },
          ]} />
          <p className="mt-1 text-xs text-slate-500">Cuando alguien corrige un turno te llega un aviso.</p>
        </div>
      </section>

      <section className="tarjeta space-y-4">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="cambio" size={20} />Reglas de permutas</h3>
        <label className="block text-sm text-slate-700">
          Descanso mínimo entre turnos de planilla
          <span className="block text-xs text-slate-500">Con menos horas se consideran "pegados" y no se sugieren.</span>
          <span className="mt-1 flex items-center gap-2">
            <input type="number" inputMode="numeric" min={0} max={24} className="input w-24" value={a.min_descanso_planilla_h}
              onChange={(e) => poner('min_descanso_planilla_h', Number(e.target.value))} /> horas
          </span>
        </label>
        <label className="block text-sm text-slate-700">
          Avisar jornadas de más de
          <span className="mt-1 flex items-center gap-2">
            <input type="number" inputMode="numeric" min={8} max={72} className="input w-24" value={a.max_horas_continuas}
              onChange={(e) => poner('max_horas_continuas', Number(e.target.value))} /> horas seguidas
          </span>
        </label>
        <p className="text-xs text-slate-500">Planilla: solo permutas. Servicios Profesionales: permutas y donaciones.</p>
      </section>

      <section className="tarjeta space-y-4">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="huella" size={20} />GeoVictoria y horario</h3>
        <Interruptor activo={a.geovictoria_activo} onCambio={(v) => poner('geovictoria_activo', v)} etiqueta="Recordatorio de GeoVictoria"
          ayuda="Si lo apagas aquí, nadie recibe el recordatorio aunque lo tenga activado." />
        <label className="block text-sm text-slate-700">
          Recordarme subir el horario
          <span className="mt-1 flex items-center gap-2">
            <input type="number" inputMode="numeric" min={1} max={15} className="input w-24" value={a.recordar_carga_dias}
              onChange={(e) => poner('recordar_carga_dias', Number(e.target.value))} /> días antes de que se acabe
          </span>
        </label>
      </section>

      <section className="tarjeta space-y-3">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="campanaSuena" size={20} />Anuncio para todos</h3>
        <p className="text-xs text-slate-500">Aparece arriba en Inicio para todo el equipo. Déjalo vacío para quitarlo.</p>
        <textarea className="input" rows={2} maxLength={280} placeholder="Ej.: Ya está cargada la 2.ª quincena de SP."
          value={a.anuncio || ''} onChange={(e) => poner('anuncio', e.target.value)} />
        <label className="block text-sm text-slate-700">
          Mostrar hasta (opcional)
          <input type="date" className="input mt-1" value={a.anuncio_hasta || ''} onChange={(e) => poner('anuncio_hasta', e.target.value)} />
        </label>
      </section>

      {hay && (
        <div className="animar-entrada fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 px-4 md:bottom-6 md:left-60">
          <button className="btn-primario mx-auto flex w-full max-w-md items-center justify-center gap-2 py-3 shadow-lg" disabled={guardando} onClick={guardar}>
            <Icono n="check" size={18} />{guardando ? 'Guardando…' : 'Guardar ajustes generales'}
          </button>
        </div>
      )}
    </div>
  )
}
