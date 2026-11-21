// Permutas: solicitudes abiertas que puedo tomar (Planilla: permutas · Servicios Profesionales: permutas y donaciones) y "Míos"
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icono from '../components/Icono'
import { Cargando, Hoja, confirmar } from '../components/ui'
import { Segmentado } from '../components/turnos'
import { rpc, TIPO, ESTADO, FUNCION, textoTurno, nombreBonito, misTurnos, evaluarTurno } from '../lib/datos'
import { supabase } from '../lib/supabase'
import { fechaCorta, haceCuanto, hoy, sumarDias } from '../lib/fechas'

// Planilla solo tiene permutas; Servicios Profesionales tiene permutas y donaciones
const FILTROS = {
  planilla: [{ id: 'todo', texto: 'Todo' }, { id: 'sirve', texto: 'Me sirven', icono: 'ok' }],
  sp: [{ id: 'todo', texto: 'Todo' }, { id: 'sirve', texto: 'Me sirven', icono: 'ok' },
    { id: 'permuta', texto: 'Permutas', icono: 'cambio' }, { id: 'ceder', texto: 'Donaciones', icono: 'ceder' }],
}

export default function Bolsa({ cuenta, avisar, onAbrirSolicitud, recarga, pendientes = 0 }) {
  const deshacer = async (c) => {
    if (!(await confirmar({ titulo: 'Deshacer cambio', texto: `Los turnos con ${c.con} vuelven a como estaban.`, boton: 'Deshacer', peligro: true }))) return
    try { await rpc('deshacer_cambio', { p_cambio_id: c.id }); avisar('Cambio deshecho'); cargar() } catch (e) { avisar(e.message, 'error') }
  }
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('chambea.bolsa') || 'planilla' } catch { return 'planilla' } })
  const [filtro, setFiltro] = useState('todo')
  const [lista, setLista] = useState(null)
  const [mov, setMov] = useState(null)
  const [error, setError] = useState('')
  const [mios, setMios] = useState([])
  const [minDescanso, setMinDescanso] = useState(8)

  useEffect(() => {
    supabase.from('ajustes').select('min_descanso_planilla_h').eq('id', 1).single()
      .then(({ data }) => data && setMinDescanso(data.min_descanso_planilla_h))
  }, [])

  // Mis turnos alrededor de las fechas de la bolsa, para decir si cada turno me sirve
  useEffect(() => {
    const fechas = (lista || []).filter((s) => s.turno && !s.mia).map((s) => s.turno.fecha).sort()
    if (!fechas.length) return
    misTurnos(cuenta.persona_id, sumarDias(fechas[0], -1), sumarDias(fechas[fechas.length - 1], 1))
      .then((r) => setMios(r.turnos), () => {})
  }, [lista, cuenta.persona_id])

  const evaluadas = useMemo(() => (lista || []).map((s) => ({
    ...s, evaluacion: !s.mia && s.tipo !== 'busco' ? evaluarTurno(s.turno, mios, minDescanso) : null,
  })), [lista, mios, minDescanso])

  useEffect(() => { try { localStorage.setItem('chambea.bolsa', tab) } catch { /* nada */ } setFiltro('todo') }, [tab])

  const cargar = useCallback(async () => {
    setError('')
    try {
      if (tab === 'mios') setMov(await rpc('mis_movimientos'))
      else setLista(await rpc('bolsa', { p_seccion: tab }))
    } catch (e) {
      setError(e.message)
    }
  }, [tab])

  useEffect(() => { setLista(null); setMov(null); cargar() }, [cargar, recarga])

  const visibles = evaluadas.filter((s) => filtro === 'todo' || (filtro === 'sirve' ? s.evaluacion?.estado === 'sirve' : s.tipo === filtro))

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Permutas</h1>
        <button className="btn-secundario flex items-center gap-1.5 px-3 py-2 text-sm" onClick={cargar} aria-label="Actualizar">
          <Icono n="recargar" size={18} />
        </button>
      </div>

      <Segmentado etiqueta="Sección" valor={tab} onCambio={setTab} opciones={[
        { id: 'planilla', texto: 'Planilla' }, { id: 'sp', texto: 'Servicios Profesionales' }, { id: 'mios', texto: 'Míos', cuenta: pendientes },
      ]} />

      {tab !== 'mios' && (
        <div className="fila-lateral -mx-1 flex gap-2 px-1">
          {FILTROS[tab].map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
              className={`flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${filtro === f.id ? 'bg-marca text-sobre-marca' : 'bg-slate-100 text-slate-700'}`}>
              {f.icono && <Icono n={f.icono} size={15} />}{f.texto}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}<button className="btn-secundario px-3 py-1.5 text-sm" onClick={cargar}>Reintentar</button>
        </div>
      )}

      {tab !== 'mios' && !lista && !error && <Cargando filas={3} />}
      {tab !== 'mios' && lista && (
        visibles.length === 0 ? (
          <div className="rounded-2xl bg-superficie p-6 text-center ring-1 ring-slate-200">
            <Icono n="trato" size={40} className="mx-auto text-marca-texto" />
            <p className="mt-2 font-semibold text-slate-800">{filtro === 'sirve' ? 'Ninguna te sirve sin choques por ahora' : 'No hay solicitudes para ti por ahora'}</p>
            <p className="mt-1 text-sm text-slate-600">Aquí aparecen los turnos que tus compañeros quieren {tab === 'sp' ? 'permutar o donar' : 'permutar'} y que tú puedes tomar. Para publicar uno tuyo, tócalo en tu horario.</p>
          </div>
        ) : (
          <ul className="escalonado space-y-3">
            {visibles.map((s) => <TarjetaSolicitud key={s.id} s={s} onClick={() => onAbrirSolicitud(s.id)} />)}
          </ul>
        )
      )}

      {tab === 'mios' && !mov && !error && <Cargando filas={3} />}
      {tab === 'mios' && mov && <Mios mov={mov} onAbrir={onAbrirSolicitud} onDeshacer={deshacer} />}

    </div>
  )
}

