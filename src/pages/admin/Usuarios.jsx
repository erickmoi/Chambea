// Admin → Usuarios: enlazar cuentas que no se encontraron en el horario,
// activar/desactivar, nombrar administradores y restablecer PIN.
import { useCallback, useEffect, useState } from 'react'
import { supabase, mensajeError } from '../../lib/supabase'
import { useAuth, esSuperadmin } from '../../lib/auth'
import { invocar, pinAleatorio } from '../../lib/funciones'
import { enlaceWaA, telBonito } from '../../lib/datos'
import Icono from '../../components/Icono'
import { Aviso, Cargando, Hoja, Vacio, confirmar } from '../../components/ui'

const ROLES = { superadmin: 'Superadmin', admin: 'Admin', usuario: 'Compañero' }

export default function Usuarios() {
  const { cuenta } = useAuth()
  const [lista, setLista] = useState(null)
  const [libres, setLibres] = useState([])
  const [abierto, setAbierto] = useState(null)
  const [aviso, setAviso] = useState(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  const avisar = (texto, tipo = 'ok') => setAviso({ texto, tipo })

  const cargar = useCallback(async () => {
    const [u, p] = await Promise.all([supabase.rpc('usuarios_admin'), supabase.rpc('personas_sin_cuenta')])
    if (u.error || p.error) return setAviso({ tipo: 'error', texto: mensajeError(u.error || p.error) })
    setLista(u.data)
    setLibres(p.data)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (!lista) return <div className="p-4"><Cargando /></div>

  const pendientes = lista.filter((u) => !u.aprobado && u.activo)
  const activos = lista.filter((u) => u.aprobado && u.activo)
  const inactivos = lista.filter((u) => !u.activo)

  return (
    <div className="space-y-5">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      <h2 className="sr-only">Usuarios</h2>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sin enlazar ({pendientes.length})</h2>
        {pendientes.length === 0 ? <Vacio>Todas las cuentas están enlazadas a su nombre del horario.</Vacio> : (
          <div className="escalonado space-y-3">
            {pendientes.map((u) => <TarjetaPendiente key={u.id} u={u} libres={libres} avisar={avisar} alListo={cargar} />)}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Activos ({activos.length})</h2>
        <div className="tarjeta divide-y divide-slate-100 p-0">
          {activos.map((u) => (
            <button key={u.id} onClick={() => setAbierto(u)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{u.nombre}</span>
                <span className="block truncate text-xs text-slate-500">@{u.usuario} · {u.persona ?? 'sin enlazar'}{u.telefono ? ` · ${telBonito(u.telefono)}` : ''}</span>
              </span>
              {u.rol !== 'usuario' && <span className="shrink-0 rounded-full bg-marca-claro px-2 py-0.5 text-xs font-semibold text-marca-texto">{ROLES[u.rol]}</span>}
            </button>
          ))}
        </div>
      </section>

      {inactivos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Desactivados ({inactivos.length})</h2>
          <div className="tarjeta divide-y divide-slate-100 p-0">
            {inactivos.map((u) => (
              <button key={u.id} onClick={() => setAbierto(u)} className="flex w-full items-center justify-between px-4 py-3 text-left opacity-70 hover:bg-slate-50">
                <span className="truncate">{u.nombre} <span className="text-xs text-slate-500">@{u.usuario}</span></span>
              </button>
            ))}
          </div>
        </section>
      )}

      <Personas avisar={avisar} />

      {abierto && (
        <DetalleUsuario u={abierto} yo={cuenta} libres={libres} avisar={avisar}
          onCerrar={() => setAbierto(null)} alListo={() => { setAbierto(null); cargar() }} />
      )}
    </div>
  )
}

function SelectorPersona({ valor, onCambio, libres, actual }) {
  const opciones = actual && !libres.some((p) => p.id === actual.id) ? [actual, ...libres] : libres
  return (
    <select className="input" value={valor ?? ''} onChange={(e) => onCambio(e.target.value ? Number(e.target.value) : null)}>
      <option value="">— Elige su nombre del horario —</option>
      {opciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
    </select>
  )
}

function TarjetaPendiente({ u, libres, avisar, alListo }) {
  const [persona, setPersona] = useState(u.sugerida_id)
  const [enviando, setEnviando] = useState(false)

  const aprobar = async () => {
    setEnviando(true)
    const { error } = await supabase.rpc('aprobar_usuario', { p_perfil: u.id, p_persona: persona })
    setEnviando(false)
    if (error) return avisar(mensajeError(error), 'error')
    avisar(`${u.nombre.split(' ')[0]} enlazado`)
    alListo()
  }
  const rechazar = async () => {
    if (!(await confirmar({ titulo: 'Rechazar cuenta', texto: `La cuenta de ${u.nombre} quedará desactivada.`, boton: 'Rechazar', peligro: true }))) return
    setEnviando(true)
    const { error } = await supabase.rpc('cambiar_estado_usuario', { p_perfil: u.id, p_activo: false })
    setEnviando(false)
    if (error) return avisar(mensajeError(error), 'error')
    alListo()
  }

  return (
    <div className="tarjeta space-y-3">
      <div>
        <p className="font-semibold text-slate-900">{u.nombre}</p>
        <p className="text-xs text-slate-500">@{u.usuario} · se registró el {new Date(u.creado).toLocaleDateString('es-SV')}</p>
      </div>
      {u.sugerida_id
        ? <p className="flex items-center gap-1.5 text-sm text-sky-800"><Icono n="enlace" size={16} />Sugerido: <b>{u.sugerida}</b></p>
        : <p className="flex items-center gap-1.5 text-sm text-amber-700"><Icono n="alerta" size={16} />No encontré su nombre en el horario; elígelo.</p>}
      <SelectorPersona valor={persona} onCambio={setPersona} libres={libres}
        actual={u.sugerida_id ? { id: u.sugerida_id, nombre: u.sugerida } : null} />
      <div className="flex gap-2">
        <button className="btn-primario flex-1" disabled={enviando || !persona} onClick={aprobar}>
          <Icono n="check" size={18} className="mr-1 -mt-0.5 align-middle" />Enlazar
        </button>
        <button className="btn-peligro" disabled={enviando} onClick={rechazar}>Rechazar</button>
      </div>
    </div>
  )
}

function DetalleUsuario({ u, yo, libres, avisar, onCerrar, alListo }) {
  const [persona, setPersona] = useState(u.persona_id)
  const [pin, setPin] = useState(pinAleatorio)
  const [pinListo, setPinListo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const soyYo = u.id === yo.id
  const puedoTocar = !soyYo && u.rol !== 'superadmin' && (u.rol !== 'admin' || esSuperadmin(yo))

  const ejecutar = async (fn, ok) => {
    setEnviando(true)
    try {
      await fn()
      if (ok) avisar(ok)
      alListo()
    } catch (e) {
      avisar(mensajeError(e), 'error')
    } finally {
      setEnviando(false)
    }
  }
  const rpc = async (nombre, args) => {
    const { error } = await supabase.rpc(nombre, args)
    if (error) throw error
  }

  const reenlazar = () => ejecutar(() => rpc('aprobar_usuario', { p_perfil: u.id, p_persona: persona }), 'Enlace actualizado')
  const estado = () => ejecutar(() => rpc('cambiar_estado_usuario', { p_perfil: u.id, p_activo: !u.activo }),
    u.activo ? 'Cuenta desactivada' : 'Cuenta activada')
  const rol = () => ejecutar(() => rpc('asignar_rol', { p_perfil: u.id, p_rol: u.rol === 'admin' ? 'usuario' : 'admin' }), 'Rol actualizado')
  const restablecer = async () => {
    if (!(await confirmar({ titulo: 'Cambiar PIN', texto: `El PIN de ${u.nombre} será ${pin}.`, boton: 'Cambiar PIN' }))) return
    setEnviando(true)
    try {
      await invocar('admin-usuarios', { accion: 'restablecer_pin', usuario_id: u.id, pin })
      setPinListo(true)
    } catch (e) {
      avisar(mensajeError(e), 'error')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja titulo={u.nombre} icono="cuenta" onCerrar={onCerrar}>
      <div className="space-y-5">
        <p className="text-sm text-slate-500">@{u.usuario} · {ROLES[u.rol]}{u.activo ? '' : ' · desactivada'}</p>
        {u.telefono && (
          <a className="btn-secundario flex items-center justify-center gap-2 text-emerald-700" target="_blank" rel="noreferrer"
            href={enlaceWaA(u.telefono, `¡Hola, ${u.nombre.split(' ')[0]}! 👋 ¿Qué tal? `)}>
            <Icono n="whatsapp" size={20} />WhatsApp {telBonito(u.telefono)}
          </a>
        )}

        <div className="space-y-2">
          <span className="etiqueta flex items-center gap-1"><Icono n="enlace" size={16} />Nombre en el horario</span>
          <SelectorPersona valor={persona} onCambio={setPersona} libres={libres}
            actual={u.persona_id ? { id: u.persona_id, nombre: u.persona } : null} />
          {persona !== u.persona_id && (
            <button className="btn-primario w-full" disabled={enviando || !persona} onClick={reenlazar}>Guardar enlace</button>
          )}
        </div>

        {puedoTocar && (
          <div className="space-y-2">
            <span className="etiqueta flex items-center gap-1"><Icono n="llave" size={16} />Restablecer PIN</span>
            {pinListo ? (
              <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
                Listo. Nuevo PIN de {u.nombre.split(' ')[0]}: <b className="font-mono text-lg tracking-[0.2em]">{pin}</b>
              </p>
            ) : (
              <div className="flex gap-2">
                <input className="input font-mono tracking-[0.3em]" inputMode="numeric" value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                <button type="button" className="btn-secundario shrink-0" onClick={() => setPin(pinAleatorio())} aria-label="Otro PIN">
                  <Icono n="dado" size={18} />
                </button>
                <button className="btn-primario shrink-0" disabled={enviando || pin.length !== 6} onClick={restablecer}>Cambiar</button>
              </div>
            )}
          </div>
        )}

        {puedoTocar && (
          <div className="flex flex-col gap-2">
            {esSuperadmin(yo) && u.activo && (
              <button className="btn-secundario" disabled={enviando} onClick={rol}>
                <Icono n="seguridad" size={18} className="mr-1 -mt-0.5 align-middle" />
                {u.rol === 'admin' ? 'Quitar administración' : 'Hacer administrador'}
              </button>
            )}
            <button className={u.activo ? 'btn-peligro' : 'btn-primario'} disabled={enviando} onClick={estado}>
              {u.activo ? 'Desactivar cuenta' : 'Activar cuenta'}
            </button>
          </div>
        )}
      </div>
    </Hoja>
  )
}

// Funciones de cada persona del horario (se infieren al cargar el Excel; aquí se corrigen)
function Personas({ avisar }) {
  const [lista, setLista] = useState(null)
  const [abierto, setAbierto] = useState(false)
  const [filtro, setFiltro] = useState('')
  useEffect(() => {
    if (!abierto || lista) return
    supabase.from('personas').select('id, nombre, es_supervisor, referencias_planilla, referencias_sp, activo, gerencia').order('nombre')
      .then(({ data }) => setLista(data || []))
  }, [abierto, lista])

  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevaGerencia, setNuevaGerencia] = useState(false)
  const agregarPersona = async () => {
    const { error } = await supabase.rpc('agregar_persona', { p_nombre: nuevoNombre, p_gerencia: nuevaGerencia })
    if (error) return avisar(mensajeError(error), 'error')
    avisar('Persona agregada'); setNuevoNombre(''); setNuevaGerencia(false); setLista(null)
  }
  // Categoría en planilla: una sola a la vez
  const categoria = (p) => (p.gerencia ? 'gerencia' : p.es_supervisor ? 'supervisor' : p.referencias_planilla ? 'referencias' : 'triaje')
  const ponerCategoria = (p, c) => guardar(p, { ...p, gerencia: c === 'gerencia', es_supervisor: c === 'supervisor', referencias_planilla: c === 'referencias' })
  const cambiar = (p, campo) => guardar(p, { ...p, [campo]: !p[campo] })
  const guardar = async (p, nuevo) => {
    setLista((l) => l.map((x) => (x.id === p.id ? nuevo : x)))
    const { error } = await supabase.rpc('actualizar_persona', {
      p_id: p.id, p_es_supervisor: nuevo.es_supervisor, p_referencias_planilla: nuevo.referencias_planilla,
      p_referencias_sp: nuevo.referencias_sp, p_activo: nuevo.activo, p_gerencia: nuevo.gerencia,
    })
    if (error) { avisar(mensajeError(error), 'error'); setLista((l) => l.map((x) => (x.id === p.id ? p : x))) }
  }
  const chip = (p, campo, texto) => (
    <button onClick={() => cambiar(p, campo)}
      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition active:scale-95 ${p[campo] ? 'bg-marca text-sobre-marca' : 'bg-slate-100 text-slate-500'}`}>
      {texto}
    </button>
  )
  const visibles = (lista || []).filter((p) => p.nombre.toLowerCase().includes(filtro.toLowerCase()))

  return (
    <section className="space-y-2">
      <button onClick={() => setAbierto(!abierto)} className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500">
        Personas del horario y sus funciones <Icono n={abierto ? 'cerrar' : 'mas'} size={18} />
      </button>
      {abierto && (
        <div className="tarjeta space-y-3">
          <p className="text-xs text-slate-500">La categoría define con quién permuta cada persona en planilla. Gerencia médica no participa en permutas y agrega sus turnos a mano.</p>
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-700">Agregar persona que no está en el horario</p>
            <input className="input" placeholder="Nombre completo, como en la hoja" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
            <div className="flex items-center gap-2">
              <button onClick={() => setNuevaGerencia(!nuevaGerencia)} aria-pressed={nuevaGerencia}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${nuevaGerencia ? 'bg-marca text-sobre-marca' : 'bg-slate-200 text-slate-600'}`}>Gerencia médica</button>
              <button className="btn-primario ml-auto px-4 py-2 text-sm" disabled={nuevoNombre.trim().length < 5} onClick={agregarPersona}>Agregar</button>
            </div>
          </div>
          <input className="input" placeholder="Buscar nombre" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          {!lista ? <Cargando filas={3} /> : (
            <ul className="divide-y divide-slate-100">
              {visibles.map((p) => (
                <li key={p.id} className="space-y-1.5 py-2.5">
                  <p className={`text-sm font-medium ${p.activo ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{p.nombre}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <select className="input w-auto py-1 text-xs font-semibold" aria-label={`Categoría de ${p.nombre}`}
                      value={categoria(p)} onChange={(e) => ponerCategoria(p, e.target.value)}>
                      <option value="triaje">Triaje</option>
                      <option value="referencias">Referencias</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="gerencia">Gerencia médica</option>
                    </select>
                    {chip(p, 'referencias_sp', 'Ref. SP')}
                    {chip(p, 'activo', 'Activa')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
