// Mi horario: vista Agenda (semana en lista), Semana (columnas) y Mes (cuadrícula)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icono from '../components/Icono'
import { Cargando, Hoja } from '../components/ui'
import { TarjetaTurno, Segmentado, momento, letraSeccion } from '../components/turnos'
import DeTurno from '../components/DeTurno'
import { pausasVisibles, guardarPausasVisibles, detalleMes, guardarDetalleMes } from '../lib/tema'
import { HojaTurno, BuscarCambio, PublicarTurno, CorregirTurno, AgregarTurno } from '../components/AccionesTurno'
import { misTurnos, rpc, exportarIcs, exportarCsv, nombreBonito } from '../lib/datos'
import { esAdmin } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useDeslizar, claseDeslizar } from '../lib/deslizar'
import {
  hoy, sumarDias, inicioSemana, inicioMes, finMes, sumarMeses, rangoDias,
  diaCorto, numDia, mesCorto, mesLargo, tituloMes, horario, horas, fechaCorta, tipoTurno, hora, horaCorta,
} from '../lib/fechas'

const VISTAS = [
  { id: 'agenda', texto: 'Agenda', icono: 'lista' },
  { id: 'semana', texto: 'Semana', icono: 'semana' },
  { id: 'mes', texto: 'Mes', icono: 'mes' },
]
const leer = (k, d) => { try { return localStorage.getItem(k) || d } catch { return d } }
const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }

