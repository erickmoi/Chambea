// Lo que se puede hacer con un turno propio: buscar con quién cambiar o publicarlo en la bolsa
import { useEffect, useState } from 'react'
import Icono from './Icono'
import { Hoja, Cargando } from './ui'
import { TarjetaTurno, ListaAvisos, HojaAvisos, Segmentado } from './turnos'
import { rpc, textoTurno, nombreBonito, iniciales, enlaceWhatsApp, enlaceWaA, urlSolicitud, TIPO } from '../lib/datos'
import { fechaCorta, horario, sumarDias, hoy, inicioMes, finMes, fechaNumerica } from '../lib/fechas'
import { vibrar } from '../lib/tema'

export function HojaTurno({ t, publicado, onCerrar, onBuscar, onPublicar, onVerSolicitud }) {
  const futuro = new Date(t.inicio) > new Date()
  return (
    <Hoja titulo={fechaCorta(t.fecha)} icono="calendario" onCerrar={onCerrar}>
      <TarjetaTurno t={t} publicado={!!publicado} />
      {t.es_cambio && <p className="mt-2 text-sm text-slate-500">🔁 Este turno viene de un cambio hecho en Chambea.</p>}
      {!futuro ? (
        <p className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-600">Este turno ya empezó o ya pasó.</p>
      ) : publicado ? (
        <div className="mt-5 space-y-2">
          <p className="text-sm text-slate-600">Ya está en la bolsa como <b>{TIPO[publicado.tipo].texto.toLowerCase()}</b> ({publicado.estado === 'por_confirmar' ? 'esperando confirmación' : 'abierta'}).</p>
          <button className="btn-primario w-full" onClick={() => onVerSolicitud(publicado.id)}>Ver solicitud</button>
        </div>
      ) : (
        <div className="mt-5 grid gap-2">
          <button className="btn-primario flex items-center justify-center gap-2 py-3" onClick={onBuscar}>
            <Icono n="buscar" size={20} />Buscar con quién cambiar
          </button>
          <button className="btn-secundario flex items-center justify-center gap-2 py-3" onClick={onPublicar}>
            <Icono n="compartir" size={20} />Publicar en la bolsa
          </button>
          <p className="text-center text-xs text-slate-500">Buscar te sugiere personas y días; publicar lo deja abierto para todos.</p>
        </div>
      )}
    </Hoja>
  )
}

