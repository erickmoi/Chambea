// Administración en una sola pestaña: Panel · Usuarios · Cargar horario · Ajustes generales
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import Icono from '../../components/Icono'
import { Aviso, Cargando } from '../../components/ui'
import { Segmentado } from '../../components/turnos'
import { AjustesAdmin } from '../MiCuenta.jsx'
import { rpc, enlaceWhatsApp, nombreBonito } from '../../lib/datos'
import { hoy, sumarDias, fechaCorta, finMes, numDia, haceCuanto } from '../../lib/fechas'

const Usuarios = lazy(() => import('./Usuarios.jsx'))
const Importar = lazy(() => import('./Importar.jsx'))

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
        <Suspense fallback={<Cargando />}>
          {sec === 'panel' && <Panel irA={setSec} />}
          {sec === 'usuarios' && <Usuarios />}
          {sec === 'cargar' && <Importar />}
          {sec === 'ajustes' && <AjustesAdmin avisar={(texto, tipo = 'ok') => setAviso({ texto, tipo })} />}
        </Suspense>
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

  const cargar = useCallback(async () => {
    setError('')
    try {
      const [panel, sin] = await Promise.all([rpc('panel_admin'), rpc('personas_sin_cuenta')])
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
  const invitar = (nombre) => enlaceWhatsApp(
    `Hola ${nombreBonito(nombre).split(' ')[0]}, ya puedes registrarte en Chambea para pedir y ofrecer cambios de turno: ${enlace}\n` +
    'Entra, crea tu usuario y elige tu nombre del horario.')

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
        <a href={enlaceWhatsApp(`Ya pueden registrarse en Chambea para pedir y ofrecer cambios de turno: ${enlace}`)} target="_blank" rel="noreferrer"
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