function TarjetaSolicitud({ s, onClick }) {
  const tipo = TIPO[s.tipo]
  return (
    <li>
      <button onClick={onClick} className="w-full space-y-2 rounded-2xl bg-superficie p-4 text-left ring-1 ring-slate-200 transition active:scale-[0.98] hover:ring-slate-300">
        <div className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tipo.color}`}><Icono n={tipo.icono} size={14} />{tipo.texto}</span>
          <span className="text-xs text-slate-500">{haceCuanto(s.creado)}</span>
        </div>
        <p className="text-slate-900">
          <b>{s.mia ? 'Tú' : nombreBonito(s.autor_completo)}</b>
          {s.turno ? <> · <span className="font-medium">{textoTurno(s.turno)}</span></> : <> busca turno: <span className="font-medium">{s.fechas.map(fechaCorta).join(', ')}</span></>}
        </p>
        {s.tipo === 'permuta' && s.fechas.length > 0 && <p className="text-sm text-slate-500">Le sirven: {s.fechas.map(fechaCorta).join(', ')}</p>}
        {s.nota && <p className="text-sm italic text-slate-600">“{s.nota}”</p>}
        <Evaluacion e={s.evaluacion} />
        <div className="flex items-center gap-2 text-xs text-slate-600">
          {s.funcion !== 'triaje' && s.funcion !== 'general' && <span className="rounded-full bg-slate-100 px-2 py-0.5">{FUNCION[s.funcion]}</span>}
          <span>{s.respuestas} respuesta(s)</span>
          {s.mi_respuesta && <span className="ml-auto font-semibold text-marca-texto">{s.mi_respuesta === 'elegida' ? 'Te eligieron' : s.mi_respuesta === 'pendiente' ? 'Ya respondiste' : ESTADO[s.mi_respuesta]}</span>}
        </div>
      </button>
    </li>
  )
}

function Evaluacion({ e }) {
  if (!e) return null
  const estilos = {
    sirve: { c: 'bg-emerald-50 text-emerald-700', i: 'ok', t: 'Te sirve: no choca con tus turnos' },
    choca: { c: 'bg-red-50 text-red-700', i: 'prohibido', t: `Choca con tu turno del ${fechaCorta(e.con?.fecha || hoy())}` },
    pegado: { c: 'bg-amber-50 text-amber-800', i: 'alerta', t: `Te quedaría pegado a tu turno del ${fechaCorta(e.con?.fecha || hoy())}` },
  }[e.estado]
  return <p className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ${estilos.c}`}><Icono n={estilos.i} size={15} />{estilos.t}</p>
}

