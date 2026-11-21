// Campanita de avisos: cuenta los no leídos y muestra la lista
import { useCallback, useEffect, useState } from 'react'
import Icono from './Icono'
import { Hoja, Cargando } from './ui'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/datos'
import { haceCuanto } from '../lib/fechas'

export function useAvisos(activo, alNuevo) {
  const [lista, setLista] = useState(null)
  const cargar = useCallback(async () => {
    if (!activo) return
    const { data } = await supabase.from('notificaciones').select('id, tipo, titulo, cuerpo, url, leida, creado')
      .order('creado', { ascending: false }).limit(40)
    if (data) setLista(data)
  }, [activo])
  useEffect(() => {
    cargar()
    if (!activo) return
    // Tiempo real: cuando llega un aviso nuevo se actualiza al instante (y cada 2 min por si acaso)
    const canal = supabase.channel('mis-avisos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, () => {
        cargar()
        alNuevo?.current?.()
      })
      .subscribe()
    const t = setInterval(cargar, 120_000)
    const alVolver = () => document.visibilityState === 'visible' && cargar()
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); supabase.removeChannel(canal) }
  }, [cargar, activo, alNuevo])
  return { lista, cargar, sinLeer: (lista || []).filter((n) => !n.leida).length }
}

const ICONO_TIPO = {
  marcaje: 'huella', horario_cambiado: 'calendario', solicitud_cancelada: 'cancelar', cambio_aplicado: 'repetir', cambio_deshecho: 'historial',
  eleccion_declinada: 'cancelar', nueva_oferta: 'hola', nueva_solicitud: 'trato', oferta_retirada: 'cancelar', propuesta: 'proponer',
  propuesta_rechazada: 'cancelar', te_eligieron: 'ok',
}

export function BotonAvisos({ sinLeer, onClick }) {
  return (
    <button onClick={onClick} aria-label={`Avisos${sinLeer ? `, ${sinLeer} sin leer` : ''}`}
      className="boton-icono relative text-slate-700">
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
              <Icono n={ICONO_TIPO[n.tipo] || 'notificaciones'} size={22} className={`mt-0.5 ${n.leida ? 'text-slate-400' : 'text-marca-texto'}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{n.titulo.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '')}{!n.leida && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-marca align-middle" aria-label="nuevo" />}</span>
                {n.cuerpo && <span className="block text-sm text-slate-600">{n.cuerpo}</span>}
                <span className="block text-xs text-slate-500">{haceCuanto(n.creado)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Hoja>
  )
}
