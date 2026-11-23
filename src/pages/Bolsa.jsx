// Permutas: solicitudes abiertas que puedo tomar (Planilla: permutas · Servicios Profesionales: permutas y donaciones) y "Míos"
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icono from '../components/Icono'
import { Cargando, Hoja, confirmar } from '../components/ui'
import { Segmentado, TarjetaTurno, momento } from '../components/turnos'
import { useDeslizar, claseDeslizar } from '../lib/deslizar'
import { PublicarTurno } from '../components/AccionesTurno'
import { rpc, TIPO, ESTADO, FUNCION, textoTurno, nombreBonito, misTurnos } from '../lib/datos'
import { vibrar } from '../lib/tema'
import { fechaCorta, haceCuanto, hoy, sumarDias, numDia, mesCorto, horario } from '../lib/fechas'

// Planilla solo tiene permutas; Servicios Profesionales tiene permutas y donaciones
const FILTROS = {
  planilla: [{ id: 'todo', texto: 'Todo' }, { id: 'sirve', texto: 'Puedo tomar', icono: 'ok' }],
  sp: [{ id: 'todo', texto: 'Todo' }, { id: 'sirve', texto: 'Puedo tomar', icono: 'ok' },
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
  const [agregar, setAgregar] = useState(false)
  const [elegido, setElegido] = useState(null)
  const [enviando, setEnviando] = useState(null)

  // Orden: primero lo que puedo tomar, luego lo mío, al final (en gris) lo que no puedo
  const evaluadas = useMemo(() => {
    const peso = (s) => (s.mia ? 1 : ['permutar', 'sirve'].includes(s.viabilidad?.estado) ? 0 : 2)
    return [...(lista || [])].sort((a, b) => peso(a) - peso(b))
  }, [lista])

  // Ofrecer directo desde la tarjeta: mi turno a cambio (permuta) o tomarlo (donación)
  const ofrecer = async (sol, mio) => {
    const ok = await confirmar(mio
      ? { titulo: 'Ofrecer permuta', icono: 'cambio', boton: 'Ofrecer',
          texto: `Le ofreces a ${nombreBonito(sol.autor_completo).split(' ')[0]} tu turno del ${fechaChip(mio.fecha)} (${horario(mio.etiqueta)}) por su ${fechaChip(sol.turno.fecha)}.` }
      : { titulo: 'Tomar turno', icono: 'ceder', boton: 'Lo quiero',
          texto: `Pides el turno del ${fechaChip(sol.turno.fecha)} (${horario(sol.turno.etiqueta)}). ${nombreBonito(sol.autor_completo).split(' ')[0]} elige a quién se lo da.` })
    if (!ok) return
    setEnviando(sol.id)
    try {
      await rpc('ofertar', { p_solicitud_id: sol.id, p_turno_id: mio?.id ?? null })
      vibrar()
      avisar(mio ? 'Permuta ofrecida. Te avisamos cuando responda.' : 'Listo, te avisamos si te lo da.')
      cargar()
    } catch (e) { avisar(e.message, 'error') } finally { setEnviando(null) }
  }

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

  const ORDEN_TABS = ['planilla', 'sp', 'mios']
  const [dirTab, setDirTab] = useState(0)
  const irTab = (n) => {
    const i = ORDEN_TABS.indexOf(tab) + n
    if (i < 0 || i >= ORDEN_TABS.length) return
    setDirTab(n); setTab(ORDEN_TABS[i])
  }
  const cambiarTab = (v) => { setDirTab(Math.sign(ORDEN_TABS.indexOf(v) - ORDEN_TABS.indexOf(tab))); setTab(v) }
  const refDeslizar = useDeslizar({ onSiguiente: () => irTab(1), onAnterior: () => irTab(-1) })

  const visibles = evaluadas.filter((s) => filtro === 'todo' || (filtro === 'sirve' ? ['permutar', 'sirve'].includes(s.viabilidad?.estado) : s.tipo === filtro))

  return (
    <div ref={refDeslizar} className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Permutas</h1>
        <button className="btn-secundario flex items-center gap-1.5 px-3 py-2 text-sm" onClick={cargar} aria-label="Actualizar">
          <Icono n="recargar" size={18} />
        </button>
      </div>

      <Segmentado etiqueta="Sección" valor={tab} onCambio={cambiarTab} opciones={[
        { id: 'planilla', texto: 'Planilla' }, { id: 'sp', texto: 'Servicios Profesionales' }, { id: 'mios', texto: 'Míos', cuenta: pendientes },
      ]} />

      {cuenta.en_permutas === false && (
        <p className="flex items-center gap-2 rounded-xl bg-marca-claro p-3 text-sm text-marca-texto">
          <Icono n="info" size={18} />Gerencia médica: aquí ves lo que el equipo está moviendo, sin participar en permutas.
        </p>
      )}

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
          <ul key={tab} className={`escalonado space-y-3 pb-20 ${claseDeslizar(dirTab)}`}>
            {visibles.map((s) => <TarjetaSolicitud key={s.id} s={s} enviando={enviando === s.id} onOfrecer={ofrecer} onClick={() => onAbrirSolicitud(s.id)} />)}
          </ul>
        )
      )}

      {tab === 'mios' && !mov && !error && <Cargando filas={3} />}
      {tab === 'mios' && mov && <div className={claseDeslizar(dirTab)}><Mios mov={mov} onAbrir={onAbrirSolicitud} onDeshacer={deshacer} /></div>}

      {cuenta.en_permutas === false ? null : <button onClick={() => setAgregar(true)}
        className="btn-primario fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-2 rounded-full px-5 py-3.5 shadow-lg md:bottom-6">
        <Icono n="mas" size={20} />Agregar solicitud
      </button>}

      {agregar && !elegido && (
        <ElegirTurno cuenta={cuenta} seccion={tab === 'mios' ? null : tab} onCerrar={() => setAgregar(false)} onElegir={setElegido} />
      )}
      {elegido && (
        <PublicarTurno t={elegido} avisar={avisar} onCerrar={() => { setElegido(null); setAgregar(false) }}
          onListo={() => { cargar() }} />
      )}

    </div>
  )
}