function Mios({ mov, onAbrir, onDeshacer }) {
  const recibidas = mov.respondidas.filter((r) => r.directa && r.estado === 'elegida')
  const elegidas = mov.respondidas.filter((r) => !r.directa && r.estado === 'elegida')
  const vivas = mov.publicadas.filter((s) => ['abierta', 'por_confirmar'].includes(s.estado))
  const respondidas = mov.respondidas.filter((r) => r.estado === 'pendiente')
  const vacio = !recibidas.length && !elegidas.length && !vivas.length && !respondidas.length && !mov.cambios.length

  if (vacio) {
    return (
      <div className="rounded-2xl bg-superficie p-6 text-center ring-1 ring-slate-200">
        <Icono n="historial" size={40} className="mx-auto text-marca-texto" />
        <p className="mt-2 font-semibold text-slate-800">Todavía no tienes movimientos</p>
        <p className="mt-1 text-sm text-slate-500">Desde Mi horario toca un turno para buscar con quién cambiar o publicarlo.</p>
      </div>
    )
  }
  return (
    <div className="space-y-5">
      {(recibidas.length > 0 || elegidas.length > 0) && (
        <Seccion titulo="Te toca responder" destacado>
          {recibidas.map((r) => (
            <Fila key={r.oferta_id} onClick={() => onAbrir(r.solicitud_id)} icono="proponer"
              titulo={`${r.autor} te propone un cambio`} sub={`Te da ${textoTurno(r.turno)} · por tu ${textoTurno(r.mi_turno)}`} />
          ))}
          {elegidas.map((r) => (
            <Fila key={r.oferta_id} onClick={() => onAbrir(r.solicitud_id)} icono="ok"
              titulo={`${r.autor} te eligió`} sub="Confirma para aplicar el cambio" />
          ))}
        </Seccion>
      )}
      {vivas.length > 0 && (
        <Seccion titulo="Lo que publiqué">
          {vivas.map((s) => (
            <Fila key={s.id} onClick={() => onAbrir(s.id)} icono={TIPO[s.tipo].icono}
              titulo={s.directa ? `Propuesta a ${s.destino}` : TIPO[s.tipo].texto}
              sub={`${s.turno ? textoTurno(s.turno) : s.fechas.map(fechaCorta).join(', ')} · ${s.directa ? 'esperando su respuesta' : `${s.respuestas} respuesta(s)`}`} />
          ))}
        </Seccion>
      )}
      {respondidas.length > 0 && (
        <Seccion titulo="Donde me ofrecí">
          {respondidas.map((r) => (
            <Fila key={r.oferta_id} onClick={() => onAbrir(r.solicitud_id)} icono="hola"
              titulo={`${TIPO[r.tipo].texto} de ${r.autor}`} sub={`${textoTurno(r.turno)} · esperando que elija`} />
          ))}
        </Seccion>
      )}
      {mov.cambios.length > 0 && (
        <Seccion titulo="Cambios hechos">
          {mov.cambios.map((c) => (
            <Fila key={c.id} icono="cambio" titulo={`${c.recibi ? 'Recibiste' : 'Entregaste'} ${textoTurno(c.turno)}`}
              sub={`Con ${c.con} · ${haceCuanto(c.creado)}${c.turno.fecha >= hoy() ? ' · recuerda tramitarlo con jefatura' : ''}`}
              accion={c.se_puede_deshacer && <button className="btn-secundario shrink-0 px-3 py-1.5 text-sm" onClick={() => onDeshacer(c)}>Deshacer</button>} />
          ))}
        </Seccion>
      )}
    </div>
  )
}

function Seccion({ titulo, destacado, children }) {
  return (
    <section className="space-y-2">
      <h2 className={`text-sm font-semibold uppercase tracking-wide ${destacado ? 'text-marca-texto' : 'text-slate-500'}`}>{titulo}</h2>
      <div className="tarjeta divide-y divide-slate-100 p-0">{children}</div>
    </section>
  )
}

function Fila({ icono, titulo, sub, onClick, accion }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
      <Icono n={icono} size={22} className="text-marca-texto" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-900">{titulo}</span>
        <span className="block truncate text-sm text-slate-500">{sub}</span>
      </span>
      {accion}
      {onClick && <Icono n="siguiente" size={18} className="text-slate-400" />}
    </Tag>
  )
}