export default function Calendario({ cuenta, avisar, onAbrirSolicitud, verResumen = false }) {
  const [vista, setVista] = useState(() => leer('chambea.vista', 'agenda'))
  const [cursor, setCursor] = useState(hoy)
  const [filtro, setFiltro] = useState(() => leer('chambea.filtro', 'todo'))
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [publicados, setPublicados] = useState({})
  const [agregar, setAgregar] = useState(false)
  // Administración: ver el horario de otra persona (null = el mío)
  const [otra, setOtra] = useState(null)
  const [elegirPersona, setElegirPersona] = useState(false)
  const admin = esAdmin(cuenta)
  const personaId = otra?.id ?? cuenta.persona_id
  const [sel, setSel] = useState(null) // turno seleccionado
  const [accion, setAccion] = useState(null) // 'buscar' | 'publicar'
  const [diaMes, setDiaMes] = useState(hoy)
  const [exportar, setExportar] = useState(false)
  const [deTurno, setDeTurno] = useState(null)
  const [pausas, setPausas] = useState(pausasVisibles)
  const [detalle, setDetalle] = useState(detalleMes)
  const refResumen = useRef(null)

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
        misTurnos(personaId, desde, hasta, { cache: !otra }),
        otra ? null : rpc('mis_movimientos').catch(() => null),
      ])
      if (otra) setPublicados({})
      setDatos(r)
      if (mov) {
        const m = {}
        for (const s of mov.publicadas) if (s.turno && ['abierta', 'por_confirmar'].includes(s.estado)) m[s.turno.id] = s
        setPublicados(m)
      }
    } catch (e) {
      setError(e.message)
    }
  }, [personaId, otra, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const turnos = useMemo(() => (datos?.turnos || []).filter((t) => filtro === 'todo' || t.seccion === filtro), [datos, filtro])
  const porDia = useMemo(() => {
    const m = {}
    for (const t of turnos) (m[t.fecha] ||= []).push(t)
    return m
  }, [turnos])

  const [dir, setDir] = useState(0)
  const mover = (n) => { setDir(n); setCursor((c) => (vista === 'mes' ? sumarMeses(c, n) : sumarDias(c, 7 * n))) }
  const refDeslizar = useDeslizar({ onSiguiente: () => mover(1), onAnterior: () => mover(-1) })
  const titulo = vista === 'mes'
    ? (cursor.slice(0, 4) === hoy().slice(0, 4) ? mesLargo(cursor) : tituloMes(cursor))
    : mesCorto(semana) === mesCorto(sumarDias(semana, 6))
      ? `${numDia(semana)}–${numDia(sumarDias(semana, 6))} ${mesCorto(semana)}`
      : `${numDia(semana)} ${mesCorto(semana)} – ${numDia(sumarDias(semana, 6))} ${mesCorto(sumarDias(semana, 6))}`

  // Resumen del mes del cursor
  const resumen = useMemo(() => {
    const deMes = (datos?.turnos || []).filter((t) => t.fecha >= inicioMes(cursor) && t.fecha <= finMes(cursor))
    const r = { planilla: { n: 0, h: 0 }, sp: { n: 0, h: 0 }, dia: 0, noche: 0, tarde: 0, manana: 0, cambios: 0, dias: new Set() }
    for (const t of deMes) {
      r[t.seccion].n++
      r[t.seccion].h += horas(t)
      r[tipoTurno(t)]++
      if (t.es_cambio) r.cambios++
      r.dias.add(t.fecha)
    }
    const total = rangoDias(inicioMes(cursor), finMes(cursor)).length
    return { ...r, libres: total - r.dias.size, horas: r.planilla.h + r.sp.h }
  }, [datos, cursor])

  useEffect(() => {
    if (verResumen && datos) refResumen.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [verResumen, datos])

  const abrir = (t) => { setSel(t); setAccion(null) }
  const cerrarTodo = () => { setSel(null); setAccion(null) }

  return (
    <div ref={refDeslizar} className="mx-auto max-w-4xl space-y-3 p-4">
      {/* Barra compacta: título, navegación y filtros en dos líneas */}
      <div className="flex items-center gap-1">
        <h1 className="mr-auto whitespace-nowrap text-lg font-bold tracking-tight text-slate-900">{otra ? 'Horario' : 'Mi horario'}</h1>
        {admin && (
          <button className="boton-icono h-9 min-h-9 w-9 min-w-9 text-slate-700" onClick={() => setElegirPersona(true)} aria-label="Ver el horario de otra persona" title="Ver el horario de otra persona">
            <Icono n="usuarios" size={18} />
          </button>
        )}
        <button className="boton-icono h-9 min-h-9 w-9 min-w-9 text-slate-700" onClick={() => mover(-1)} aria-label={vista === 'mes' ? 'Mes anterior' : 'Semana anterior'}><Icono n="anterior" size={18} /></button>
        <h2 className="min-w-0 truncate text-center text-sm font-semibold capitalize text-slate-900" aria-live="polite">{titulo}</h2>
        <button className="boton-icono h-9 min-h-9 w-9 min-w-9 text-slate-700" onClick={() => mover(1)} aria-label={vista === 'mes' ? 'Mes siguiente' : 'Semana siguiente'}><Icono n="siguiente" size={18} /></button>
        <button className="rounded-lg px-2 py-1.5 text-xs font-bold text-marca-texto ring-1 ring-slate-200" onClick={() => { setCursor(hoy()); setDiaMes(hoy()) }}>Hoy</button>
        <button className="boton-icono h-9 min-h-9 w-9 min-w-9 text-slate-700" onClick={() => setExportar(true)} aria-label="Exportar"><Icono n="descargar" size={18} /></button>
      </div>

      {otra && (
        <div className="animar-entrada flex items-center gap-2 rounded-xl bg-marca-claro px-3 py-2 text-sm text-marca-texto">
          <Icono n="usuarios" size={18} />
          <span className="min-w-0 flex-1 truncate">Viendo a <b>{nombreBonito(otra.nombre)}</b></span>
          <button className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold ring-1 ring-current" onClick={() => setOtra(null)}>Volver al mío</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Segmentado compacto etiqueta="Vista" valor={vista} onCambio={(v) => { setDir(0); setVista(v) }}
          opciones={VISTAS.map((v) => ({ id: v.id, icono: v.icono, etiqueta: v.texto, texto: <span className="hidden sm:inline">{v.texto}</span> }))}
          className="grid-flow-col" />
        <Segmentado compacto etiqueta="Mostrar" valor={filtro} onCambio={setFiltro} opciones={[
          { id: 'todo', texto: 'Todo' }, { id: 'planilla', texto: 'P', etiqueta: 'Planilla' }, { id: 'sp', texto: 'SP', etiqueta: 'Servicios Profesionales' },
        ]} />
        {vista === 'mes' && (
          <Segmentado compacto etiqueta="Detalle del mes" valor={detalle} className="ml-auto"
            onCambio={(v) => { setDetalle(v); guardarDetalleMes(v) }}
            opciones={[{ id: 'letra', texto: 'P/SP' }, { id: 'hora', texto: '+ hora', etiqueta: 'Mostrar también la hora' }]} />
        )}
        {vista === 'agenda' && (
          <button onClick={() => { setPausas(!pausas); guardarPausasVisibles(!pausas) }} aria-pressed={pausas}
            className={`ml-auto flex min-h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition ${pausas ? 'bg-marca-claro text-marca-texto' : 'bg-slate-100 text-slate-600'}`}>
            <Icono n={pausas ? 'ocultar' : 'ver'} size={15} />Pausas<span className="sr-only">{pausas ? ': visibles, tocar para ocultar' : ': ocultas, tocar para ver'}</span>
          </button>
        )}
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
        <div key={vista + desde} className={claseDeslizar(dir)}>
          {vista === 'agenda' && <Agenda semana={semana} porDia={porDia} publicados={publicados} onTurno={abrir} onDeTurno={setDeTurno} pausas={pausas} />}
          {vista === 'semana' && <Semana semana={semana} porDia={porDia} onTurno={abrir} />}
          {vista === 'mes' && <Mes cursor={cursor} porDia={porDia} dia={diaMes} onDia={setDiaMes} publicados={publicados} onTurno={abrir} onDeTurno={setDeTurno} conHora={detalle === 'hora'} />}
        </div>
      )}

      {datos && <Resumen r={resumen} mes={mesLargo(cursor)} refCaja={refResumen} />}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Leyenda">
        <span className="flex items-center gap-1"><b className="text-planilla">P:</b> Planilla</span>
        <span className="flex items-center gap-1"><b className="text-sp">SP:</b> Servicios Profesionales</span>
        <span className="flex items-center gap-1"><Icono n="sol" size={14} />Día</span>
        <span className="flex items-center gap-1"><Icono n="luna" size={14} />Noche</span>
        <span className="flex items-center gap-1"><span className="turno-corto inline-flex items-center rounded px-1 text-sp"><Icono n="tarde" size={14} /></span>Tarde (turno corto)</span>
        <span className="flex items-center gap-1"><span className="turno-corto inline-flex items-center rounded px-1 text-planilla"><Icono n="manana" size={14} /></span>Mañana (turno corto)</span>
        <span className="flex items-center gap-1"><Icono n="repetir" size={14} className="text-marca-texto" />Cambio hecho en Chambea</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />Permuta en la hoja</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" />Permiso personal</span>
      </div>

      {cuenta.agrega_turnos && (
        <button onClick={() => setAgregar(true)}
          className="btn-primario fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-2 rounded-full px-5 py-3.5 shadow-lg md:bottom-6">
          <Icono n="mas" size={20} />Agregar turno
        </button>
      )}
      {agregar && <AgregarTurno fecha={vista === 'mes' ? diaMes : cursor} persona={otra} avisar={avisar} onCerrar={() => setAgregar(false)} onListo={cargar} />}
      {elegirPersona && <ElegirPersona actual={otra?.id} onCerrar={() => setElegirPersona(false)}
        onElegir={(p) => { setElegirPersona(false); setDatos(null); setOtra(p && p.id !== cuenta.persona_id ? p : null) }} />}

      {sel && !accion && (
        <HojaTurno t={sel} publicado={publicados[sel.id]} onCerrar={cerrarTodo}
          onBuscar={cuenta.en_permutas === false || otra ? undefined : () => setAccion('buscar')} onPublicar={() => setAccion('publicar')}
          textoCorregir={cuenta.agrega_turnos && sel.manual ? 'Editar o quitar este turno' : undefined}
          onVerSolicitud={(id) => { cerrarTodo(); onAbrirSolicitud(id) }}
          onDeTurno={() => { const f = sel.fecha; cerrarTodo(); setDeTurno(f) }}
          onCorregir={cuenta.puede_corregir ? () => setAccion('corregir') : undefined} />
      )}
      {deTurno && <DeTurno fecha={deTurno} miPersona={cuenta.persona_id} onCerrar={() => setDeTurno(null)} />}
      {sel && accion === 'buscar' && <BuscarCambio t={sel} avisar={avisar} onCerrar={cerrarTodo} onListo={() => { cerrarTodo(); cargar() }} />}
      {sel && accion === 'publicar' && <PublicarTurno t={sel} avisar={avisar} onCerrar={cerrarTodo} onListo={cargar} />}
      {sel && accion === 'corregir' && <CorregirTurno t={sel} puedeQuitar={!!sel.manual || ['admin', 'superadmin'].includes(cuenta.rol)} avisar={avisar} onCerrar={cerrarTodo} onListo={() => { cerrarTodo(); cargar() }} />}

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

// ---------------------------------------------------------------- resumen del mes
function Resumen({ r, mes, refCaja }) {
  const datos = [
    { valor: r.planilla.n, texto: 'Planilla', sub: `${r.planilla.h} h`, color: 'text-planilla', icono: 'calendario' },
    { valor: r.sp.n, texto: 'Serv. Profesionales', sub: `${r.sp.h} h`, color: 'text-sp', icono: 'calendario' },
    { valor: r.horas, texto: 'Horas', sub: 'en total', icono: 'reloj' },
    { valor: r.dia, texto: 'Días', sub: '12 h', icono: 'sol' },
    { valor: r.noche, texto: 'Noches', sub: '12 h', icono: 'luna' },
    { valor: r.tarde + r.manana, texto: 'Cortos', sub: r.manana ? `${r.tarde} tarde · ${r.manana} mañana` : 'de tarde', icono: 'tarde' },
    { valor: r.libres, texto: 'Días libres', icono: 'cama' },
    { valor: r.cambios, texto: 'Cambios', sub: 'en Chambea', icono: 'repetir' },
  ]
  return (
    <section ref={refCaja} aria-labelledby="titulo-resumen" className="tarjeta scroll-mt-24">
      <h2 id="titulo-resumen" className="mb-3 flex items-center gap-2 font-bold text-slate-900"><Icono n="grafica" size={20} className="text-marca-texto" />Resumen de {mes}</h2>
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {datos.map((d) => (
          <div key={d.texto} className="rounded-xl bg-slate-50 px-2 py-2.5 text-center ring-1 ring-slate-100">
            <dt className="flex items-center justify-center gap-1 text-xs font-medium text-slate-600"><Icono n={d.icono} size={14} />{d.texto}</dt>
            <dd className={`mono text-2xl font-semibold ${d.color || 'text-slate-900'}`}>{d.valor}</dd>
            {d.sub && <dd className="text-[11px] text-slate-500">{d.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  )
}

function EtiquetaDia({ iso, onClick }) {
  const esHoy = iso === hoy()
  return (
    <button onClick={onClick} aria-label={`${fechaCorta(iso)}: ver quién está de turno`}
      className={`flex w-full flex-col items-center rounded-xl py-1 leading-tight transition hover:bg-slate-100 ${esHoy ? 'bg-marca text-sobre-marca hover:bg-marca' : ''}`}>
      <span className={`text-xs font-semibold capitalize ${esHoy ? '' : 'text-slate-600'}`}>{diaCorto(iso)}</span>
      <span className={`mono text-xl font-semibold ${esHoy ? '' : 'text-slate-900'}`}>{numDia(iso)}</span>
    </button>
  )
}

// ---------------------------------------------------------------- Agenda (los días libres ocupan una línea fina)
function Agenda({ semana, porDia, publicados, onTurno, onDeTurno, pausas }) {
  return (
    <div className="space-y-1.5">
      {rangoDias(semana, sumarDias(semana, 6)).map((d) => (
        porDia[d]?.length ? (
          <div key={d} className="grid grid-cols-[3rem_1fr] gap-2 py-1">
            <EtiquetaDia iso={d} onClick={() => onDeTurno(d)} />
            <div className="space-y-2">
              {porDia[d].map((t) => <TarjetaTurno key={t.id} t={t} conPausas={pausas} publicado={!!publicados[t.id]} onClick={() => onTurno(t)} />)}
            </div>
          </div>
        ) : (
          <button key={d} onClick={() => onDeTurno(d)}
            className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${d === hoy() ? 'bg-marca-claro' : ''}`}>
            <span className="w-12 shrink-0 text-center"><span className="capitalize text-slate-600">{diaCorto(d)}</span> <b className="mono text-slate-900">{numDia(d)}</b></span>
            <span className="h-px flex-1 bg-slate-200" />
            <span className="flex items-center gap-1 text-slate-500"><Icono n="cama" size={15} />Libre</span>
          </button>
        )
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Semana
function Semana({ semana, porDia, onTurno }) {
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {rangoDias(semana, sumarDias(semana, 6)).map((d) => (
        <div key={d} className={`min-h-44 rounded-2xl p-1 sm:p-2 ${d === hoy() ? 'bg-marca-claro ring-2 ring-marca' : 'bg-superficie ring-1 ring-slate-200'}`}>
          <div className="mb-1 text-center">
            <div className="text-[11px] font-semibold capitalize text-slate-600">{diaCorto(d)}</div>
            <div className="mono text-base font-semibold text-slate-900">{numDia(d)}</div>
          </div>
          <div className="space-y-1">
            {(porDia[d] || []).map((t) => {
              const m = momento(t)
              const [a, b] = t.etiqueta.split(/[–-]/).map((x) => hora(x.trim()))
              return (
                <button key={t.id} onClick={() => onTurno(t)} aria-label={`${fechaCorta(d)}, ${horario(t.etiqueta)}, ${t.seccion === 'sp' ? 'SP' : 'Planilla'}`}
                  className={`flex w-full flex-col items-center rounded-lg px-0.5 py-1.5 transition active:scale-95 ${t.seccion === 'sp' ? 'bg-sp-claro text-sp' : 'bg-planilla-claro text-planilla'} ${m.corto ? 'turno-corto' : ''}`}>
                  <span className="flex items-center gap-0.5 text-[11px] font-bold"><Icono n={m.icono} size={13} />{letraSeccion(t.seccion)}</span>
                  <span className="mono block text-[10px] font-semibold leading-tight sm:text-xs">{a}</span>
                  <span className="mono block text-[10px] leading-tight opacity-80 sm:text-xs">{b}</span>
                  {t.es_cambio && <Icono n="repetir" size={12} className="mt-0.5" />}
                  {t.observacion && <span className="mt-0.5 text-[9px] font-bold uppercase leading-none">{t.observacion.split(' ')[0]}</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Mes (cada turno: ícono día/noche + P/S)
function Mes({ cursor, porDia, dia, onDia, publicados, onTurno, onDeTurno, conHora }) {
  const ini = inicioSemana(inicioMes(cursor))
  const fin = sumarDias(inicioSemana(finMes(cursor)), 6)
  const dias = rangoDias(ini, fin)
  const mes = cursor.slice(0, 7)
  return (
    <div className="grid gap-4 md:grid-cols-[1.4fr_1fr] md:items-start">
      <div>
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-600" aria-hidden="true">
          {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {dias.map((d) => {
            const lista = porDia[d] || []
            const fuera = d.slice(0, 7) !== mes
            const elegido = dia === d
            return (
              <button key={d} onClick={() => onDia(d)} aria-pressed={elegido}
                aria-label={`${fechaCorta(d)}: ${lista.length ? lista.map((t) => `${t.seccion === 'sp' ? 'Servicios Profesionales' : 'Planilla'} ${horario(t.etiqueta)}`).join(', ') : 'libre'}`}
                className={`flex min-h-16 flex-col items-center gap-0.5 rounded-xl p-1 transition active:scale-95 ${elegido ? 'bg-marca text-sobre-marca shadow' : d === hoy() ? 'bg-marca-claro ring-2 ring-marca' : 'bg-superficie ring-1 ring-slate-200'} ${fuera ? 'opacity-40' : ''}`}>
                <span className="mono text-sm font-semibold">{numDia(d)}</span>
                {lista.slice(0, 2).map((t) => {
                  const m = momento(t)
                  return (
                    <span key={t.id} className={`flex w-full flex-col items-center rounded-md py-px text-[10px] font-bold leading-tight ${elegido ? 'bg-white/20' : t.seccion === 'sp' ? 'bg-sp-claro text-sp' : 'bg-planilla-claro text-planilla'} ${m.corto ? 'turno-corto' : ''}`}>
                      <span className="flex items-center gap-0.5"><Icono n={m.icono} size={11} />{letraSeccion(t.seccion)}</span>
                      {conHora && <span className="mono text-[9px] font-semibold tracking-tighter">{horaCorta(t.etiqueta)}</span>}
                      {t.observacion && <span className={`mt-px h-1.5 w-1.5 rounded-full ${/permiso|incapacidad/i.test(t.observacion) ? 'bg-violet-500' : 'bg-amber-500'}`} title={t.observacion} />}
                    </span>
                  )
                })}
                {lista.length > 2 && <span className="text-[10px] font-bold">+{lista.length - 2}</span>}
              </button>
            )
          })}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold capitalize text-slate-900">{fechaCorta(dia)}</p>
          <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-marca-texto hover:bg-slate-100" onClick={() => onDeTurno(dia)}>
            <Icono n="equipo" size={16} />Quién está
          </button>
        </div>
        {(porDia[dia] || []).length
          ? porDia[dia].map((t) => <TarjetaTurno key={t.id} t={t} conPausas publicado={!!publicados[t.id]} onClick={() => onTurno(t)} />)
          : <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600"><Icono n="cama" size={16} />Libre</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- administración: elegir de quién ver el horario
function ElegirPersona({ actual, onCerrar, onElegir }) {
  const [lista, setLista] = useState(null)
  const [filtro, setFiltro] = useState('')
  useEffect(() => {
    supabase.from('personas').select('id, nombre, es_supervisor, referencias_planilla, gerencia').eq('activo', true).order('nombre')
      .then(({ data }) => setLista(data || []))
  }, [])
  const q = filtro.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const visibles = (lista || []).filter((p) => p.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q))
  const grupo = (p) => (p.gerencia ? 'Gerencia' : p.es_supervisor ? 'Supervisor' : p.referencias_planilla ? 'Referencias' : null)
  return (
    <Hoja titulo="Ver horario de…" icono="usuarios" onCerrar={onCerrar}>
      <input className="input mb-3" placeholder="Buscar nombre" value={filtro} onChange={(e) => setFiltro(e.target.value)} autoFocus />
      {!lista ? <Cargando filas={4} /> : (
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          <li><button className="flex w-full items-center gap-2 py-2.5 text-left text-sm font-semibold text-marca-texto" onClick={() => onElegir(null)}>
            <Icono n="inicio" size={18} />Mi horario</button></li>
          {visibles.map((p) => (
            <li key={p.id}>
              <button onClick={() => onElegir(p)} className={`flex w-full items-center gap-2 py-2.5 text-left text-sm ${p.id === actual ? 'font-bold text-marca-texto' : 'text-slate-900'}`}>
                <span className="min-w-0 flex-1 truncate">{nombreBonito(p.nombre)}</span>
                {grupo(p) && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{grupo(p)}</span>}
              </button>
            </li>
          ))}
          {visibles.length === 0 && <li className="py-6 text-center text-sm text-slate-500">Nadie con ese nombre.</li>}
        </ul>
      )}
    </Hoja>
  )
}