const fechaChip = (iso) => `${numDia(iso)} ${mesCorto(iso)}` // '28 nov'

// Bloque de fecha grande: el día se ve de un vistazo
function FechaGrande({ t }) {
  const sp = t.seccion === 'sp'
  const m = momento(t)
  return (
    <span className={`flex w-16 shrink-0 flex-col items-center justify-center rounded-xl py-2 ${sp ? 'bg-sp-claro text-sp' : 'bg-planilla-claro text-planilla'} ${m.corto ? 'turno-corto' : ''}`}>
      <span className="mono text-3xl font-bold leading-none">{numDia(t.fecha)}</span>
      <span className="text-xs font-bold uppercase">{mesCorto(t.fecha)}</span>
      <Icono n={m.icono} size={16} className="mt-0.5" />
    </span>
  )
}

function TarjetaSolicitud({ s, onClick, onOfrecer, enviando }) {
  const tipo = TIPO[s.tipo]
  const v = s.viabilidad
  const noViable = !s.mia && v?.estado === 'no'
  const opciones = v?.opciones || []
  const fechasMias = new Set(opciones.map((o) => o.fecha))
  return (
    <li className={`overflow-hidden rounded-2xl bg-superficie ring-1 transition ${noViable ? 'opacity-60 ring-slate-200' : v?.estado === 'permutar' || v?.estado === 'sirve' ? 'ring-emerald-200' : 'ring-slate-200'}`}>
      <button onClick={onClick} className="w-full space-y-3 p-4 text-left hover:bg-slate-50">
        <span className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tipo.color}`}><Icono n={tipo.icono} size={14} />{tipo.texto}</span>
          <span className="truncate text-sm font-semibold text-slate-900">{s.mia ? 'Tú' : nombreBonito(s.autor_completo)}</span>
          <span className="ml-auto shrink-0 text-xs text-slate-500">{haceCuanto(s.creado)}</span>
        </span>

        {s.turno && (
          <span className="flex items-center gap-3">
            <FechaGrande t={s.turno} />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-500">{s.tipo === 'permuta' ? 'Entrega' : 'Dona'}</span>
              <span className="mono block text-xl font-semibold leading-tight text-slate-900">{horario(s.turno.etiqueta)}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                <span>{momento(s.turno).texto}</span>
                {s.funcion !== 'triaje' && s.funcion !== 'general' && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{FUNCION[s.funcion]}</span>}
              </span>
            </span>
          </span>
        )}

        {s.tipo === 'permuta' && (
          <span className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Le sirve recibir</span>
            {s.fechas.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {s.fechas.map((f) => (
                  <span key={f} className={`mono rounded-lg px-2.5 py-1 text-sm font-bold ${fechasMias.has(f) ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                    {fechaChip(f)}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-sm text-slate-700">Cualquier fecha con el mismo horario</span>
            )}
          </span>
        )}
        {s.nota && <span className="block text-sm italic text-slate-600">“{s.nota}”</span>}
      </button>

      {/* Viabilidad y acción directa */}
      {!s.mia && (
        <div className={`border-t px-4 py-3 ${noViable ? 'border-slate-100 bg-slate-50' : 'border-emerald-100 bg-emerald-50'}`}>
          {s.mi_respuesta ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-marca-texto">
              <Icono n="hola" size={18} />{s.mi_respuesta === 'elegida' ? 'Te eligieron: confirma en el detalle' : s.mi_respuesta === 'pendiente' ? 'Ya te ofreciste' : ESTADO[s.mi_respuesta]}
            </p>
          ) : v?.estado === 'permutar' ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-700"><Icono n="ok" size={18} />Puedes permutar</p>
              <div className="flex flex-wrap gap-2">
                {opciones.slice(0, 4).map((o) => (
                  <button key={o.id} disabled={enviando} onClick={() => onOfrecer(s, o)}
                    className="btn-primario flex items-center gap-1.5 px-3 py-2 text-sm">
                    <Icono n="cambio" size={16} />Ofrecer mi {fechaChip(o.fecha)}
                  </button>
                ))}
                {opciones.length > 4 && <button onClick={onClick} className="px-2 text-sm font-semibold text-marca-texto">+{opciones.length - 4} más</button>}
              </div>
            </div>
          ) : v?.estado === 'sirve' ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-700"><Icono n="ok" size={18} />Te sirve</p>
              <button disabled={enviando} onClick={() => onOfrecer(s, null)} className="btn-primario flex items-center gap-1.5 px-3 py-2 text-sm">
                <Icono n="ceder" size={16} />Lo quiero
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-slate-600"><Icono n="prohibido" size={16} />No puedes: {v?.motivo || 'no cumple las reglas'}</p>
          )}
        </div>
      )}
      {s.mia && (
        <p className="border-t border-slate-100 px-4 py-2.5 text-sm text-slate-600">{s.respuestas} respuesta(s) · toca para ver y elegir</p>
      )}
    </li>
  )
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

