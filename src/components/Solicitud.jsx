// Detalle de una solicitud: lo que ve quien publicó, quien recibe una propuesta y quien se ofrece
import { useCallback, useEffect, useState } from 'react'
import Icono from './Icono'
import { Hoja, Cargando } from './ui'
import { TarjetaTurno, ListaAvisos, HojaAvisos, ChipSeccion } from './turnos'
import { supabase } from '../lib/supabase'
import { rpc, TIPO, ESTADO, FUNCION, textoTurno, nombreBonito, iniciales, enlaceWhatsApp, urlSolicitud } from '../lib/datos'
import { fechaCorta, haceCuanto } from '../lib/fechas'
import { vibrar } from '../lib/tema'

export default function Solicitud({ id, cuenta, avisar, onCerrar, onCambio }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [avisos, setAvisos] = useState(null) // { lista, reintentar }
  const [eligiendoTurno, setEligiendoTurno] = useState(false)

  const cargar = useCallback(async () => {
    try { setD(await rpc('detalle_solicitud', { p_id: id })) } catch (e) { setError(e.message) }
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  // Ejecuta una acción; si la base devuelve avisos, pide confirmación y la repite con "confirmo"
  const accion = async (fn, ok) => {
    setEnviando(true)
    try {
      const r = await fn(false)
      if (r && r.ok === false && r.choques) {
        setAvisos({ lista: r.choques, reintentar: async () => {
          setEnviando(true)
          try { await fn(true); setAvisos(null); vibrar(); avisar(ok); onCambio?.(); await cargar() }
          catch (e) { avisar(e.message, 'error') } finally { setEnviando(false) }
        } })
        return
      }
      vibrar()
      avisar(ok)
      onCambio?.()
      await cargar()
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setEnviando(false)
    }
  }

  if (error) return <Hoja titulo="Solicitud" onCerrar={onCerrar}><p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p></Hoja>
  if (!d) return <Hoja titulo="Solicitud" onCerrar={onCerrar}><Cargando filas={3} /></Hoja>

  const tipo = TIPO[d.tipo]
  const miOferta = d.ofertas.find((o) => o.mia && ['pendiente', 'elegida'].includes(o.estado))
  const pendientes = d.ofertas.filter((o) => ['pendiente', 'elegida'].includes(o.estado))
  const abierta = d.estado === 'abierta'
  const textoCompartir = `${tipo.texto} en Chambea (${d.seccion === 'sp' ? 'SP' : 'Planilla'}): ${d.turno ? textoTurno(d.turno) : d.fechas.map(fechaCorta).join(', ')}. ¿Te sirve? ${urlSolicitud(d.id)}`

  return (
    <>
      <Hoja titulo={d.directa ? 'Propuesta de cambio' : tipo.texto} icono={d.directa ? 'proponer' : tipo.icono} onCerrar={onCerrar}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ChipSeccion seccion={d.seccion} />
            {d.funcion !== 'triaje' && d.funcion !== 'general' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{FUNCION[d.funcion]}</span>}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{ESTADO[d.estado]}</span>
            <span className="text-xs text-slate-500">{haceCuanto(d.creado)}</span>
          </div>

          <div>
            <p className="mb-1.5 text-sm text-slate-600"><b>{d.mia ? 'Tú' : nombreBonito(d.autor_completo)}</b> {d.turno ? (d.tipo === 'permuta' ? 'cambia' : d.tipo === 'ceder' ? 'regala' : 'necesita cobertura en') : 'busca turno en'}:</p>
            {d.turno ? <TarjetaTurno t={d.turno} conFecha /> : <p className="mono rounded-2xl bg-slate-100 p-3">{d.fechas.map(fechaCorta).join(' · ')}</p>}
            {d.tipo === 'permuta' && !d.directa && d.fechas.length > 0 && <p className="mt-2 text-sm text-slate-500">Le sirven: {d.fechas.map(fechaCorta).join(', ')}</p>}
            {d.nota && <p className="mt-2 rounded-xl bg-slate-100 p-3 text-sm italic text-slate-700">“{d.nota}”</p>}
          </div>

          {/* ---------------- Quien publicó ---------------- */}
          {d.mia && (
            <div className="space-y-3">
              {d.directa ? (
                <PropuestaResumen o={d.ofertas[0]} estado={d.estado} />
              ) : (
                <>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Respuestas ({pendientes.length})</h3>
                  {pendientes.length === 0 && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">Aún nadie responde. Compártela en el grupo para que la vean.</p>}
                  {pendientes.map((o) => (
                    <div key={o.id} className="space-y-2 rounded-2xl p-3 ring-1 ring-slate-200">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-planilla-claro text-sm font-bold text-planilla">{iniciales(o.persona_completo)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-slate-900">{nombreBonito(o.persona_completo)}</span>
                          <span className="mono block text-sm text-slate-600">{o.turno ? `Te da ${textoTurno(o.turno)}` : 'Toma tu turno'}</span>
                        </span>
                        {o.estado === 'elegida'
                          ? <span className="text-xs font-semibold text-marca-texto">Esperando que confirme</span>
                          : abierta && <button className="btn-primario px-3 py-2 text-sm" disabled={enviando}
                              onClick={() => accion((c) => rpc('elegir_oferta', { p_oferta_id: o.id, p_confirmo_choque: c }), `Elegiste a ${nombreBonito(o.persona_completo).split(' ')[0]} ✅`)}>Elegir</button>}
                      </div>
                      {o.nota && <p className="text-sm italic text-slate-600">“{o.nota}”</p>}
                      <ListaAvisos avisos={o.choques} className="text-xs" />
                    </div>
                  ))}
                </>
              )}
              {['abierta', 'por_confirmar'].includes(d.estado) && (
                <button className="btn-peligro w-full" disabled={enviando}
                  onClick={() => confirm('¿Cancelar esta solicitud?') && accion(() => rpc('cancelar_solicitud', { p_id: d.id }), 'Solicitud cancelada')}>
                  Cancelar solicitud
                </button>
              )}
            </div>
          )}

          {/* ---------------- Me eligieron / me proponen ---------------- */}
          {!d.mia && miOferta?.estado === 'elegida' && d.estado === 'por_confirmar' && (
            <div className="space-y-3 rounded-2xl bg-marca-claro p-4">
              <p className="font-semibold text-slate-900">{d.directa ? `${d.autor} te propone este cambio` : `${d.autor} te eligió`}</p>
              <div className="space-y-1 text-sm text-slate-700">
                {d.turno && <p>Recibes: <b className="mono">{textoTurno(d.turno)}</b></p>}
                {miOferta.turno && <p>Entregas: <b className="mono">{textoTurno(miOferta.turno)}</b></p>}
              </div>
              <div className="flex gap-2">
                <button className="btn-secundario flex-1" disabled={enviando}
                  onClick={() => accion(() => rpc('responder_eleccion', { p_oferta_id: miOferta.id, p_acepta: false }), d.directa ? 'Propuesta rechazada' : 'Listo, avisamos que ya no puedes')}>
                  {d.directa ? 'Rechazar' : 'Ya no puedo'}
                </button>
                <button className="btn-primario flex-1" disabled={enviando}
                  onClick={() => accion((c) => rpc('responder_eleccion', { p_oferta_id: miOferta.id, p_acepta: true, p_confirmo_choque: c }), 'Cambio hecho 🔁 Recuerda tramitarlo con jefatura')}>
                  {d.directa ? 'Aceptar cambio' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}

          {!d.mia && miOferta?.estado === 'pendiente' && (
            <div className="space-y-2 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">
              <p>Te ofreciste{miOferta.turno ? ` con tu ${textoTurno(miOferta.turno)}` : ''}. Te avisamos si te elige.</p>
              <button className="btn-secundario w-full" disabled={enviando}
                onClick={() => accion(() => rpc('retirar_oferta', { p_id: miOferta.id }), 'Retiraste tu respuesta')}>Retirar mi respuesta</button>
            </div>
          )}

          {!d.mia && !miOferta && abierta && (
            d.tipo === 'permuta' || d.tipo === 'busco' ? (
              <button className="btn-primario w-full py-3" onClick={() => setEligiendoTurno(true)}>
                {d.tipo === 'permuta' ? 'Ofrecer un turno mío a cambio' : 'Ofrecerle un turno mío'}
              </button>
            ) : (
              <button className="btn-primario w-full py-3" disabled={enviando}
                onClick={() => accion((c) => rpc('ofertar', { p_solicitud_id: d.id, p_confirmo_choque: c }), 'Te ofreciste ✅')}>
                {d.tipo === 'ceder' ? 'Yo lo tomo' : 'Yo te cubro'}
              </button>
            )
          )}

          {abierta && !d.directa && (
            <a className="btn-secundario flex items-center justify-center gap-2" target="_blank" rel="noreferrer" href={enlaceWhatsApp(textoCompartir)}>
              <Icono n="whatsapp" size={20} />Compartir a WhatsApp
            </a>
          )}
          {d.estado === 'aplicada' && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">Cambio hecho 🔁. Recuerden tramitarlo con jefatura.</p>}
        </div>
      </Hoja>

      {eligiendoTurno && (
        <ElegirMiTurno d={d} cuenta={cuenta} onCerrar={() => setEligiendoTurno(false)}
          onElegir={(t) => { setEligiendoTurno(false); accion((c) => rpc('ofertar', { p_solicitud_id: d.id, p_turno_id: t.id, p_confirmo_choque: c }), 'Te ofreciste ✅') }} />
      )}
      {avisos && <HojaAvisos avisos={avisos.lista} enviando={enviando} onCancelar={() => setAvisos(null)} onContinuar={avisos.reintentar} />}
    </>
  )
}

function PropuestaResumen({ o, estado }) {
  if (!o) return null
  return (
    <div className="space-y-1 rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">
      <p>Para: <b>{nombreBonito(o.persona_completo)}</b></p>
      {o.turno && <p>Recibes: <b className="mono">{textoTurno(o.turno)}</b></p>}
      <p className="font-semibold">{estado === 'por_confirmar' ? 'Esperando su respuesta' : ESTADO[estado]}</p>
    </div>
  )
}

// Mis turnos que sirven para ofrecer en esta solicitud
function ElegirMiTurno({ d, cuenta, onCerrar, onElegir }) {
  const [lista, setLista] = useState(null)
  useEffect(() => {
    let q = supabase.from('turnos').select('id, seccion, fecha, inicio, fin, etiqueta, funcion, es_cambio')
      .eq('persona_id', cuenta.persona_id).eq('seccion', d.seccion).eq('funcion', d.funcion)
      .gt('inicio', new Date().toISOString()).order('inicio').limit(60)
    if (d.fechas.length) q = q.in('fecha', d.fechas)
    q.then(({ data }) => setLista(data || []))
  }, [d, cuenta.persona_id])

  return (
    <Hoja titulo="¿Qué turno ofreces?" icono="cambio" onCerrar={onCerrar}>
      {!lista && <Cargando filas={3} />}
      {lista && lista.length === 0 && (
        <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
          No tienes turnos compatibles{d.fechas.length ? ' en las fechas que pidió' : ''} (misma sección y función).
        </p>
      )}
      <div className="escalonado space-y-2">
        {lista?.map((t) => <TarjetaTurno key={t.id} t={t} conFecha onClick={() => onElegir(t)} />)}
      </div>
    </Hoja>
  )
}
