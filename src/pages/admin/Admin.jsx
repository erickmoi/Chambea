// Administración en una sola pestaña: Panel · Usuarios · Cargar horario · Ajustes generales
import { Suspense, useCallback, useEffect, useState } from 'react'
import Icono from '../../components/Icono'
import { Aviso, Cargando } from '../../components/ui'
import { Segmentado } from '../../components/turnos'
import { lazySeguro } from '../../lib/cargaSegura'
import Fallo from '../../components/Fallo'
import { AjustesAdmin } from '../MiCuenta.jsx'
import { rpc, enlaceWhatsApp, enlaceWaA, nombreBonito } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { msgInvitar, msgActivarAvisos } from '../../lib/mensajes'
import { VERSION } from '../../lib/version'
import { hoy, sumarDias, fechaCorta, finMes, numDia, haceCuanto } from '../../lib/fechas'

const Usuarios = lazySeguro(() => import('./Usuarios.jsx'))
const Importar = lazySeguro(() => import('./Importar.jsx'))

const SECCIONES = [
  { id: 'panel', texto: 'Panel', icono: 'grafica' },
  { id: 'usuarios', texto: 'Usuarios', icono: 'usuarios' },
  { id: 'cargar', texto: 'Cargar', icono: 'excel' },
  { id: 'ajustes', texto: 'Ajustes', icono: 'admin' },
]

