// @ts-nocheck
// Recibe la hoja oficial desde el puente de Google Apps Script y la aplica en Chambea.
// Solo cambia lo necesario (pausas, turnos nuevos y quitados) con public.sincronizar_hoja.
// El lector de la hoja es el mismo de la app (src/lib/importador.js).
// deno-lint-ignore-file no-explicit-any
const ZONA = '-06:00' // El Salvador: UTC-6 todo el año (sin horario de verano)
const RE_TURNO = /(\d{1,2}):(\d{2})\s*(am|pm)\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)/i
const RE_REFERENCIAS = /REFERENCIAS|RERERENCIAS/i
// Textos que se sabe que NO son turno (no se avisan como "no reconocidos")
const RE_SIN_TURNO = /^(libre|vacaci[oó]n|permiso.*|incapacidad.*|-|)$/i
const ETIQUETAS_SP = new Set(['COMIDA', 'DESCANSO', 'TURNO NOCTURNO', 'TOTAL', 'MEDICO / FECHA'])

const texto = (v: any) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const dos = (n: any) => String(n).padStart(2, '0')

const normalizar = (s: any) =>
  texto(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

const esFecha = (v: any) => v instanceof Date && !Number.isNaN(v.getTime())
const isoFecha = (d: Date) => `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`

function sumarDia(iso: any) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return isoFecha(d)
}

// '07:00pm-07:00am' → { hi: '19:00', hf: '07:00' } · null si no es un horario
function leerHorario(valor: any) {
  const m = RE_TURNO.exec(texto(valor))
  if (!m) return null
  const h = (hh, mm, ap) => `${dos((Number(hh) % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0))}:${mm}`
  return { hi: h(m[1], m[2], m[3]), hf: h(m[4], m[5], m[6]) }
}