// "Agregar solicitud": elegir uno de mis próximos turnos para publicarlo
function ElegirTurno({ cuenta, seccion, onCerrar, onElegir }) {
  const [lista, setLista] = useState(null)
  const [publicados, setPublicados] = useState({})
  const [sec, setSec] = useState(seccion || 'planilla')
  useEffect(() => {
    Promise.all([misTurnos(cuenta.persona_id, hoy(), sumarDias(hoy(), 60)), rpc('mis_movimientos').catch(() => null)])
      .then(([r, mov]) => {
        setLista(r.turnos.filter((t) => new Date(t.inicio) > new Date()))
        const m = {}
        for (const s of mov?.publicadas || []) if (s.turno && ['abierta', 'por_confirmar'].includes(s.estado)) m[s.turno.id] = true
        setPublicados(m)
      }, () => setLista([]))
  }, [cuenta.persona_id])
  const visibles = (lista || []).filter((t) => t.seccion === sec)
  return (
    <Hoja titulo="Agregar solicitud" icono="mas" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-slate-600">Elige el turno que quieres {sec === 'sp' ? 'permutar o donar' : 'permutar'}.</p>
      <Segmentado etiqueta="Sección" valor={sec} onCambio={setSec} opciones={[
        { id: 'planilla', texto: 'Planilla' }, { id: 'sp', texto: 'Servicios Profesionales' },
      ]} />
      <div className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto pb-1">
        {!lista && <Cargando filas={3} />}
        {lista && visibles.length === 0 && <p className="py-6 text-center text-sm text-slate-600">No tienes turnos próximos de {sec === 'sp' ? 'Servicios Profesionales' : 'planilla'}.</p>}
        {visibles.map((t) => (
          <TarjetaTurno key={t.id} t={t} conFecha publicado={publicados[t.id]}
            onClick={publicados[t.id] ? undefined : () => onElegir(t)} />
        ))}
      </div>
    </Hoja>
  )
}
