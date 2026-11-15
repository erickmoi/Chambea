// Admin → Cargar horario
// 1) Elegir el .xlsx · 2) Revisar cada sección (rango, nombres, avisos) · 3) Cargar
import { useCallback, useRef, useState } from 'react'
import { supabase, mensajeError } from '../../lib/supabase'
import { leerHorarios, recortar, rangosSugeridos, normalizar } from '../../lib/importador'
import Icono from '../../components/Icono'
import { Aviso, Cargando } from '../../components/ui'

const NOMBRE_SECCION = { planilla: 'Planilla', sp: 'Servicios profesionales' }
const NOMBRE_FUNCION = { triaje: 'Triaje', referencias: 'Referencias', supervisor: 'Supervisor', general: 'General' }

const fechaCorta = (iso) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

export default function Importar() {
  const [archivo, setArchivo] = useState(null)
  const [secciones, setSecciones] = useState([]) // [{ base, rango, incluir, nombres, cambios, conservar }]
  const [leyendo, setLeyendo] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [resultados, setResultados] = useState(null)
  const [aviso, setAviso] = useState(null)
  const input = useRef(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])

  // Revisión en la base: cómo se enlaza cada nombre y cuántos 🔁 hay en el rango
  const revisar = async (sec) => {
    const nombres = [...new Set(sec.turnos.map((t) => t.nombre))]
    const [{ data: n, error: e1 }, { count, error: e2 }] = await Promise.all([
      supabase.rpc('revisar_nombres', { p_nombres: nombres }),
      supabase.from('turnos').select('id', { count: 'exact', head: true })
        .eq('seccion', sec.seccion).eq('es_cambio', true).gte('fecha', sec.desde).lte('fecha', sec.hasta),
    ])
    if (e1 || e2) throw e1 || e2
    return { nombres: n || [], cambios: count || 0 }
  }

  const elegirArchivo = async (f) => {
    if (!f) return
    setArchivo(f)
    setResultados(null)
    setSecciones([])
    setLeyendo(true)
    try {
      const leidas = await leerHorarios(f)
      const listas = await Promise.all(leidas.map(async (base) => {
        const rango = 'todo'
        return { base, rango, incluir: true, conservar: true, ...(await revisar(base)) }
      }))
      setSecciones(listas)
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeError(e) })
      setArchivo(null)
    } finally {
      setLeyendo(false)
      if (input.current) input.current.value = ''
    }
  }

  const actualizar = (i, cambios) => setSecciones((s) => s.map((x, j) => (j === i ? { ...x, ...cambios } : x)))

  const cambiarRango = async (i, r) => {
    const sec = secciones[i]
    actualizar(i, { rango: r.id })
    try {
      const { cambios } = await revisar(recortar(sec.base, r.desde, r.hasta))
      actualizar(i, { cambios })
    } catch { /* el conteo es informativo */ }
  }

  const cargar = async () => {
    const elegidas = secciones.filter((s) => s.incluir)
    if (!elegidas.length) return
    setCargando(true)
    const res = []
    try {
      for (const s of elegidas) {
        const r = rangosSugeridos(s.base.desde, s.base.hasta).find((x) => x.id === s.rango)
        const sec = recortar(s.base, r.desde, r.hasta)
        const { data, error } = await supabase.rpc('importar_turnos', {
          p_seccion: sec.seccion,
          p_desde: sec.desde,
          p_hasta: sec.hasta,
          p_archivo: archivo?.name ?? null,
          p_filas: sec.turnos,
          p_conservar_cambios: s.conservar,
        })
        if (error) throw error
        res.push({ seccion: sec.seccion, desde: sec.desde, hasta: sec.hasta, ...data })
      }
      setResultados(res)
      setSecciones([])
      setArchivo(null)
      setAviso({ tipo: 'ok', texto: 'Horario cargado ✅' })
    } catch (e) {
      if (res.length) setResultados(res)
      setAviso({ tipo: 'error', texto: mensajeError(e) })
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Icono n="excel" size={26} className="text-marca-texto" /> Cargar horario
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Descarga la hoja oficial como .xlsx (Archivo → Descargar → Microsoft Excel) y súbela aquí.
          Solo se reemplazan las fechas y la sección que elijas.
        </p>
      </header>

      <label className={`tarjeta flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed border-slate-300 py-8 text-center transition hover:border-marca ${leyendo || cargando ? 'pointer-events-none opacity-60' : ''}`}>
        <Icono n="subir" size={36} className="text-marca-texto" />
        <span className="font-semibold text-slate-800">{archivo ? archivo.name : 'Elegir archivo .xlsx'}</span>
        <span className="text-sm text-slate-500">Puede traer la hoja de planilla, la de SP o las dos</span>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only" onChange={(e) => elegirArchivo(e.target.files?.[0])} />
      </label>

      {leyendo && <Cargando filas={2} />}

      <div className="escalonado space-y-4">
        {secciones.map((s, i) => (
          <TarjetaSeccion key={s.base.seccion + s.base.hoja} s={s}
            onIncluir={(v) => actualizar(i, { incluir: v })}
            onRango={(r) => cambiarRango(i, r)}
            onConservar={(v) => actualizar(i, { conservar: v })} />
        ))}
      </div>

      {secciones.length > 0 && (
        <button className="btn-primario w-full py-3 text-base" disabled={cargando || !secciones.some((s) => s.incluir)} onClick={cargar}>
          {cargando ? 'Cargando…' : `Cargar ${secciones.filter((s) => s.incluir).map((s) => NOMBRE_SECCION[s.base.seccion]).join(' y ')}`}
        </button>
      )}

      {resultados && <Resultados lista={resultados} />}
    </div>
  )
}

