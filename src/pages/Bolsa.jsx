// Bolsa de cambios: solicitudes abiertas que puedo tomar (Planilla / SP) y "Míos"
import { useCallback, useEffect, useState } from 'react'
import Icono from '../components/Icono'
import { Cargando, Hoja } from '../components/ui'
import { Segmentado } from '../components/turnos'
import { rpc, TIPO, ESTADO, FUNCION, textoTurno, nombreBonito } from '../lib/datos'
import { fechaCorta, haceCuanto, hoy } from '../lib/fechas'
import { vibrar } from '../lib/tema'

const FILTROS = [{ id: 'todo', texto: 'Todo' }, ...Object.entries(TIPO).map(([id, t]) => ({ id, texto: t.texto }))]

export default function Bolsa({ cuenta, avisar, onAbrirSolicitud, recarga }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('chambea.bolsa') || 'planilla' } catch { return 'planilla' } })
  const [filtro, setFiltro] = useState('todo')
  const [lista, setLista] = useState(null)
  const [mov, setMov] = useState(null)
  const [error, setError] = useState('')
  const [busco, setBusco] = useState(false)

  useEffect(() => { try { localStorage.setItem('chambea.bolsa', tab) } catch { /* nada */ } }, [tab])

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

  const visibles = (lista || []).filter((s) => filtro === 'todo' || s.tipo === filtro)

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bolsa de cambios</h1>
        <button className="btn-secundario flex items-center gap-1.5 px-3 py-2 text-sm" onClick={cargar} aria-label="Actualizar">
          <Icono n="recargar" size={18} />
        </button>
      </div>

      <Segmentado valor={tab} onCambio={setTab} opciones={[
        { id: 'planilla', texto: 'Planilla' }, { id: 'sp', texto: 'SP' }, { id: 'mios', texto: 'Míos' },
      ]} />

      {tab !== 'mios' && (
        <div className="fila-lateral -mx-1 flex gap-2 px-1">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${filtro === f.id ? 'bg-marca text-sobre-marca' : 'bg-slate-100 text-slate-700'}`}>
              {f.texto}
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
            <p className="mt-2 font-semibold text-slate-800">No hay solicitudes para ti por ahora</p>
            <p className="mt-1 text-sm text-slate-500">Aquí aparecen los turnos que tus compañeros quieren cambiar y que tú puedes tomar.</p>
          </div>
        ) : (
          <ul className="escalonado space-y-3">
            {visibles.map((s) => <TarjetaSolicitud key={s.id} s={s} onClick={() => onAbrirSolicitud(s.id)} />)}
          </ul>
        )
      )}

      {tab === 'mios' && !mov && !error && <Cargando filas={3} />}
      {tab === 'mios' && mov && <Mios mov={mov} onAbrir={onAbrirSolicitud} />}

      <button onClick={() => setBusco(true)}
        className="btn-primario fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-2 rounded-full px-5 py-3.5 shadow-lg md:bottom-6">
        <Icono n="mas" size={20} />Busco turno
      </button>

      {busco && <PublicarBusco cuenta={cuenta} seccion={tab === 'sp' ? 'sp' : 'planilla'} avisar={avisar}
        onCerrar={() => setBusco(false)} onListo={(id) => { setBusco(false); cargar(); onAbrirSolicitud(id) }} />}
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
          {s.turno ? <> · <span className="mono">{textoTurno(s.turno)}</span></> : <> busca turno: <span className="mono">{s.fechas.map(fechaCorta).join(', ')}</span></>}
        </p>
        {s.tipo === 'permuta' && s.fechas.length > 0 && <p className="text-sm text-slate-500">Le sirven: {s.fechas.map(fechaCorta).join(', ')}</p>}
        {s.nota && <p className="text-sm italic text-slate-600">“{s.nota}”</p>}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {s.funcion !== 'triaje' && s.funcion !== 'general' && <span className="rounded-full bg-slate-100 px-2 py-0.5">{FUNCION[s.funcion]}</span>}
          <span>{s.respuestas} respuesta(s)</span>
          {s.mi_respuesta && <span className="ml-auto font-semibold text-marca-texto">{s.mi_respuesta === 'elegida' ? 'Te eligieron' : s.mi_respuesta === 'pendiente' ? 'Ya respondiste' : ESTADO[s.mi_respuesta]}</span>}
        </div>
      </button>
    </li>
  )
}

function Mios({ mov, onAbrir }) {
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
        <Seccion titulo="Cambios hechos 🔁">
          {mov.cambios.map((c) => (
            <Fila key={c.id} icono="cambio" titulo={`${c.recibi ? 'Recibiste' : 'Entregaste'} ${textoTurno(c.turno)}`}
              sub={`Con ${c.con} · ${haceCuanto(c.creado)}${c.turno.fecha >= hoy() ? ' · recuerda tramitarlo con jefatura' : ''}`} />
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

function Fila({ icono, titulo, sub, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
      <Icono n={icono} size={22} className="text-marca-texto" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-900">{titulo}</span>
        <span className="block truncate text-sm text-slate-500">{sub}</span>
      </span>
      {onClick && <Icono n="siguiente" size={18} className="text-slate-400" />}
    </Tag>
  )
}

// "Busco turno": quiero turnos extra en ciertas fechas
function PublicarBusco({ cuenta, seccion: inicial, avisar, onCerrar, onListo }) {
  const funcionesPlanilla = [
    !cuenta.es_supervisor && { id: 'triaje', texto: 'Triaje' },
    cuenta.referencias_planilla && { id: 'referencias', texto: 'Referencias' },
    cuenta.es_supervisor && { id: 'supervisor', texto: 'Supervisor' },
  ].filter(Boolean)
  const funcionesSp = [{ id: 'general', texto: 'General' }, cuenta.referencias_sp && { id: 'referencias', texto: 'Referencias' }].filter(Boolean)
  const [seccion, setSeccion] = useState(inicial)
  const opciones = seccion === 'sp' ? funcionesSp : funcionesPlanilla
  const [funcion, setFuncion] = useState(opciones[0]?.id)
  const [fechas, setFechas] = useState([])
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => { setFuncion((seccion === 'sp' ? funcionesSp : funcionesPlanilla)[0]?.id) }, [seccion]) // eslint-disable-line react-hooks/exhaustive-deps

  const publicar = async () => {
    setEnviando(true)
    try {
      const id = await rpc('publicar_solicitud', { p_tipo: 'busco', p_seccion: seccion, p_funcion: funcion, p_fechas: fechas, p_nota: nota || null })
      vibrar()
      avisar('Publicado en la bolsa ✅')
      onListo(id)
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja titulo="Busco turno" icono="buscar" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-slate-600">Avisa que quieres turnos extra. Quien quiera soltar uno te lo ofrecerá.</p>
      <Segmentado valor={seccion} onCambio={setSeccion} opciones={[{ id: 'planilla', texto: 'Planilla' }, { id: 'sp', texto: 'SP' }]} />
      {opciones.length > 1 && (
        <div className="mt-3">
          <span className="etiqueta">Función</span>
          <Segmentado valor={funcion} onCambio={setFuncion} opciones={opciones} />
        </div>
      )}
      <div className="mt-4">
        <span className="etiqueta">Fechas que buscas</span>
        <input type="date" className="input" min={hoy()} value="" onChange={(e) => e.target.value && !fechas.includes(e.target.value) && setFechas([...fechas, e.target.value].sort())} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {fechas.map((f) => (
            <button key={f} onClick={() => setFechas(fechas.filter((x) => x !== f))}
              className="flex items-center gap-1 rounded-full bg-sp-claro px-2.5 py-1 text-sm font-medium text-sp">
              {fechaCorta(f)} <Icono n="cerrar" size={14} />
            </button>
          ))}
        </div>
      </div>
      <label className="etiqueta mt-4" htmlFor="nota-busco">Nota (opcional)</label>
      <textarea id="nota-busco" className="input" rows={2} maxLength={300} placeholder="Prefiero noches."
        value={nota} onChange={(e) => setNota(e.target.value)} />
      <button className="btn-primario mt-4 w-full py-3" disabled={enviando || !fechas.length || !funcion} onClick={publicar}>
        {enviando ? 'Publicando…' : 'Publicar'}
      </button>
      {!fechas.length && <p className="mt-2 text-center text-xs text-slate-500">Elige al menos una fecha.</p>}
    </Hoja>
  )
}
