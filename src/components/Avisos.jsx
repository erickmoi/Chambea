// Campanita de avisos: cuenta los no leídos y muestra la lista
import { useCallback, useEffect, useState } from 'react'
import Icono from './Icono'
import { Hoja, Cargando } from './ui'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/datos'
import { haceCuanto } from '../lib/fechas'

export function useAvisos(activo) {
  const [lista, setLista] = useState(null)
  const cargar = useCallback(async () => {
    if (!activo) return
    const { data } = await supabase.from('notificaciones').select('id, tipo, titulo, cuerpo, url, leida, creado')
      .order('creado', { ascending: false }).limit(40)
    if (data) setLista(data)
  }, [activo])
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 60_000)
    const alVolver = () => document.visibilityState === 'visible' && cargar()
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [cargar])
  return { lista, cargar, sinLeer: (lista || []).filter((n) => !n.leida).length }
}

export function BotonAvisos({ sinLeer, onClick }) {
  return (
    <button onClick={onClick} aria-label={`Avisos${sinLeer ? `, ${sinLeer} sin leer` : ''}`}
      className="relative rounded-full p-2 text-slate-600 transition active:scale-90 hover:bg-slate-100">
      <Icono n="notificaciones" size={24} />
      {sinLeer > 0 && (
        <span key={sinLeer} className="animar-pop absolute top-0.5 right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
          {sinLeer > 9 ? '9+' : sinLeer}
        </span>
      )}
    </button>
  )
}

export function HojaNotificaciones({ lista, onCerrar, onIr, recargar }) {
  useEffect(() => {
    if (lista?.some((n) => !n.leida)) rpc('marcar_leidas', { p_ids: null }).then(recargar, () => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Hoja titulo="Avisos" icono="notificaciones" onCerrar={onCerrar}>
      {!lista && <Cargando filas={3} />}
      {lista && lista.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Aquí te avisamos cuando alguien responda o te proponga un cambio.</p>}
      <ul className="escalonado divide-y divide-slate-100">
        {lista?.map((n) => (
          <li key={n.id}>
            <button onClick={() => onIr(n.url)} className="flex w-full items-start gap-3 py-3 text-left">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.leida ? 'bg-transparent' : 'bg-marca'}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{n.titulo}</span>
                {n.cuerpo && <span className="block text-sm text-slate-600">{n.cuerpo}</span>}
                <span className="block text-xs text-slate-400">{haceCuanto(n.creado)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Hoja>
  )
}