function TarjetaSeccion({ s, onIncluir, onRango, onConservar }) {
  const rangos = rangosSugeridos(s.base.desde, s.base.hasta)
  const rango = rangos.find((r) => r.id === s.rango)
  const sec = recortar(s.base, rango.desde, rango.hasta)
  const nombresEnRango = new Set(sec.turnos.map((t) => normalizar(t.nombre)))
  const nombres = s.nombres.filter((n) => nombresEnRango.has(normalizar(n.nombre)))
  const nuevas = nombres.filter((n) => n.via === 'nueva')
  const parecidos = nombres.filter((n) => n.via === 'parecido' || n.via === 'alias')

  return (
    <section className={`tarjeta space-y-4 ${s.incluir ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{NOMBRE_SECCION[s.base.seccion]}</h2>
          <p className="text-sm text-slate-500">Hoja «{s.base.hoja}» · {fechaCorta(s.base.desde)} al {fechaCorta(s.base.hasta)}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-marca)]" checked={s.incluir} onChange={(e) => onIncluir(e.target.checked)} />
          Cargar
        </label>
      </div>

      {rangos.length > 1 && (
        <div>
          <span className="etiqueta flex items-center gap-1"><Icono n="calendario" size={16} /> Fechas a reemplazar</span>
          <div className="fila-lateral flex gap-2">
            {rangos.map((r) => (
              <button key={r.id} type="button" onClick={() => onRango(r)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${r.id === s.rango ? 'bg-marca text-sobre-marca' : 'bg-slate-100 text-slate-700'}`}>
                {r.texto} <span className="opacity-75">({fechaCorta(r.desde)}–{fechaCorta(r.hasta)})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Dato valor={sec.resumen.turnos} texto="turnos" />
        <Dato valor={sec.resumen.personas} texto="personas" />
        {Object.entries(sec.resumen.porFuncion).map(([f, n]) => <Dato key={f} valor={n} texto={NOMBRE_FUNCION[f]} />)}
      </div>

      {parecidos.length > 0 && (
        <Bloque color="sky" icono="enlace" titulo={`${parecidos.length} nombre(s) escritos distinto: se toman como la misma persona`}>
          {parecidos.map((n) => <li key={n.nombre}>{n.nombre} → <b>{n.persona}</b></li>)}
        </Bloque>
      )}
      {nuevas.length > 0 && (
        <Bloque color="amber" icono="usuarios" titulo={`${nuevas.length} persona(s) nueva(s) en el sistema`}>
          {nuevas.map((n) => <li key={n.nombre}>{n.nombre}</li>)}
        </Bloque>
      )}
      {s.base.raros.length > 0 && (
        <Bloque color="red" icono="alerta" titulo={`${s.base.raros.length} celda(s) que no parecen horario (se ignoran)`}>
          {s.base.raros.slice(0, 8).map((r, i) => <li key={i}>{r.nombre} · {fechaCorta(r.fecha)}: «{r.valor}»</li>)}
          {s.base.raros.length > 8 && <li>…y {s.base.raros.length - 8} más</li>}
        </Bloque>
      )}
      {s.cambios > 0 && (
        <div className="rounded-xl bg-slate-100 p-3">
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--color-marca)]" checked={s.conservar} onChange={(e) => onConservar(e.target.checked)} />
            <span>
              <b>Conservar los {s.cambios} cambio(s) 🔁</b> hechos en la app en estas fechas.
              <span className="block text-slate-500">Desmárcalo si la hoja nueva ya trae esos cambios o si se anularon.</span>
            </span>
          </label>
        </div>
      )}
    </section>
  )
}

function Dato({ valor, texto }) {
  return (
    <div className="rounded-xl bg-slate-100 px-2 py-2">
      <div className="text-xl font-bold tabular-nums text-slate-900">{valor}</div>
      <div className="text-xs text-slate-500">{texto}</div>
    </div>
  )
}

const COLORES = {
  sky: 'bg-sky-50 text-sky-900 ring-sky-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
}
function Bloque({ color, icono, titulo, children }) {
  return (
    <details className={`rounded-xl p-3 text-sm ring-1 ${COLORES[color]}`}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold">
        <Icono n={icono} size={18} /> {titulo}
      </summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-6">{children}</ul>
    </details>
  )
}

function Resultados({ lista }) {
  return (
    <section className="tarjeta animar-entrada space-y-3">
      <h2 className="flex items-center gap-2 font-bold text-slate-900"><Icono n="ok" size={22} className="text-emerald-700" /> Resultado</h2>
      {lista.map((r) => (
        <div key={r.seccion} className="text-sm text-slate-700">
          <p className="font-semibold">{NOMBRE_SECCION[r.seccion]} · {fechaCorta(r.desde)} al {fechaCorta(r.hasta)}</p>
          <ul className="mt-1 list-disc pl-6">
            <li>{r.insertados} turnos cargados ({r.reemplazados} reemplazados)</li>
            {r.omitidos > 0 && <li>{r.omitidos} omitidos (ya estaban como cambio 🔁 o repetidos)</li>}
            {r.personas_nuevas?.length > 0 && <li>{r.personas_nuevas.length} persona(s) nueva(s)</li>}
            {r.enlazados_por_parecido?.length > 0 && <li>{r.enlazados_por_parecido.length} nombre(s) enlazados por parecido</li>}
            {r.solicitudes_canceladas > 0 && <li>{r.solicitudes_canceladas} solicitud(es) canceladas porque su turno cambió</li>}
          </ul>
        </div>
      ))}
    </section>
  )
}
