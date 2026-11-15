// Admin → Usuarios: aprobar cuentas nuevas (enlazándolas a su nombre del horario),
// activar/desactivar, nombrar administradores y restablecer PIN.
import { useCallback, useEffect, useState } from 'react'
import { supabase, mensajeError } from '../../lib/supabase'
import { useAuth, esSuperadmin } from '../../lib/auth'
import { invocar, pinAleatorio } from '../../lib/funciones'
import Icono from '../../components/Icono'
import { Aviso, Cargando, Hoja, Vacio } from '../../components/ui'

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
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Icono n="usuarios" size={26} className="text-marca-texto" />Usuarios</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Por aprobar ({pendientes.length})</h2>
        {pendientes.length === 0 ? <Vacio>No hay cuentas esperando.</Vacio> : (
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
                <span className="block truncate text-xs text-slate-500">@{u.usuario} · {u.persona ?? 'sin enlazar'}</span>
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
    avisar(`${u.nombre.split(' ')[0]} aprobado ✅`)
    alListo()
  }
  const rechazar = async () => {
    if (!confirm(`¿Rechazar la cuenta de ${u.nombre}? Quedará desactivada.`)) return
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
          <Icono n="check" size={18} className="mr-1 -mt-0.5 align-middle" />Aprobar
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

  const reenlazar = () => ejecutar(() => rpc('aprobar_usuario', { p_perfil: u.id, p_persona: persona }), 'Enlace actualizado ✅')
  const estado = () => ejecutar(() => rpc('cambiar_estado_usuario', { p_perfil: u.id, p_activo: !u.activo }),
    u.activo ? 'Cuenta desactivada' : 'Cuenta activada ✅')
  const rol = () => ejecutar(() => rpc('asignar_rol', { p_perfil: u.id, p_rol: u.rol === 'admin' ? 'usuario' : 'admin' }), 'Rol actualizado ✅')
  const restablecer = async () => {
    if (!confirm(`¿Cambiar el PIN de ${u.nombre} a ${pin}?`)) return
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
