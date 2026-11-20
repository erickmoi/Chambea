// Piezas visuales de turnos que se repiten en varias pantallas
import Icono from './Icono'
import { Hoja } from './ui'
import { SECCION, FUNCION, textoAviso } from '../lib/datos'
import { horario, fechaCorta, horas } from '../lib/fechas'

export function ChipSeccion({ seccion, className = '' }) {
  const color = seccion === 'sp' ? 'bg-sp-claro text-sp' : 'bg-planilla-claro text-planilla'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color} ${className}`}>{SECCION[seccion]}</span>
}

export function ChipFuncion({ funcion }) {
  if (funcion === 'triaje' || funcion === 'general') return null
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{FUNCION[funcion]}</span>
}

// Tarjeta de turno: hora grande, sección, función y marca 🔁
export function TarjetaTurno({ t, onClick, extra, conFecha = false, publicado = false }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl bg-superficie p-3 text-left ring-1 ring-slate-200 transition ${onClick ? 'active:scale-[0.98] hover:ring-slate-300' : ''}`}>
      <span className={`h-10 w-1.5 shrink-0 rounded-full ${t.seccion === 'sp' ? 'bg-sp' : 'bg-planilla'}`} />
      <span className="min-w-0 flex-1">
        {conFecha && <span className="block text-xs font-medium text-slate-500">{fechaCorta(t.fecha)}</span>}
        <span className="mono block text-lg font-semibold leading-tight text-slate-900">{horario(t.etiqueta)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <ChipSeccion seccion={t.seccion} />
          <ChipFuncion funcion={t.funcion} />
          <span className="text-xs text-slate-500">{horas(t)} h</span>
          {publicado && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">En la bolsa</span>}
        </span>
      </span>
      {t.es_cambio && <span title="Cambio hecho en Chambea" className="text-lg">🔁</span>}
      {extra}
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
export function Segmentado({ opciones, valor, onCambio, className = '' }) {
  return (
    <div className={`grid rounded-xl bg-slate-100 p-1 text-sm font-semibold ${className}`}
      style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}>
      {opciones.map((o) => (
        <button key={o.id} type="button" onClick={() => onCambio(o.id)}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 transition-all duration-200 ${valor === o.id ? 'bg-superficie text-marca-texto shadow' : 'text-slate-500'}`}>
          {o.icono && <Icono n={o.icono} size={17} />}{o.texto}
        </button>
      ))}
    </div>
  )
}
