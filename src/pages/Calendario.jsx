// Mi horario: vista Agenda (semana en lista), Semana (columnas) y Mes (cuadrícula)
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icono from '../components/Icono'
import { Cargando, Hoja } from '../components/ui'
import { TarjetaTurno, Segmentado } from '../components/turnos'
import { HojaTurno, BuscarCambio, PublicarTurno } from '../components/AccionesTurno'
import { misTurnos, rpc, exportarIcs, exportarCsv } from '../lib/datos'
import {
  hoy, sumarDias, inicioSemana, inicioMes, finMes, sumarMeses, rangoDias,
  diaCorto, numDia, mesCorto, mesLargo, tituloMes, horario, horas, fechaCorta,
} from '../lib/fechas'

const VISTAS = [
  { id: 'agenda', texto: 'Agenda', icono: 'lista' },
  { id: 'semana', texto: 'Semana', icono: 'semana' },
  { id: 'mes', texto: 'Mes', icono: 'mes' },
]
const leer = (k, d) => { try { return localStorage.getItem(k) || d } catch { return d } }
const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }

export default function Calendario({ cuenta, avisar, onAbrirSolicitud }) {
  const [vista, setVista] = useState(() => leer('chambea.vista', 'agenda'))
  const [cursor, setCursor] = useState(hoy)
  const [filtro, setFiltro] = useState(() => leer('chambea.filtro', 'todo'))
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [publicados, setPublicados] = useState({})
  const [sel, setSel] = useState(null) // turno seleccionado
  const [accion, setAccion] = useState(null) // 'buscar' | 'publicar'
  const [diaMes, setDiaMes] = useState(hoy)
  const [exportar, setExportar] = useState(false)

  useEffect(() => guardar('chambea.vista', vista), [vista])
  useEffect(() => guardar('chambea.filtro', filtro), [filtro])

  // Rango a pedir: la cuadrícula del mes completo + la semana del cursor
  const semana = inicioSemana(cursor)
  const [desde, hasta] = useMemo(() => {
    const a = inicioSemana(inicioMes(cursor))
    const b = sumarDias(inicioSemana(finMes(cursor)), 6)
    return [a < semana ? a : semana, b > sumarDias(semana, 6) ? b : sumarDias(semana, 6)]
  }, [cursor, semana])

  const cargar = useCallback(async () => {
    setError('')
    try {
      const [r, mov] = await Promise.all([
        misTurnos(cuenta.persona_id, desde, hasta),
        rpc('mis_movimientos').catch(() => null),
      ])
      setDatos(r)
      if (mov) {
        const m = {}
        for (const s of mov.publicadas) if (s.turno && ['abierta', 'por_confirmar'].includes(s.estado)) m[s.turno.id] = s
        setPublicados(m)
      }
    } catch (e) {
      setError(e.message)
    }
  }, [cuenta.persona_id, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const turnos = useMemo(() => (datos?.turnos || []).filter((t) => filtro === 'todo' || t.seccion === filtro), [datos, filtro])
  const porDia = useMemo(() => {
    const m = {}
    for (const t of turnos) (m[t.fecha] ||= []).push(t)
    return m
  }, [turnos])

  const mover = (n) => setCursor((c) => (vista === 'mes' ? sumarMeses(c, n) : sumarDias(c, 7 * n)))
  const titulo = vista === 'mes'
    ? (cursor.slice(0, 4) === hoy().slice(0, 4) ? mesLargo(cursor) : tituloMes(cursor))
    : mesCorto(semana) === mesCorto(sumarDias(semana, 6))
      ? `${numDia(semana)}–${numDia(sumarDias(semana, 6))} ${mesCorto(semana)}`
      : `${numDia(semana)} ${mesCorto(semana)} – ${numDia(sumarDias(semana, 6))} ${mesCorto(sumarDias(semana, 6))}`

  // Resumen del mes del cursor
  const resumen = useMemo(() => {
    const deMes = (datos?.turnos || []).filter((t) => t.fecha >= inicioMes(cursor) && t.fecha <= finMes(cursor))
    const r = { planilla: 0, sp: 0, horas: 0 }
    for (const t of deMes) { r[t.seccion]++; r.horas += horas(t) }
    return r
  }, [datos, cursor])

  const abrir = (t) => { setSel(t); setAccion(null) }
  const cerrarTodo = () => { setSel(null); setAccion(null) }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Mi horario</h1>
        <button className="btn-secundario flex items-center gap-1.5 px-3 py-2 text-sm" onClick={() => setExportar(true)}>
          <Icono n="descargar" size={18} />Exportar
        </button>
      </div>

      <Segmentado opciones={VISTAS} valor={vista} onCambio={setVista} />

      <div className="flex items-center gap-2">
        <button className="btn-secundario px-2.5 py-2" onClick={() => mover(-1)} aria-label="Anterior"><Icono n="anterior" size={18} /></button>
        <button className="btn-secundario px-3 py-2 text-sm" onClick={() => { setCursor(hoy()); setDiaMes(hoy()) }}>Hoy</button>
        <button className="btn-secundario px-2.5 py-2" onClick={() => mover(1)} aria-label="Siguiente"><Icono n="siguiente" size={18} /></button>
        <span className="ml-1 flex-1 truncate font-semibold capitalize text-slate-800">{titulo}</span>
        <select className="rounded-xl border border-slate-300 bg-superficie px-2 py-2 text-sm" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar">
          <option value="todo">Todo</option><option value="planilla">Planilla</option><option value="sp">SP</option>
        </select>
      </div>

      {datos?.sinConexion && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <Icono n="sinRed" size={18} />Sin conexión: estás viendo lo último guardado.
        </p>
      )}
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}<button className="btn-secundario px-3 py-1.5 text-sm" onClick={cargar}>Reintentar</button>
        </div>
      )}
      {!datos && !error && <Cargando filas={4} />}

      {datos && (
        <div key={vista + desde} className="animar-entrada">
          {vista === 'agenda' && <Agenda semana={semana} porDia={porDia} publicados={publicados} onTurno={abrir} />}
          {vista === 'semana' && <Semana semana={semana} porDia={porDia} onTurno={abrir} />}
          {vista === 'mes' && <Mes cursor={cursor} porDia={porDia} dia={diaMes} onDia={setDiaMes} publicados={publicados} onTurno={abrir} />}
        </div>
      )}

      {datos && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Dato valor={resumen.planilla} texto="Planilla" color="text-planilla" />
          <Dato valor={resumen.sp} texto="SP" color="text-sp" />
          <Dato valor={resumen.horas} texto={`horas en ${mesCorto(cursor)}`} />
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-planilla" />Planilla</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sp" />SP</span>
        <span>🔁 cambio hecho en Chambea</span>
      </div>

      {sel && !accion && (
        <HojaTurno t={sel} publicado={publicados[sel.id]} onCerrar={cerrarTodo}
          onBuscar={() => setAccion('buscar')} onPublicar={() => setAccion('publicar')}
          onVerSolicitud={(id) => { cerrarTodo(); onAbrirSolicitud(id) }} />
      )}
      {sel && accion === 'buscar' && <BuscarCambio t={sel} avisar={avisar} onCerrar={cerrarTodo} onListo={() => { cerrarTodo(); cargar() }} />}
      {sel && accion === 'publicar' && <PublicarTurno t={sel} avisar={avisar} onCerrar={cerrarTodo} onListo={cargar} />}

      {exportar && (
        <Hoja titulo={`Exportar ${tituloMes(cursor)}`} icono="descargar" onCerrar={() => setExportar(false)}>
          <p className="mb-4 text-sm text-slate-600">Descarga tus turnos del mes para tenerlos en tu calendario o en Excel.</p>
          <div className="grid gap-2">
            <button className="btn-primario flex items-center justify-center gap-2 py-3" onClick={() => {
              exportarIcs((datos?.turnos || []).filter((t) => t.fecha >= inicioMes(cursor) && t.fecha <= finMes(cursor)), `chambea-${cursor.slice(0, 7)}`)
              setExportar(false)
            }}><Icono n="calendario" size={20} />Para Google Calendar o iPhone (.ics)</button>
            <button className="btn-secundario flex items-center justify-center gap-2 py-3" onClick={() => {
              exportarCsv((datos?.turnos || []).filter((t) => t.fecha >= inicioMes(cursor) && t.fecha <= finMes(cursor)), `chambea-${cursor.slice(0, 7)}`)
              setExportar(false)
            }}><Icono n="excel" size={20} />Para Excel (.csv)</button>
          </div>
        </Hoja>
      )}
    </div>
  )
}

