// Piezas visuales de turnos que se repiten en varias pantallas
import Icono from './Icono'
import { Hoja } from './ui'
import { SECCION, FUNCION, textoAviso } from '../lib/datos'
import { horario, fechaCorta, horas, pausa, tipoTurno, nombreComida } from '../lib/fechas'

export function ChipSeccion({ seccion, className = '' }) {
  const color = seccion === 'sp' ? 'bg-sp-claro text-sp' : 'bg-planilla-claro text-planilla'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color} ${className}`}>{SECCION[seccion]}</span>
}

export function ChipFuncion({ funcion }) {
  if (funcion === 'triaje' || funcion === 'general') return null
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{FUNCION[funcion]}</span>
}

// Día, noche, tarde o mañana: dicho con ícono y palabra (no solo con color)
export const MOMENTOS = {
  dia: { icono: 'sol', texto: 'Día', corto: false },
  noche: { icono: 'luna', texto: 'Noche', corto: false },
  tarde: { icono: 'tarde', texto: 'Tarde', corto: true },
  manana: { icono: 'manana', texto: 'Mañana', corto: true },
}
export const momento = (t) => ({ id: tipoTurno(t), ...MOMENTOS[tipoTurno(t)] })
export const letraSeccion = (seccion) => (seccion === 'sp' ? 'SP' : 'P')

// Pausas del turno: comida y descanso
export function Pausas({ t, className = '' }) {
  if (!t.comida && !t.descanso) return null
  return (
    <span className={`flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 ${className}`}>
      {t.comida && <span className="flex items-center gap-1"><Icono n="comida" size={14} />{nombreComida(t)} <b className="mono font-semibold">{pausa(t.comida)}</b></span>}
      {t.descanso && <span className="flex items-center gap-1"><Icono n="cafe" size={14} />Descanso <b className="mono font-semibold">{pausa(t.descanso)}</b></span>}
    </span>
  )
}

// Tarjeta "boleto": talón con día/noche y P/S, hora grande, sección, función y si viene de un cambio
// Observación que viene escrita en la hoja debajo del horario (Permuta, Permiso personal…)
export function ChipObservacion({ texto, chico = false }) {
  if (!texto) return null
  const permiso = /permiso|incapacidad/i.test(texto)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${chico ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs'} ${permiso ? 'bg-violet-100 text-violet-800' : 'bg-amber-100 text-amber-900'}`}>
      <Icono n={permiso ? 'historial' : 'cambio'} size={chico ? 11 : 13} />{texto}
    </span>
  )
}

export function TarjetaTurno({ t, onClick, extra, conFecha = false, publicado = false, conPausas = false }) {
  const Tag = onClick ? 'button' : 'div'
  const m = momento(t)
  const sp = t.seccion === 'sp'
  return (
    <Tag onClick={onClick}
      aria-label={onClick ? `${conFecha ? fechaCorta(t.fecha) + ', ' : ''}${horario(t.etiqueta)}, ${SECCION[t.seccion]}, ${m.texto}${t.observacion ? ', ' + t.observacion : ''}` : undefined}
      className={`boleto flex w-full items-stretch text-left transition ${onClick ? 'active:scale-[0.98] hover:ring-slate-300' : ''}`}>
      <span className={`boleto-talon flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 ${sp ? 'bg-sp-claro text-sp' : 'bg-planilla-claro text-planilla'} ${m.corto ? 'talon-corto' : ''}`}>
        <Icono n={m.icono} size={22} />
        <span className="text-[11px] font-bold leading-none">{letraSeccion(t.seccion)}</span>
      </span>
      <span className="min-w-0 flex-1 py-2.5 pr-3 pl-4">
        {conFecha && <span className="block text-xs font-semibold capitalize text-slate-600">{fechaCorta(t.fecha)}</span>}
        <span className="mono block text-lg font-semibold leading-tight text-slate-900">{horario(t.etiqueta)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <ChipSeccion seccion={t.seccion} />
          <ChipFuncion funcion={t.funcion} />
          <ChipObservacion texto={t.observacion} />
          <span className="text-xs text-slate-600">{horas(t)} h · {m.texto.toLowerCase()}</span>
          {publicado && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">En Permutas</span>}
        </span>
        {conPausas && <Pausas t={t} className="mt-1.5" />}
      </span>
      {(t.es_cambio || extra) && (
        <span className="flex items-center gap-2 pr-3">
          {t.es_cambio && <span title="Cambio hecho en Chambea" className="text-marca-texto"><Icono n="repetir" size={20} /><span className="sr-only">Cambio hecho en Chambea</span></span>}
          {extra}
        </span>
      )}
    </Tag>
  )
}

export function ListaAvisos({ avisos, className = '' }) {
  if (!avisos?.length) return null
  return (
    <ul className={`space-y-1 text-sm text-amber-800 ${className}`}>
      {avisos.map((a, i) => (
        <li key={i} className="flex items-start gap-1.5"><Icono n="alerta" size={16} className="mt-0.5" />{textoAviso(a)}</li>
      ))}
    </ul>
  )
}

// Antes de seguir: muestra los avisos y pide "Entiendo, continuar"
export function HojaAvisos({ avisos, onCancelar, onContinuar, enviando }) {
  return (
    <Hoja titulo="Antes de seguir" icono="alerta" onCerrar={onCancelar}>
      <p className="mb-3 text-sm text-slate-600">Revisa esto. Puedes continuar si ya lo tienes resuelto.</p>
      <ListaAvisos avisos={avisos} className="rounded-xl bg-amber-50 p-3" />
      <div className="mt-5 flex gap-2">
        <button className="btn-secundario flex-1" onClick={onCancelar}>Volver</button>
        <button className="btn-primario flex-1" disabled={enviando} onClick={onContinuar}>Entiendo, continuar</button>
      </div>
    </Hoja>
  )
}

// Selector segmentado con animación de la opción activa
export function Segmentado({ opciones, valor, onCambio, className = '', etiqueta, compacto = false }) {
  return (
    <div role="group" aria-label={etiqueta} className={`grid rounded-xl bg-slate-100 font-semibold ${compacto ? 'p-0.5 text-xs' : 'p-1 text-sm'} ${className}`}
      style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}>
      {opciones.map((o) => (
        <button key={o.id} type="button" onClick={() => onCambio(o.id)} aria-pressed={valor === o.id} aria-label={o.etiqueta} title={o.etiqueta}
          className={`relative flex items-center justify-center gap-1.5 rounded-lg text-center leading-tight transition-all duration-200 ${compacto ? 'min-h-8 px-2 py-1' : 'min-h-10 px-1 py-1.5'} ${valor === o.id ? 'bg-superficie text-marca-texto shadow' : 'text-slate-600'}`}>
          {o.icono && <Icono n={o.icono} size={compacto ? 16 : 17} />}{o.texto}
          {o.cuenta > 0 && <span className="ml-0.5 rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-4 text-white">{o.cuenta}</span>}
        </button>
      ))}
    </div>
  )
}
