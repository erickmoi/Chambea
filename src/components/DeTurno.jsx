// ¿Quién está de turno? Lista del equipo para un día, por sección y día/noche
import { useEffect, useMemo, useState } from 'react'
import Icono from './Icono'
import { Hoja, Cargando } from './ui'
import { Segmentado, ChipFuncion, momento } from './turnos'
import { turnosDelDia, nombreBonito } from '../lib/datos'
import { fechaCorta, horario, sumarDias, hoy } from '../lib/fechas'

export default function DeTurno({ fecha: inicial = hoy(), miPersona, onCerrar }) {
  const [fecha, setFecha] = useState(inicial)
  const [lista, setLista] = useState(null)
  const [error, setError] = useState('')
  const [seccion, setSeccion] = useState('planilla')

  useEffect(() => {
    let vivo = true
    setLista(null)
    setError('')
    turnosDelDia(fecha).then((d) => vivo && setLista(d), (e) => vivo && setError(e.message))
    return () => { vivo = false }
  }, [fecha])

  const grupos = useMemo(() => {
    const deSeccion = (lista || []).filter((t) => t.seccion === seccion)
    const g = new Map()
    for (const t of deSeccion) {
      const k = `${t.fecha}|${t.etiqueta}`
      if (!g.has(k)) g.set(k, { t, personas: [] })
      g.get(k).personas.push(t)
    }
    return [...g.values()].sort((a, b) => new Date(a.t.inicio) - new Date(b.t.inicio))
  }, [lista, seccion])
  const cuenta = (s) => new Set((lista || []).filter((t) => t.seccion === s).map((t) => t.persona_id)).size

  return (
    <Hoja titulo="¿Quién está de turno?" icono="equipo" onCerrar={onCerrar}>
      <div className="mb-3 flex items-center gap-2">
        <button className="boton-icono btn-secundario" onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior"><Icono n="anterior" size={18} /></button>
        <p className="flex-1 text-center font-semibold capitalize text-slate-900" aria-live="polite">
          {fecha === hoy() ? 'Hoy · ' : fecha === sumarDias(hoy(), 1) ? 'Mañana · ' : ''}{fechaCorta(fecha)}
        </p>
        <button className="boton-icono btn-secundario" onClick={() => setFecha(sumarDias(fecha, 1))} aria-label="Día siguiente"><Icono n="siguiente" size={18} /></button>
      </div>
      <Segmentado etiqueta="Sección" valor={seccion} onCambio={setSeccion} opciones={[
        { id: 'planilla', texto: `Planilla${lista ? ` · ${cuenta('planilla')}` : ''}` },
        { id: 'sp', texto: `Servicios Profesionales${lista ? ` · ${cuenta('sp')}` : ''}` },
      ]} />

      <div className="mt-4">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!lista && !error && <Cargando filas={3} />}
        {lista && grupos.length === 0 && <p className="py-6 text-center text-sm text-slate-600">Nadie tiene turno de {seccion === 'sp' ? 'Servicios Profesionales' : 'planilla'} este día.</p>}
        <div className="escalonado space-y-4">
          {grupos.map(({ t, personas }) => {
            const m = momento(t)
            const deAyer = t.fecha !== fecha
            return (
              <section key={`${t.fecha}${t.etiqueta}`}>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <Icono n={m.icono} size={18} className={seccion === 'sp' ? 'text-sp' : 'text-planilla'} />
                  <span className="mono">{horario(t.etiqueta)}</span>
                  {deAyer && <span className="font-normal text-slate-500">· desde el {fechaCorta(t.fecha)}</span>}
                  <span className="ml-auto text-xs font-normal text-slate-500">{personas.length}</span>
                </h3>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-200">
                  {personas.map((p) => (
                    <li key={p.id} className={`flex items-center gap-2 px-3 py-2.5 ${p.persona_id === miPersona ? 'bg-marca-claro' : ''}`}>
                      <span className="min-w-0 flex-1 truncate text-slate-900">
                        {nombreBonito(p.persona?.nombre)}{p.persona_id === miPersona && <b className="text-marca-texto"> (tú)</b>}
                      </span>
                      <ChipFuncion funcion={p.funcion} />
                      {p.es_cambio && <Icono n="repetir" size={16} className="text-marca-texto" title="Cambio hecho en Chambea" />}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </Hoja>
  )
}
