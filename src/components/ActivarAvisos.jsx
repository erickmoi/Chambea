// Activar avisos en el celular: explica para qué sirven y qué se necesita (iPhone: instalar primero)
import { useEffect, useState } from 'react'
import Icono from './Icono'
import { pushSoportado, necesitaInstalar, estadoPush, activarPush, probarPush } from '../lib/push'

export function useEstadoAvisos() {
  const [estado, setEstado] = useState('cargando')
  useEffect(() => { estadoPush().then(setEstado, () => setEstado('no-soportado')) }, [])
  return [estado, setEstado]
}

const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

export default function ActivarAvisos({ compacto = false, onListo, avisar }) {
  const [estado, setEstado] = useEstadoAvisos()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  const activar = async () => {
    setOcupado(true)
    setError('')
    try {
      await activarPush()
      setEstado('activo')
      await probarPush().catch(() => {})
      avisar?.('Avisos activados. Te mandamos uno de prueba.')
      onListo?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado(false)
    }
  }

  if (estado === 'activo') {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
        <Icono n="ok" size={20} />Los avisos ya están activos en este celular.
      </p>
    )
  }

  const instalarPrimero = necesitaInstalar()
  return (
    <div className="space-y-3">
      {!compacto && (
        <ul className="space-y-2 text-sm text-slate-700">
          <li className="flex gap-2"><Icono n="huella" size={18} className="mt-px shrink-0 text-marca-texto" /><span>Recordatorio para <b>marcar tu entrada en GeoVictoria</b> antes de cada turno de planilla.</span></li>
          <li className="flex gap-2"><Icono n="comida" size={18} className="mt-px shrink-0 text-marca-texto" /><span>Al empezar tu turno: tu hora de <b>almuerzo o cena</b> y de <b>descanso</b>.</span></li>
          <li className="flex gap-2"><Icono n="cambio" size={18} className="mt-px shrink-0 text-marca-texto" /><span>Cuando te propongan una permuta o respondan la tuya.</span></li>
        </ul>
      )}

      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
        <p className="mb-1.5 font-semibold text-slate-900">Qué se necesita</p>
        {esIOS() ? (
          <ol className="list-decimal space-y-1 pl-5">
            <li className={instalarPrimero ? 'font-semibold text-slate-900' : 'text-slate-500 line-through'}>
              En Safari toca <b>Compartir</b> <Icono n="compartir" size={14} className="inline-block align-text-bottom" /> y luego <b>Agregar a inicio</b>.
            </li>
            <li className={instalarPrimero ? '' : 'text-slate-500 line-through'}>Abre Chambea desde ese ícono (no desde Safari).</li>
            <li className={instalarPrimero ? '' : 'font-semibold text-slate-900'}>Toca <b>Activar avisos</b> y elige <b>Permitir</b>.</li>
            <li>Que el modo <b>No molestar</b> o <b>Concentración</b> no los bloquee.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-1 pl-5">
            <li>Toca <b>Activar avisos</b> y elige <b>Permitir</b>.</li>
            <li>Mejor si instalas la app (menú ⋮ → <b>Instalar app</b>).</li>
            <li>No cierres sesión en este celular, ahí es donde te llegan.</li>
          </ol>
        )}
      </div>

      {estado === 'bloqueado' && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Los bloqueaste antes. Actívalos en los ajustes del celular → Notificaciones → Chambea (o del navegador para este sitio).</p>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!pushSoportado() && !instalarPrimero && (
        <p className="text-sm text-slate-600">Este navegador no permite avisos. Prueba con Chrome (Android) o con la app instalada (iPhone).</p>
      )}
      {pushSoportado() && !instalarPrimero && estado !== 'bloqueado' && (
        <button data-autofoco className="btn-primario flex w-full items-center justify-center gap-2 py-3" disabled={ocupado || estado === 'cargando'} onClick={activar}>
          <Icono n="notificaciones" size={20} />{ocupado ? 'Activando…' : 'Activar avisos'}
        </button>
      )}
    </div>
  )
}