function Dato({ valor, texto, color = 'text-slate-900' }) {
  return (
    <div className="rounded-2xl bg-superficie px-2 py-3 ring-1 ring-slate-200">
      <div className={`mono text-2xl font-semibold ${color}`}>{valor}</div>
      <div className="text-xs text-slate-500">{texto}</div>
    </div>
  )
}

function EtiquetaDia({ iso }) {
  const esHoy = iso === hoy()
  return (
    <div className="flex flex-col items-start pt-1 leading-tight">
      <span className="text-xs font-semibold capitalize text-slate-500">{diaCorto(iso)}</span>
      <span className={`mono text-xl font-semibold ${esHoy ? 'text-marca-texto' : 'text-slate-900'}`}>{numDia(iso)}</span>
      {esHoy && <span className="mt-0.5 rounded-full bg-marca px-1.5 py-0.5 text-[10px] font-bold text-sobre-marca">Hoy</span>}
    </div>
  )
}

// ---------------------------------------------------------------- Agenda
function Agenda({ semana, porDia, publicados, onTurno }) {
  return (
    <div className="space-y-3">
      {rangoDias(semana, sumarDias(semana, 6)).map((d) => (
        <div key={d} className="grid grid-cols-[2.75rem_1fr] gap-3">
          <EtiquetaDia iso={d} />
          <div className="space-y-2">
            {porDia[d]?.length
              ? porDia[d].map((t) => <TarjetaTurno key={t.id} t={t} publicado={!!publicados[t.id]} onClick={() => onTurno(t)} />)
              : <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-2.5 text-sm text-slate-400">Libre</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Semana
function Semana({ semana, porDia, onTurno }) {
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {rangoDias(semana, sumarDias(semana, 6)).map((d) => (
        <div key={d} className={`min-h-40 rounded-2xl p-1 sm:p-2 ${d === hoy() ? 'bg-marca-claro' : 'bg-superficie ring-1 ring-slate-200'}`}>
          <div className="mb-1 text-center">
            <div className="text-[11px] font-semibold capitalize text-slate-500">{diaCorto(d)}</div>
            <div className="mono text-base font-semibold text-slate-900">{numDia(d)}</div>
          </div>
          <div className="space-y-1">
            {(porDia[d] || []).map((t) => (
              <button key={t.id} onClick={() => onTurno(t)}
                className={`w-full rounded-lg px-0.5 py-1.5 text-center transition active:scale-95 ${t.seccion === 'sp' ? 'bg-sp-claro text-sp' : 'bg-planilla-claro text-planilla'}`}>
                <span className="mono block whitespace-pre-line text-[11px] font-semibold leading-tight sm:text-xs">{horario(t.etiqueta).replace('–', '\n')}</span>
                {t.es_cambio && <span className="text-[10px]">🔁</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Mes
function Mes({ cursor, porDia, dia, onDia, publicados, onTurno }) {
  const ini = inicioSemana(inicioMes(cursor))
  const fin = sumarDias(inicioSemana(finMes(cursor)), 6)
  const dias = rangoDias(ini, fin)
  const mes = cursor.slice(0, 7)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500">
        {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map((d) => {
          const lista = porDia[d] || []
          const fuera = d.slice(0, 7) !== mes
          return (
            <button key={d} onClick={() => onDia(d)}
              className={`flex aspect-[4/5] flex-col items-center rounded-xl p-1 transition active:scale-95 ${dia === d ? 'bg-marca text-sobre-marca' : d === hoy() ? 'bg-marca-claro' : 'bg-superficie ring-1 ring-slate-200'} ${fuera ? 'opacity-40' : ''}`}>
              <span className="mono text-sm font-semibold">{numDia(d)}</span>
              <span className="mt-auto flex flex-wrap justify-center gap-0.5 pb-0.5">
                {lista.slice(0, 3).map((t) => (
                  <span key={t.id} className={`h-1.5 w-3 rounded-full ${dia === d ? 'bg-sobre-marca' : t.seccion === 'sp' ? 'bg-sp' : 'bg-planilla'}`} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
      <div className="space-y-2">
        <p className="font-semibold capitalize text-slate-800">{fechaCorta(dia)}</p>
        {(porDia[dia] || []).length
          ? porDia[dia].map((t) => <TarjetaTurno key={t.id} t={t} publicado={!!publicados[t.id]} onClick={() => onTurno(t)} />)
          : <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-2.5 text-sm text-slate-400">Libre</div>}
      </div>
    </div>
  )
}
