// Inicio ("Hoy"): turno actual o próximo con cuenta regresiva y pausas, lo que te toca responder,
// accesos rápidos y un vistazo discreto a mañana.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icono from '../components/Icono'
import { Cargando } from '../components/ui'
import { ChipSeccion, ChipFuncion, Pausas, momento, TarjetaTurno } from '../components/turnos'
import { HojaTurno, BuscarCambio, PublicarTurno, CorregirTurno } from '../components/AccionesTurno'
import DeTurno from '../components/DeTurno'
import ActivarAvisos, { useEstadoAvisos } from '../components/ActivarAvisos'
import { Hoja } from '../components/ui'
import { misTurnos, rpc, textoTurno, TIPO, nombreBonito } from '../lib/datos'
import { supabase } from '../lib/supabase'
import { hoy, sumarDias, fechaCorta, diaLargo, numDia, mesLargo, horario, faltan, hora, pausa, nombreComida } from '../lib/fechas'

const saludo = () => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/El_Salvador', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches'
}

export default function Inicio({ cuenta, avisar, onAbrirSolicitud, onIr, recarga }) {
  const [turnos, setTurnos] = useState(null)
  const [sinConexion, setSinConexion] = useState(false)
  const [pend, setPend] = useState(null)
  const [error, setError] = useState('')
  const [ahora, setAhora] = useState(() => Date.now())
  const [sel, setSel] = useState(null)
  const [accion, setAccion] = useState(null)
  const [publicados, setPublicados] = useState({})
  const [deTurno, setDeTurno] = useState(null) // fecha
  const [anuncio, setAnuncio] = useState(null)
  const [estadoAvisos] = useEstadoAvisos()
  const [verAvisos, setVerAvisos] = useState(false)
  const [avisosCerrado, setAvisosCerrado] = useState(() => {
    try { return Number(localStorage.getItem('chambea.avisos.cerrado') || 0) > Date.now() } catch { return false }
  })
  const cerrarAvisos = () => {
    try { localStorage.setItem('chambea.avisos.cerrado', String(Date.now() + 3 * 864e5)) } catch { /* nada */ }
    setAvisosCerrado(true)
  }

  const cargar = useCallback(async () => {
    setError('')
    try {
      const [r, p, mov, aj] = await Promise.all([
        misTurnos(cuenta.persona_id, sumarDias(hoy(), -1), sumarDias(hoy(), 30)),
        rpc('pendientes').catch(() => []),
        rpc('mis_movimientos').catch(() => null),
        supabase.from('ajustes').select('anuncio, anuncio_hasta').eq('id', 1).single().then((x) => x.data, () => null),
      ])
      setAnuncio(aj?.anuncio && (!aj.anuncio_hasta || aj.anuncio_hasta >= hoy()) ? aj.anuncio : null)
      setTurnos(r.turnos)
      setSinConexion(r.sinConexion)
      setPend(p)
      if (mov) {
        const m = {}
        for (const s of mov.publicadas) if (s.turno && ['abierta', 'por_confirmar'].includes(s.estado)) m[s.turno.id] = s
        setPublicados(m)
      }
    } catch (e) {
      setError(e.message)
    }
  }, [cuenta.persona_id])
  useEffect(() => { cargar() }, [cargar, recarga])

  // La cuenta regresiva se actualiza cada 30 s
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const { actual, proximo, deHoy, manana } = useMemo(() => {
    const lista = turnos || []
    const actual = lista.find((t) => new Date(t.inicio) <= ahora && new Date(t.fin) > ahora)
    const proximo = lista.find((t) => new Date(t.inicio) > ahora)
    const d = hoy()
    return {
      actual,
      proximo,
      deHoy: lista.filter((t) => t.fecha === d && t !== actual && t !== proximo),
      manana: lista.filter((t) => t.fecha === sumarDias(d, 1)),
    }
  }, [turnos, ahora])

  const principal = actual || proximo
  const abrir = (t) => { setSel(t); setAccion(null) }
  const cerrarTodo = () => { setSel(null); setAccion(null) }
  const nombre = nombreBonito(cuenta.persona || cuenta.nombre).split(' ')[0]

  return (
    <div className="mx-auto max-w-5xl p-4">
      <header className="mb-4">
        <p className="text-sm font-medium text-slate-600 first-letter:uppercase">{diaLargo(hoy())} {numDia(hoy())} de {mesLargo(hoy())}</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{saludo()}, {nombre}</h1>
      </header>

      {anuncio && (
        <p role="note" className="mb-4 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          <Icono n="campanaSuena" size={20} className="mt-px shrink-0" /><span><b>Aviso de la administración:</b> {anuncio}</span>
        </p>
      )}
      {['inactivo', 'bloqueado'].includes(estadoAvisos) && !avisosCerrado && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-marca-claro p-3 ring-1 ring-marca/30">
          <Icono n="notificaciones" size={26} className="shrink-0 text-marca-texto" />
          <p className="min-w-0 flex-1 text-sm text-slate-800"><b>Activa los avisos</b> para el recordatorio de GeoVictoria y tus horas de comida y descanso.</p>
          <button className="btn-primario shrink-0 px-3 py-2 text-sm" onClick={() => setVerAvisos(true)}>Activar</button>
          <button className="boton-icono h-8 min-h-8 w-8 min-w-8 text-slate-500" aria-label="Recordármelo después" onClick={cerrarAvisos}><Icono n="cerrar" size={16} /></button>
        </div>
      )}
      {verAvisos && (
        <Hoja titulo="Activa los avisos" icono="notificaciones" onCerrar={() => setVerAvisos(false)}>
          <ActivarAvisos avisar={avisar} onListo={() => setVerAvisos(false)} />
        </Hoja>
      )}
      {sinConexion && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <Icono n="sinRed" size={18} />Sin conexión: estás viendo lo último guardado.
        </p>
      )}
      {error && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}<button className="btn-secundario px-3 py-1.5 text-sm" onClick={cargar}>Reintentar</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.15fr_1fr] md:items-start">
        {/* ------------------------------------------------ columna 1: turno */}
        <div className="min-w-0 space-y-3">
          {!turnos && !error && <div className="esqueleto h-56" />}
          {turnos && (principal
            ? <TurnoPrincipal t={principal} enCurso={!!actual} ahora={ahora} cuenta={cuenta} onClick={() => abrir(principal)} />
            : (
              <div className="tarjeta py-8 text-center">
                <Icono n="cama" size={44} className="mx-auto text-marca-texto" />
                <p className="mt-2 font-semibold text-slate-900">No tienes turnos próximos</p>
                <p className="mt-1 text-sm text-slate-600">Cuando se cargue el horario aparecerán aquí.</p>
              </div>
            ))}

          {actual && proximo && proximo.fecha !== sumarDias(hoy(), 1) && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">Tu próximo turno</p>
              <TarjetaTurno t={proximo} conFecha conPausas publicado={!!publicados[proximo.id]} onClick={() => abrir(proximo)} />
            </div>
          )}

          {deHoy.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">También hoy</p>
              {deHoy.map((t) => <TarjetaTurno key={t.id} t={t} conPausas publicado={!!publicados[t.id]} onClick={() => abrir(t)} />)}
            </div>
          )}

          {turnos && <Manana turnos={manana} onClick={abrir} />}
        </div>

        {/* ------------------------------------------------ columna 2: pendientes y accesos */}
        <div className="min-w-0 space-y-4">
          <Pendientes lista={pend} onAbrir={onAbrirSolicitud} />

          <nav aria-label="Accesos rápidos" className="grid grid-cols-2 gap-2">
            <Acceso icono="equipo" texto="¿Quién está hoy?" onClick={() => setDeTurno(hoy())} />
            <Acceso icono="cambio" texto="Permutas" onClick={() => onIr('bolsa')} />
            <Acceso icono="calendario" texto="Mi horario" onClick={() => onIr('horario')} />
            <Acceso icono="grafica" texto="Resumen del mes" onClick={() => onIr('horario', { resumen: true })} />
          </nav>
        </div>
      </div>

      {sel && !accion && (
        <HojaTurno t={sel} publicado={publicados[sel.id]} onCerrar={cerrarTodo}
          onBuscar={() => setAccion('buscar')} onPublicar={() => setAccion('publicar')}
          onVerSolicitud={(id) => { cerrarTodo(); onAbrirSolicitud(id) }}
          onDeTurno={() => { const f = sel.fecha; cerrarTodo(); setDeTurno(f) }}
          onCorregir={cuenta.puede_corregir ? () => setAccion('corregir') : undefined} />
      )}
      {sel && accion === 'buscar' && <BuscarCambio t={sel} avisar={avisar} onCerrar={cerrarTodo} onListo={() => { cerrarTodo(); cargar() }} />}
      {sel && accion === 'publicar' && <PublicarTurno t={sel} avisar={avisar} onCerrar={cerrarTodo} onListo={cargar} />}
      {sel && accion === 'corregir' && <CorregirTurno t={sel} avisar={avisar} onCerrar={cerrarTodo} onListo={() => { cerrarTodo(); cargar() }} />}
      {deTurno && <DeTurno fecha={deTurno} miPersona={cuenta.persona_id} onCerrar={() => setDeTurno(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------- turno grande
function TurnoPrincipal({ t, enCurso, ahora, cuenta, onClick }) {
  const m = momento(t)
  const ini = new Date(t.inicio).getTime()
  const fin = new Date(t.fin).getTime()
  const avance = enCurso ? Math.min(100, Math.max(0, ((ahora - ini) / (fin - ini)) * 100)) : 0
  const sp = t.seccion === 'sp'
  const geo = t.seccion === 'planilla' && !enCurso && ini - ahora < 24 * 36e5
  const cuando = t.fecha === hoy() ? 'Hoy' : t.fecha === sumarDias(hoy(), 1) ? 'Mañana' : fechaCorta(t.fecha)

  return (
    <section aria-label={enCurso ? 'Turno en curso' : 'Próximo turno'} className="boleto overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold ${sp ? 'bg-sp-claro text-sp' : 'bg-planilla-claro text-planilla'}`}>
        <Icono n={enCurso ? 'reloj' : 'cuentaAtras'} size={18} />
        {enCurso ? <>En turno · termina en {faltan(fin - ahora)}</> : <>Tu próximo turno · en {faltan(ini - ahora)}</>}
      </div>

      <button onClick={onClick} className="block w-full p-4 text-left">
        <span className="flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold capitalize text-slate-600">{cuando}</span>
            <span className="mono block text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">{horario(t.etiqueta)}</span>
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              <ChipSeccion seccion={t.seccion} />
              <ChipFuncion funcion={t.funcion} />
              <span className="flex items-center gap-1 text-xs text-slate-600"><Icono n={m.icono} size={15} />{m.texto}</span>
              {t.es_cambio && <span className="flex items-center gap-1 text-xs font-semibold text-marca-texto"><Icono n="repetir" size={15} />Cambio</span>}
            </span>
          </span>
          <Icono n={m.icono} size={44} className={`${sp ? 'text-sp' : 'text-planilla'} opacity-80`} />
        </span>

        {enCurso && (
          <span className="mt-4 block h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(avance)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del turno">
            <span className={`block h-full rounded-full transition-all duration-700 ${sp ? 'bg-sp' : 'bg-planilla'}`} style={{ width: `${avance}%` }} />
          </span>
        )}

        {(t.comida || t.descanso) ? (
          <span className="mt-4 grid grid-cols-2 gap-2">
            <PausaGrande icono="comida" texto={nombreComida(t)} valor={t.comida} />
            <PausaGrande icono="cafe" texto="Descanso" valor={t.descanso} />
          </span>
        ) : (
          <span className="mt-3 block text-xs text-slate-500">Sin horario de comida o descanso en la hoja.</span>
        )}
      </button>

      {geo && cuenta.recordar_marcaje !== false && (
        <p className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
          <Icono n="huella" size={18} className="text-marca-texto" />
          Marca en GeoVictoria · te avisamos a las <b className="mono">{hora(new Date(ini - 15 * 60000).toLocaleTimeString('en-GB', { timeZone: 'America/El_Salvador', hour: '2-digit', minute: '2-digit' }))}</b>
        </p>
      )}

      {/* Solo se puede cambiar con anticipación: si ya está en curso no se ofrece */}
      {!enCurso && (
        <button onClick={onClick} className="flex w-full items-center justify-center gap-1.5 border-t border-slate-200 py-3 text-sm font-semibold text-marca-texto hover:bg-slate-50">
          <Icono n="cambio" size={18} />Cambiar este turno
        </button>
      )}
    </section>
  )
}

function PausaGrande({ icono, texto, valor }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 ${valor ? 'bg-slate-100' : 'bg-slate-50 opacity-70'}`}>
      <Icono n={icono} size={22} className="text-marca-texto" />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-600">{texto}</span>
        <span className="mono block text-sm font-semibold text-slate-900">{valor ? pausa(valor) : '—'}</span>
      </span>
    </span>
  )
}
const pausaLarga = (v) => v.split(/[–-]/).map((x) => hora(x.trim())).join(' – ')

// ---------------------------------------------------------------- mañana (discreto)
function Manana({ turnos, onClick }) {
  const d = sumarDias(hoy(), 1)
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Mañana · <span className="normal-case">{fechaCorta(d)}</span></p>
      {turnos.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-slate-600"><Icono n="cama" size={18} />Descanso, no tienes turno.</p>
      ) : (
        <ul className="space-y-1">
          {turnos.map((t) => {
            const m = momento(t)
            return (
              <li key={t.id}>
                <button onClick={() => onClick(t)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-left text-sm text-slate-700">
                  <Icono n={m.icono} size={16} className={t.seccion === 'sp' ? 'text-sp' : 'text-planilla'} />
                  <span className="mono font-semibold">{horario(t.etiqueta)}</span>
                  <span className="text-slate-500">· {t.seccion === 'sp' ? 'Servicios Profesionales' : 'Planilla'}</span>
                  {t.comida && <span className="flex items-center gap-1 text-xs text-slate-500"><Icono n="comida" size={13} />{nombreComida(t)} {pausaLarga(t.comida)}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- te toca responder
function Pendientes({ lista, onAbrir }) {
  if (!lista) return <Cargando filas={1} />
  if (!lista.length) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-superficie px-4 py-3 ring-1 ring-slate-200">
        <Icono n="ok" size={26} className="text-marca-texto" />
        <span className="text-sm text-slate-700"><b className="text-slate-900">Todo al día.</b> No tienes nada que responder.</span>
      </div>
    )
  }
  return (
    <section aria-labelledby="titulo-pend" className="overflow-hidden rounded-2xl bg-superficie ring-2 ring-marca">
      <h2 id="titulo-pend" className="flex items-center gap-2 bg-marca px-4 py-2.5 font-bold text-sobre-marca">
        <Icono n="campanaSuena" size={20} />Te toca responder
        <span className="ml-auto rounded-full bg-sobre-marca/20 px-2 text-sm">{lista.length}</span>
      </h2>
      <ul className="divide-y divide-slate-100">
        {lista.map((p) => (
          <li key={`${p.tipo}${p.solicitud_id}`}>
            <button onClick={() => onAbrir(p.solicitud_id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <Icono n={p.tipo === 'confirmar' ? (p.directa ? 'proponer' : 'ok') : 'trato'} size={22} className="text-marca-texto" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">
                  {p.tipo === 'confirmar'
                    ? (p.directa ? `${p.de} te propone un cambio` : `${p.de} te eligió`)
                    : `${p.respuestas} ${p.respuestas === 1 ? 'persona respondió' : 'personas respondieron'}`}
                </span>
                <span className="line-clamp-2 block text-sm text-slate-600">
                  {p.tipo === 'confirmar'
                    ? `${textoTurno(p.turno)}${p.mi_turno ? ` · por tu ${textoTurno(p.mi_turno)}` : ''}`
                    : `${TIPO[p.tipo_solicitud].texto} · ${p.turno ? textoTurno(p.turno) : (p.fechas || []).map(fechaCorta).join(', ')} · elige a alguien`}
                </span>
              </span>
              <Icono n="siguiente" size={18} className="text-slate-400" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Acceso({ icono, texto, onClick }) {
  return (
    <button onClick={onClick} className="flex min-h-20 flex-col items-start justify-between gap-2 rounded-2xl bg-superficie p-3 text-left ring-1 ring-slate-200 transition active:scale-[0.97] hover:ring-slate-300">
      <Icono n={icono} size={26} className="text-marca-texto" />
      <span className="text-sm font-semibold leading-tight text-slate-900">{texto}</span>
    </button>
  )
}