export default function Admin({ inicial }) {
  const [sec, setSec] = useState(() => { if (inicial) return inicial; try { const v = localStorage.getItem('chambea.admin'); return v === 'reglas' ? 'ajustes' : v || 'panel' } catch { return 'panel' } })
  const [aviso, setAviso] = useState(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  useEffect(() => { try { localStorage.setItem('chambea.admin', sec) } catch { /* nada */ } }, [sec])

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
        <Icono n="seguridad" size={28} className="text-marca-texto" />Administración
      </h1>
      <Segmentado etiqueta="Sección de administración" valor={sec} onCambio={setSec}
        opciones={SECCIONES.map((s) => ({ ...s, texto: <span className="sr-only sm:not-sr-only">{s.texto}</span> }))} />
      <p className="-mt-2 text-center text-sm font-semibold text-slate-700 sm:hidden">{SECCIONES.find((s) => s.id === sec)?.texto}</p>

      <div key={sec} className="animar-entrada">
        <Fallo key={sec}>
        <Suspense fallback={<Cargando />}>
          {sec === 'panel' && <Panel irA={setSec} />}
          {sec === 'usuarios' && <Usuarios />}
          {sec === 'cargar' && <Importar />}
          {sec === 'ajustes' && <AjustesAdmin avisar={(texto, tipo = 'ok') => setAviso({ texto, tipo })} />}
        </Suspense>
        </Fallo>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- panel
function Panel({ irA }) {
  const [p, setP] = useState(null)
  const [faltan, setFaltan] = useState(null)
  const [error, setError] = useState('')
  const [verTodos, setVerTodos] = useState(false)
  const [sync, setSync] = useState(null)
  const [actividad, setActividad] = useState(null)
  // "En línea" se refresca solo cada 30 s mientras el panel está abierto
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') rpc('actividad_admin').then(setActividad, () => {}) }, 30000)
    return () => clearInterval(t)
  }, [])

  const cargar = useCallback(async () => {
    setError('')
    try {
      const [panel, sin, aj, act] = await Promise.all([rpc('panel_admin'), rpc('personas_sin_cuenta'),
        supabase.from('ajustes').select('sync_ultima, sync_resumen').eq('id', 1).single().then((x) => x.data, () => null),
        rpc('actividad_admin').catch(() => null)])
      setActividad(act)
      setSync(aj)
      setP(panel)
      setFaltan(sin)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  if (error) return <div className="flex items-center justify-between gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}<button className="btn-secundario px-3 py-1.5 text-sm" onClick={cargar}>Reintentar</button></div>
  if (!p) return <Cargando filas={4} />

  const pct = p.personas ? Math.round((p.con_cuenta / p.personas) * 100) : 0
  const recordatorios = recordatoriosCarga(p)
  const enlace = window.location.origin
  const invitar = (nombre) => enlaceWhatsApp(msgInvitar(nombre, enlace))

  return (
    <div className="space-y-4">
      {recordatorios.map((r) => (
        <button key={r.texto} onClick={() => irA('cargar')}
          className="flex w-full items-center gap-3 rounded-2xl bg-amber-50 p-3 text-left text-amber-800 ring-1 ring-amber-200">
          <Icono n="alarma" size={24} />
          <span className="flex-1 text-sm"><b>{r.texto}</b><span className="block">{r.sub}</span></span>
          <Icono n="siguiente" size={18} />
        </button>
      ))}

      {actividad && <Actividad a={actividad} />}
      {actividad && <SinAvisos usuarios={actividad.usuarios.filter((u) => !u.avisos)} enlace={enlace} />}
      <Salud />

      <section className="tarjeta" aria-labelledby="t-sync">
        <h2 id="t-sync" className="flex items-center gap-2 font-bold text-slate-900"><Icono n="recargar" size={20} className="text-marca-texto" />Hoja oficial</h2>
        {sync?.sync_ultima ? (
          <>
            <p className={`mt-1 text-sm ${Date.now() - new Date(sync.sync_ultima) > 3 * 36e5 ? 'text-amber-800' : 'text-slate-700'}`}>
              Última sincronización {haceCuanto(sync.sync_ultima)}{sync.sync_resumen?.cambios ? ` · ${sync.sync_resumen.cambios} cambio(s)` : ' · sin cambios'}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {(sync.sync_resumen?.secciones || []).map((s, i) => (
                <li key={i}>{s.seccion === 'sp' ? 'Servicios Profesionales' : 'Planilla'} ({s.hoja}): {s.error ? <span className="text-red-700">{s.error}</span> : `${s.pausas} pausas · ${s.insertados} nuevos · ${s.reemplazados} quitados`}</li>
              ))}
            </ul>
            {Date.now() - new Date(sync.sync_ultima) > 3 * 36e5 && <p className="mt-1 text-xs text-amber-800">Hace más de 3 horas que no llega nada: revisa el puente en script.google.com.</p>}
          </>
        ) : <p className="mt-1 text-sm text-slate-600">Todavía no se ha conectado el puente con la hoja oficial.</p>}
      </section>

      <section className="tarjeta" aria-labelledby="t-registro">
        <div className="flex items-end justify-between gap-2">
          <h2 id="t-registro" className="font-bold text-slate-900">Equipo registrado</h2>
          <span className="mono text-sm text-slate-600">{p.con_cuenta} de {p.personas}</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Equipo registrado">
          <div className="h-full rounded-full bg-marca transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-600">{pct}% del horario ya usa Chambea{p.sin_enlazar > 0 ? ` · ${p.sin_enlazar} cuenta(s) sin enlazar` : ''}</p>
      </section>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato icono="trato" valor={p.abiertas} texto="Solicitudes abiertas" />
        <Dato icono="repetir" valor={p.cambios_mes} texto="Cambios este mes" sub={`${p.cambios_mes_planilla} de planilla`} />
        <Dato icono="calendarioOk" valor={p.hasta_planilla ? fechaCorta(p.hasta_planilla) : '—'} texto="Planilla cargada hasta" chico />
        <Dato icono="calendarioOk" valor={p.hasta_sp ? fechaCorta(p.hasta_sp) : '—'} texto="SP cargado hasta" chico />
      </dl>
      {p.ultima_carga && <p className="text-xs text-slate-600">Última carga de horario {haceCuanto(p.ultima_carga)}.</p>}

      <section className="tarjeta p-0" aria-labelledby="t-faltan">
        <h2 id="t-faltan" className="flex items-center justify-between gap-2 px-4 pt-4 pb-2 font-bold text-slate-900">
          Faltan por registrarse <span className="mono text-sm font-normal text-slate-600">{faltan.length}</span>
        </h2>
        {faltan.length === 0 ? <p className="px-4 pb-4 text-sm text-slate-600">¡Todo el equipo tiene cuenta!</p> : (
          <ul className="divide-y divide-slate-100">
            {(verTodos ? faltan : faltan.slice(0, 8)).map((x) => (
              <li key={x.id} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-slate-800">{nombreBonito(x.nombre)}</span>
                <a href={invitar(x.nombre)} target="_blank" rel="noreferrer"
                  className="flex min-h-9 items-center gap-1 rounded-full bg-emerald-50 px-3 text-sm font-semibold text-emerald-700">
                  <Icono n="whatsapp" size={16} />Invitar
                </a>
              </li>
            ))}
          </ul>
        )}
        {faltan.length > 8 && (
          <button className="w-full border-t border-slate-100 py-2.5 text-sm font-semibold text-marca-texto" onClick={() => setVerTodos(!verTodos)}>
            {verTodos ? 'Ver menos' : `Ver los ${faltan.length}`}
          </button>
        )}
        <a href={enlaceWhatsApp(msgInvitar('', enlace).replace('¡Hola! 👋 ¿Qué tal?', '¡Hola, equipo! 👋'))} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-2 border-t border-slate-100 py-3 text-sm font-semibold text-emerald-700">
          <Icono n="whatsapp" size={18} />Invitar al grupo de WhatsApp
        </a>
      </section>
    </div>
  )
}

function Dato({ icono, valor, texto, sub, chico }) {
  return (
    <div className="rounded-2xl bg-superficie p-3 ring-1 ring-slate-200">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><Icono n={icono} size={16} className="text-marca-texto" />{texto}</dt>
      <dd className={`mono mt-1 font-semibold text-slate-900 ${chico ? 'text-base' : 'text-2xl'}`}>{valor}</dd>
      {sub && <dd className="text-[11px] text-slate-500">{sub}</dd>}
    </div>
  )
}

// SP se carga por quincena y planilla por mes: avisa cuando falta poco para quedarse sin horario
function recordatoriosCarga(p) {
  const r = []
  const d = hoy()
  const dias = p.recordar_carga_dias ?? 4
  if (!p.hasta_sp || p.hasta_sp <= sumarDias(d, dias)) {
    const q2 = numDia(p.hasta_sp || d) <= 15
    r.push({ texto: `Toca subir la ${q2 ? '2.ª' : '1.ª'} quincena de SP`, sub: p.hasta_sp ? `SP está cargado hasta el ${fechaCorta(p.hasta_sp)}.` : 'Todavía no hay SP cargado.' })
  }
  if (!p.hasta_planilla || (p.hasta_planilla <= finMes(d) && p.hasta_planilla <= sumarDias(d, dias))) {
    r.push({ texto: 'Toca subir la planilla del próximo mes', sub: p.hasta_planilla ? `Planilla está cargada hasta el ${fechaCorta(p.hasta_planilla)}.` : 'Todavía no hay planilla cargada.' })
  }
  return r
}

// ---------------------------------------------------------------- actividad en la app
function Actividad({ a }) {
  const [verLista, setVerLista] = useState(false)
  const enLinea = a.usuarios.filter((u) => u.en_linea)
  const max = Math.max(1, ...a.por_dia.map((d) => d.n))
  const viejas = a.usuarios.filter((u) => u.version && u.version !== VERSION).length
  return (
    <section className="tarjeta space-y-3" aria-labelledby="t-actividad">
      <div className="flex items-center justify-between gap-2">
        <h2 id="t-actividad" className="flex items-center gap-2 font-bold text-slate-900"><Icono n="grafica" size={20} className="text-marca-texto" />Actividad</h2>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700" aria-live="polite">
          <span className="relative flex h-2.5 w-2.5">
            {a.en_linea > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${a.en_linea > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          </span>
          {a.en_linea} en línea
        </span>
      </div>
      {enLinea.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {enLinea.map((u) => <span key={u.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{nombreBonito(u.nombre).split(' ').slice(0, 2).join(' ')}</span>)}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato icono="usuarios" valor={a.hoy} texto="Entraron hoy" sub={`de ${a.cuentas} cuentas`} />
        <Dato icono="calendario" valor={a.semana} texto="Últimos 7 días" sub={`${Math.round((a.semana / Math.max(1, a.cuentas)) * 100)}% del equipo`} />
        <Dato icono="notificaciones" valor={`${a.con_avisos}/${a.cuentas}`} texto="Con avisos" chico />
        <Dato icono="descargar" valor={`${a.instaladas}/${a.cuentas}`} texto="App instalada" chico sub={viejas ? `${viejas} con versión vieja` : undefined} />
      </dl>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">Personas por día (últimas 2 semanas)</p>
        <div className="flex h-20 items-end gap-1" role="img" aria-label={`Uso diario: ${a.por_dia.map((d) => `${fechaCorta(d.fecha)} ${d.n}`).join(', ')}`}>
          {a.por_dia.map((d) => (
            <div key={d.fecha} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" title={`${fechaCorta(d.fecha)}: ${d.n}`}>
              {d.n > 0 && <span className="mono text-[10px] text-slate-500">{d.n}</span>}
              <div className={`w-full rounded-t transition-all duration-700 ${d.fecha === hoy() ? 'bg-marca' : 'bg-marca/40'}`} style={{ height: `${Math.max(4, (d.n / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-0.5 flex justify-between text-[10px] text-slate-500"><span>{fechaCorta(a.por_dia[0]?.fecha)}</span><span>Hoy</span></div>
      </div>
      <button className="flex w-full items-center justify-between border-t border-slate-100 pt-2.5 text-sm font-semibold text-marca-texto" onClick={() => setVerLista(!verLista)}>
        Última vez de cada persona <Icono n={verLista ? 'cerrar' : 'siguiente'} size={16} />
      </button>
      {verLista && (
        <ul className="divide-y divide-slate-100">
          {a.usuarios.map((u) => (
            <li key={u.id} className="flex items-center gap-2 py-2 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${u.en_linea ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-900">{nombreBonito(u.nombre)}</span>
                <span className="block text-xs text-slate-500">
                  {u.en_linea ? 'En línea' : u.ultima_vez ? haceCuanto(u.ultima_vez) : 'Sin datos todavía'}
                  {u.dias_7 ? ` · ${u.dias_7} de 7 días` : ''}{u.version ? ` · v${u.version}` : ''}
                </span>
              </span>
              {!u.avisos && <Icono n="notificaciones" size={16} className="text-amber-600" title="Sin avisos" />}
              {u.instalada && <Icono n="descargar" size={16} className="text-marca-texto" title="App instalada" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- quiénes no tienen avisos activados
function SinAvisos({ usuarios, enlace }) {
  if (!usuarios.length) return null
  return (
    <section className="tarjeta p-0" aria-labelledby="t-sin-avisos">
      <h2 id="t-sin-avisos" className="flex items-center justify-between gap-2 px-4 pt-4 pb-1 font-bold text-slate-900">
        <span className="flex items-center gap-2"><Icono n="notificaciones" size={20} className="text-amber-600" />Sin avisos activados</span>
        <span className="mono text-sm font-normal text-slate-600">{usuarios.length}</span>
      </h2>
      <p className="px-4 pb-2 text-xs text-slate-600">No les llegan recordatorios al teléfono. Mándales los pasos por WhatsApp.</p>
      <ul className="divide-y divide-slate-100">
        {usuarios.map((u) => (
          <li key={u.id} className="flex items-center gap-2 px-4 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-slate-800">{nombreBonito(u.nombre)}</span>
              <span className="block text-xs text-slate-500">{u.ultima_vez ? `Entró ${haceCuanto(u.ultima_vez)}` : `@${u.usuario}`}</span>
            </span>
            <a href={u.telefono ? enlaceWaA(u.telefono, msgActivarAvisos(u.nombre, enlace)) : enlaceWhatsApp(msgActivarAvisos(u.nombre, enlace))}
              target="_blank" rel="noreferrer"
              className="flex min-h-9 items-center gap-1 rounded-full bg-emerald-50 px-3 text-sm font-semibold text-emerald-700">
              <Icono n="whatsapp" size={16} />Recordar
            </a>
          </li>
        ))}
      </ul>
      <a href={enlaceWhatsApp(msgActivarAvisos('', enlace).replace('¡Hola! 👋 ¿Qué tal?', '¡Hola, equipo! 👋'))} target="_blank" rel="noreferrer"
        className="flex items-center justify-center gap-2 border-t border-slate-100 py-3 text-sm font-semibold text-emerald-700">
        <Icono n="whatsapp" size={18} />Mandar los pasos al grupo
      </a>
    </section>
  )
}

// ---------------------------------------------------------------- salud de la app (se revisa sola cada hora)
const ESTADO_SALUD = {
  ok: { icono: 'ok', clase: 'text-emerald-600', texto: 'Bien' },
  aviso: { icono: 'alerta', clase: 'text-amber-600', texto: 'Revisar' },
  reparado: { icono: 'recargar', clase: 'text-marca-texto', texto: 'Reparado solo' },
}
function Salud() {
  const [s, setS] = useState(null)
  const [revisando, setRevisando] = useState(false)
  useEffect(() => { rpc('salud_admin').then(setS, () => setS(false)) }, [])
  const revisar = async () => {
    setRevisando(true)
    try { setS(await rpc('salud_admin', { p_revisar: true })) } catch { /* nada */ } finally { setRevisando(false) }
  }
  if (s === false) return null
  return (
    <section className="tarjeta space-y-2" aria-labelledby="t-salud">
      <div className="flex items-center justify-between gap-2">
        <h2 id="t-salud" className="flex items-center gap-2 font-bold text-slate-900">
          <Icono n="seguridad" size={20} className={s?.problemas ? 'text-amber-600' : 'text-emerald-600'} />Salud de la app
        </h2>
        <button className="btn-secundario flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={revisar} disabled={revisando}>
          <Icono n="recargar" size={14} className={revisando ? 'animate-spin' : ''} />{revisando ? 'Revisando…' : 'Revisar ahora'}
        </button>
      </div>
      {!s ? <Cargando filas={2} /> : (
        <>
          <p className="text-xs text-slate-600">
            {s.problemas ? `${s.problemas} ${s.problemas === 1 ? 'punto' : 'puntos'} por revisar` : 'Todo en orden'}
            {s.reparados ? ` · ${s.reparados} arreglados automáticamente` : ''} · revisado {haceCuanto(s.revisado)}. Se revisa sola cada hora y te avisa si aparece algo nuevo.
          </p>
          <ul className="divide-y divide-slate-100">
            {s.items.map((i) => {
              const e = ESTADO_SALUD[i.estado] || ESTADO_SALUD.ok
              return (
                <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
                  <Icono n={e.icono} size={18} className={e.clase} title={e.texto} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-slate-900">{i.titulo}</span>
                    <span className="block text-xs text-slate-500">{i.detalle}</span>
                  </span>
                  <span className={`text-xs font-semibold ${e.clase}`}>{e.texto}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