// ---------------------------------------------------------------- buscar con quién cambiar
export function BuscarCambio({ t, onCerrar, avisar, onListo }) {
  const rangos = [
    { id: '3', texto: '±3 días', desde: sumarDias(t.fecha, -3), hasta: sumarDias(t.fecha, 3) },
    { id: '7', texto: '±7 días', desde: sumarDias(t.fecha, -7), hasta: sumarDias(t.fecha, 7) },
    { id: 'mes', texto: 'Todo el mes', desde: inicioMes(t.fecha), hasta: finMes(t.fecha) },
    { id: 'otro', texto: 'Elegir fechas' },
  ]
  const [rango, setRango] = useState('7')
  const [desde, setDesde] = useState(sumarDias(t.fecha, -7))
  const [hasta, setHasta] = useState(sumarDias(t.fecha, 7))
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [elegido, setElegido] = useState(null)

  useEffect(() => {
    let vivo = true
    setRes(null)
    setError('')
    rpc('sugerir_permutas', { p_turno_id: t.id, p_desde: desde, p_hasta: hasta })
      .then((r) => vivo && setRes(r))
      .catch((e) => vivo && setError(e.message))
    return () => { vivo = false }
  }, [t.id, desde, hasta])

  const elegirRango = (r) => {
    setRango(r.id)
    if (r.desde) { setDesde(r.desde); setHasta(r.hasta) }
  }

  return (
    <Hoja titulo="Buscar con quién cambiar" icono="buscar" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-slate-600">Tu turno: <b className="mono">{textoTurno(t)}</b></p>
      <div className="fila-lateral -mx-1 mb-3 flex gap-2 px-1">
        {rangos.map((r) => (
          <button key={r.id} onClick={() => elegirRango(r)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${rango === r.id ? 'bg-marca text-sobre-marca' : 'bg-slate-100 text-slate-700'}`}>
            {r.texto}
          </button>
        ))}
      </div>
      {rango === 'otro' && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">Desde<input type="date" className="input mt-1" value={desde} min={hoy()} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
          <label className="text-xs text-slate-500">Hasta<input type="date" className="input mt-1" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} /></label>
        </div>
      )}

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!res && !error && <Cargando filas={3} />}
      {res && (
        <div className="space-y-2">
          {res.opciones.length === 0 ? (
            <p className="rounded-xl bg-slate-100 p-4 text-center text-sm text-slate-600">
              No hay cambios posibles del {fechaNumerica(res.desde)} al {fechaNumerica(res.hasta)}.
              Prueba con más días o publícalo en la bolsa.
            </p>
          ) : (
            <ul className="escalonado space-y-2">
              {res.opciones.map((o) => (
                <li key={o.turno_id} className="flex items-center gap-3 rounded-2xl bg-superficie p-3 ring-1 ring-slate-200">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-planilla-claro text-sm font-bold text-planilla">{iniciales(o.persona)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{nombreBonito(o.persona)}</span>
                    <span className="mono block text-sm text-slate-600">{fechaCorta(o.fecha)} · {horario(o.etiqueta)}</span>
                    <ListaAvisos avisos={[...o.avisos_mios]} className="mt-1 text-xs" />
                    {!o.tiene_cuenta && <span className="text-xs text-slate-500">Todavía no usa Chambea</span>}
                  </span>
                  {o.tiene_cuenta ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      {o.telefono && (
                        <a className="btn-secundario px-2.5 py-2 text-emerald-700" target="_blank" rel="noreferrer" aria-label="Escribir por WhatsApp"
                          href={enlaceWaA(o.telefono, `Hola ${nombreBonito(o.persona).split(' ')[0]}, ¿te sirve cambiar tu ${fechaCorta(o.fecha)} (${horario(o.etiqueta)}) por mi ${fechaCorta(t.fecha)} (${horario(t.etiqueta)})?`)}>
                          <Icono n="whatsapp" size={18} />
                        </a>
                      )}
                      <button className="btn-primario px-3 py-2 text-sm" onClick={() => setElegido(o)}>Proponer</button>
                    </span>
                  ) : (
                    <a className="btn-secundario shrink-0 px-3 py-2 text-sm" target="_blank" rel="noreferrer"
                      href={enlaceWhatsApp(`Hola ${nombreBonito(o.persona).split(' ')[0]}, ¿te sirve cambiar tu ${fechaCorta(o.fecha)} (${horario(o.etiqueta)}) por mi ${fechaCorta(t.fecha)} (${horario(t.etiqueta)})? Lo arreglamos en Chambea: ${window.location.origin}`)}>
                      Invitar
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {res.descartadas > 0 && (
            <p className="text-center text-xs text-slate-500">
              {res.descartadas} opción(es) ocultas porque dejarían turnos de planilla pegados o un cruce.
            </p>
          )}
        </div>
      )}

      {elegido && (
        <Proponer t={t} o={elegido} avisar={avisar} onCerrar={() => setElegido(null)}
          onListo={() => { setElegido(null); onListo() }} />
      )}
    </Hoja>
  )
}

function Proponer({ t, o, onCerrar, avisar, onListo }) {
  const [nota, setNota] = useState('')
  const [avisos, setAvisos] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [enviada, setEnviada] = useState(null)

  const enviar = async (confirmo = false) => {
    setEnviando(true)
    try {
      const r = await rpc('proponer_permuta', { p_mi_turno: t.id, p_su_turno: o.turno_id, p_nota: nota || null, p_confirmo_choque: confirmo })
      if (!r.ok) return setAvisos(r.choques)
      vibrar()
      setAvisos(null)
      avisar(`Propuesta enviada a ${nombreBonito(o.persona).split(' ')[0]} 📩`)
      if (o.telefono) setEnviada(r.solicitud_id)
      else onListo()
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setEnviando(false)
    }
  }

  if (enviada) {
    const nombre = nombreBonito(o.persona).split(' ')[0]
    return (
      <Hoja titulo="Propuesta enviada" icono="ok" onCerrar={onListo}>
        <p className="text-sm text-slate-600">{nombre} ya la tiene en Chambea. ¿Le avisas por WhatsApp para que la vea rápido?</p>
        <a className="btn-primario mt-4 flex items-center justify-center gap-2 py-3" target="_blank" rel="noreferrer"
          href={enlaceWaA(o.telefono, `Hola ${nombre}, te propuse un cambio en Chambea: mi ${fechaCorta(t.fecha)} (${horario(t.etiqueta)}) por tu ${fechaCorta(o.fecha)} (${horario(o.etiqueta)}). ${urlSolicitud(enviada)}`)}>
          <Icono n="whatsapp" size={20} />Avisar a {nombre} por WhatsApp
        </a>
        <button className="btn-secundario mt-2 w-full" onClick={onListo}>Listo</button>
      </Hoja>
    )
  }

  return (
    <>
      <Hoja titulo="Proponer cambio" icono="proponer" onCerrar={onCerrar}>
        <div className="space-y-2 rounded-2xl bg-slate-100 p-3 text-sm">
          <p>Das: <b className="mono">{fechaCorta(t.fecha)} · {horario(t.etiqueta)}</b></p>
          <p>Recibes: <b className="mono">{fechaCorta(o.fecha)} · {horario(o.etiqueta)}</b></p>
          <p>Con: <b>{nombreBonito(o.persona)}</b></p>
        </div>
        <label className="etiqueta mt-4" htmlFor="nota">Mensaje (opcional)</label>
        <textarea id="nota" className="input" rows={2} maxLength={300} placeholder="¿Te sirve? Te lo agradecería mucho."
          value={nota} onChange={(e) => setNota(e.target.value)} />
        <button className="btn-primario mt-4 w-full py-3" disabled={enviando} onClick={() => enviar(false)}>
          {enviando ? 'Enviando…' : 'Enviar propuesta'}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">Si acepta, el cambio queda hecho 🔁. Luego lo tramitan con jefatura.</p>
      </Hoja>
      {avisos && <HojaAvisos avisos={avisos} enviando={enviando} onCancelar={() => setAvisos(null)} onContinuar={() => enviar(true)} />}
    </>
  )
}

// ---------------------------------------------------------------- publicar en la bolsa
export function PublicarTurno({ t, onCerrar, avisar, onListo }) {
  const [tipo, setTipo] = useState('permuta')
  const [fechas, setFechas] = useState([])
  const [fecha, setFecha] = useState('')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecha, setHecha] = useState(null)

  const agregarFecha = (f) => {
    if (f && !fechas.includes(f)) setFechas([...fechas, f].sort())
    setFecha('')
  }
  const publicar = async () => {
    setEnviando(true)
    try {
      const id = await rpc('publicar_solicitud', {
        p_tipo: tipo, p_turno_id: t.id, p_fechas: tipo === 'permuta' ? fechas : [], p_nota: nota || null,
      })
      vibrar()
      setHecha(id)
      onListo?.()
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setEnviando(false)
    }
  }

  if (hecha) {
    const texto = `${TIPO[tipo].texto} en Chambea: ${textoTurno(t)}. ¿Te sirve? ${urlSolicitud(hecha)}`
    return (
      <Hoja titulo="Publicado" icono="ok" onCerrar={onCerrar}>
        <p className="text-sm text-slate-600">Ya está en la bolsa. Avisamos a quienes pueden tomarlo. ¿Lo compartes en el grupo?</p>
        <a className="btn-primario mt-4 flex items-center justify-center gap-2 py-3" target="_blank" rel="noreferrer" href={enlaceWhatsApp(texto)}>
          <Icono n="whatsapp" size={20} />Compartir a WhatsApp
        </a>
        <button className="btn-secundario mt-2 w-full" onClick={onCerrar}>Listo</button>
      </Hoja>
    )
  }

  return (
    <Hoja titulo="Publicar en la bolsa" icono="compartir" onCerrar={onCerrar}>
      <TarjetaTurno t={t} />
      <span className="etiqueta mt-4">¿Qué necesitas?</span>
      <Segmentado valor={tipo} onCambio={setTipo} opciones={[
        { id: 'permuta', texto: 'Cambiar' }, { id: 'ceder', texto: 'Regalar' }, { id: 'cobertura', texto: 'Que me cubran' },
      ]} />
      <p className="mt-2 text-xs text-slate-500">
        {tipo === 'permuta' && 'Te ofrecerán un turno suyo a cambio y tú eliges.'}
        {tipo === 'ceder' && 'Lo regalas: quien lo tome se queda con él.'}
        {tipo === 'cobertura' && 'Pides que alguien vaya por ti ese día.'}
      </p>

      {tipo === 'permuta' && (
        <div className="mt-4">
          <span className="etiqueta">Fechas que te sirven (opcional)</span>
          <div className="flex gap-2">
            <input type="date" className="input" value={fecha} min={hoy()} onChange={(e) => agregarFecha(e.target.value)} />
          </div>
          {fechas.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {fechas.map((f) => (
                <button key={f} onClick={() => setFechas(fechas.filter((x) => x !== f))}
                  className="flex items-center gap-1 rounded-full bg-planilla-claro px-2.5 py-1 text-sm font-medium text-planilla">
                  {fechaCorta(f)} <Icono n="cerrar" size={14} />
                </button>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">Si no eliges, cualquier fecha compatible sirve.</p>
        </div>
      )}

      <label className="etiqueta mt-4" htmlFor="nota-pub">Nota (opcional)</label>
      <textarea id="nota-pub" className="input" rows={2} maxLength={300} placeholder="Tengo una cita médica ese día."
        value={nota} onChange={(e) => setNota(e.target.value)} />
      <button className="btn-primario mt-4 w-full py-3" disabled={enviando} onClick={publicar}>
        {enviando ? 'Publicando…' : 'Publicar'}
      </button>
    </Hoja>
  )
}