// '1:30 - 2:30 pm' → '13:30–14:30'. El AM/PM solo viene al final: se deduce el del inicio
// (la pausa más corta que tenga sentido, máximo 5 horas).
const RE_PAUSA = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)/i
function leerPausa(valor: any) {
  const m = RE_PAUSA.exec(texto(valor))
  if (!m) return null
  const fin = ((Number(m[3]) % 12) + (m[5].toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(m[4])
  const base = (Number(m[1]) % 12) * 60 + Number(m[2])
  let mejor = null
  for (const ini of [base, base + 720]) {
    const dur = (fin - ini + 1440) % 1440
    if (dur > 0 && dur <= 300 && (mejor == null || dur < mejor.dur)) mejor = { ini, dur }
  }
  if (!mejor) return null
  const hm = (min) => `${dos(Math.floor(min / 60) % 24)}:${dos(min % 60)}`
  return `${hm(mejor.ini)}–${hm(fin)}`
}

// Solo estas marcas se muestran (otras notas como SUPERVISOR o REFUERZO no)
const RE_OBSERVACION = /PERMUTA|PERMISO|CAMBIO DE TURNO|INCAPACIDAD|COMPENSATORIO/i
// Observación escrita en las filas de notas (PERMUTA, PERMISO PERSONAL…): no es pausa ni referencias
function leerObservacion(...celdas: any[]) {
  for (const c of celdas) {
    const t = texto(c)
    if (!t || leerPausa(t) || leerHorario(t) || !RE_OBSERVACION.test(t)) continue
    const s = t.slice(0, 40).toLowerCase()
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  return null
}
// Turno RECIBIDO por permuta: la hoja lo escribe 'P - 06:00am-06:00pm' (fondo gris). Sí se trabaja.
const RE_RECIBIDO = /^\s*P\s*[-–]/i
const conObs = (t: any, a: any, b: any, celda: any = null) =>
  ({ ...t, observacion: RE_RECIBIDO.test(texto(celda)) ? 'Permuta recibida' : leerObservacion(a, b) })

function armarTurno(nombre: any, fecha: any, horario: any, funcion: any, supervisor: any, comida: any = null, descanso: any = null) {
  const fechaFin = horario.hf <= horario.hi ? sumarDia(fecha) : fecha
  return {
    comida,
    descanso,
    nombre: texto(nombre),
    fecha,
    inicio: `${fecha}T${horario.hi}:00${ZONA}`,
    fin: `${fechaFin}T${horario.hf}:00${ZONA}`,
    funcion,
    etiqueta: `${horario.hi}–${horario.hf}`,
    supervisor,
  }
}

// Primera racha de columnas con fechas consecutivas (ignora columnas sueltas de otros meses)
function columnasDeFechas(fila: any[], desdeCol: number) {
  const cols: any[] = []
  for (let c = desdeCol; c < fila.length; c++) {
    const v = fila[c]
    if (!esFecha(v)) {
      if (cols.length) break
      continue
    }
    const iso = isoFecha(v)
    if (cols.length && iso !== sumarDia(cols[cols.length - 1].fecha)) break
    cols.push({ col: c, fecha: iso })
  }
  return cols
}

// ---------------------------------------------------------------- PLANILLA
// Formato completo: bloques de 3 filas (turno · nota 1 · nota 2), nombre en B y AREA en C.
// Formato simple (hoja de incidencias): GRUPOS | NOMBRE | fechas…, una fila por persona y sin notas.
function leerPlanilla(data: any[][]) {
  const filaFechas = data.findIndex((f) => columnasDeFechas(f, 2).length >= 7)
  if (filaFechas < 0) throw new Error('No encontré la fila de fechas en la hoja de planilla.')
  const dias = columnasDeFechas(data[filaFechas], 2)
  const simple = dias[0].col === 2
  const turnos: any[] = []
  const raros: any[] = []
  for (let i = filaFechas + 1; i < data.length; i++) {
    const f = data[i]
    const nombre = texto(f[1])
    if (!nombre || leerHorario(nombre)) continue
    const area = simple ? 'TRIAJE' : normalizar(f[2])
    if (!area || leerHorario(area)) continue
    const supervisor = area === 'SUPERVISOR'
    for (const { col, fecha } of dias) {
      const horario = leerHorario(f[col])
      if (!horario) {
        if (!RE_SIN_TURNO.test(texto(f[col]))) raros.push({ nombre, fecha, valor: texto(f[col]) })
        continue
      }
      if (simple) {
        // Sin notas: la función (supervisor) la decide la base según la persona
        turnos.push(conObs(armarTurno(nombre, fecha, horario, 'triaje', false), null, null, f[col]))
        continue
      }
      const notas = `${texto(data[i + 1]?.[col])} ${texto(data[i + 2]?.[col])}`
      const funcion = supervisor ? 'supervisor' : RE_REFERENCIAS.test(notas) ? 'referencias' : 'triaje'
      turnos.push(conObs(armarTurno(nombre, fecha, horario, funcion, supervisor,
        leerPausa(data[i + 1]?.[col]), leerPausa(data[i + 2]?.[col])), data[i + 1]?.[col], data[i + 2]?.[col], f[col]))
    }
  }
  return { turnos, raros, dias: dias.map((d) => d.fecha) }
}

// ---------------------------------------------------------------- SP
// Por persona: fila diurna (+COMIDA, DESCANSO) y opcional TURNO NOCTURNO (+COMIDA, DESCANSO).
function leerSP(data: any[][]) {
  const filaFechas = data.findIndex((f) => columnasDeFechas(f, 1).length >= 7)
  if (filaFechas < 0) throw new Error('No encontré la fila de fechas en la hoja de SP.')
  const dias = columnasDeFechas(data[filaFechas], 1)
  const turnos: any[] = []
  const raros: any[] = []
  const etiqueta = (i: number) => normalizar(data[i]?.[0])
  for (let i = filaFechas + 1; i < data.length; i++) {
    const nombre = texto(data[i][0])
    const n = normalizar(nombre)
    if (!nombre || ETIQUETAS_SP.has(n) || leerHorario(nombre)) continue
    if (etiqueta(i + 1) !== 'COMIDA') continue // un nombre siempre va seguido de COMIDA
    const filas = [i]
    if (etiqueta(i + 3) === 'TURNO NOCTURNO') filas.push(i + 3)
    for (const r of filas) {
      for (const { col, fecha } of dias) {
        const v = data[r][col]
        const horario = leerHorario(v)
        if (!horario) {
          if (!RE_SIN_TURNO.test(texto(v))) raros.push({ nombre, fecha, valor: texto(v) })
          continue
        }
        const notas = `${texto(data[r + 1]?.[col])} ${texto(data[r + 2]?.[col])}`
        turnos.push(conObs(armarTurno(nombre, fecha, horario, RE_REFERENCIAS.test(notas) ? 'referencias' : 'general', false,
          leerPausa(data[r + 1]?.[col]), leerPausa(data[r + 2]?.[col])), data[r + 1]?.[col], data[r + 2]?.[col], v))
      }
    }
  }
  return { turnos, raros, dias: dias.map((d) => d.fecha) }
}

// ¿Qué tipo de hoja es? Por nombre y, si no, por estructura.
function tipoDeHoja(nombreHoja: string, data: any[][]) {
  const n = normalizar(nombreHoja)
  if (/PLANILLA/.test(n)) return 'planilla'
  if (/\bSP\b|SERVICIOS/.test(n)) return 'sp'
  const cabecera = data.slice(0, 6).map((f) => f.map(normalizar).join('|')).join('|')
  if (/MEDICO \/ FECHA/.test(cabecera)) return 'sp'
  if (/NOMBRE/.test(cabecera) && /AREA/.test(cabecera)) return 'planilla'
  if (/GRUPOS/.test(cabecera) && /NOMBRE/.test(cabecera)) return 'planilla' // hoja de incidencias
  return null
}

function resumir(turnos: any[]) {
  const porFuncion = {}
  for (const t of turnos) porFuncion[t.funcion] = (porFuncion[t.funcion] || 0) + 1
  return { turnos: turnos.length, personas: new Set(turnos.map((t) => normalizar(t.nombre))).size, porFuncion }
}


// Las fechas llegan como 'D:2026-11-01' desde Apps Script
const celda = (v: any) => (typeof v === 'string' && /^D:\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v.slice(2)}T00:00:00Z`) : v)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Usa POST', { status: 405 })
  let cuerpo: any
  try { cuerpo = await req.json() } catch { return Response.json({ ok: false, error: 'JSON no válido' }, { status: 400 }) }
  const secciones: any[] = []
  const ignoradas: string[] = []
  for (const h of cuerpo.hojas ?? []) {
    const data = (h.filas ?? []).map((f: any[]) => f.map(celda))
    const seccion = tipoDeHoja(h.nombre ?? '', data)
    if (!seccion) { ignoradas.push(h.nombre); continue }
    try {
      const r = seccion === 'planilla' ? leerPlanilla(data) : leerSP(data)
      if (!r.turnos.length) { ignoradas.push(h.nombre); continue }
      secciones.push({ seccion, hoja: h.nombre, desde: r.dias[0], hasta: r.dias[r.dias.length - 1], turnos: r.turnos })
    } catch (e) {
      ignoradas.push(`${h.nombre} (${(e as Error).message})`)
    }
  }
  if (!secciones.length) return Response.json({ ok: false, error: 'No encontré hojas de PLANILLA ni de SP', ignoradas }, { status: 400 })

  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/sincronizar_hoja`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: cuerpo.token ?? '', p_secciones: secciones }),
  })
  const res = await r.json()
  if (!r.ok) return Response.json({ ok: false, error: res?.message ?? 'Error al aplicar', ignoradas }, { status: r.status })
  return Response.json({ ...res, ignoradas })
})
