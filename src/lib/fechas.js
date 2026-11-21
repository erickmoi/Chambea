// Fechas y horas en hora de El Salvador (UTC-6 todo el año). Las fechas viajan como 'YYYY-MM-DD'.
const ZONA = 'America/El_Salvador'
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const dos = (n) => String(n).padStart(2, '0')

const aFecha = (iso) => new Date(`${iso}T12:00:00Z`) // mediodía UTC: el día nunca se corre
const aIso = (d) => `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`

export const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date())
export function sumarDias(iso, n) {
  const d = aFecha(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return aIso(d)
}
export const diaSemana = (iso) => aFecha(iso).getUTCDay() // 0 = domingo
export const inicioSemana = (iso) => sumarDias(iso, -((diaSemana(iso) + 6) % 7)) // lunes
export const inicioMes = (iso) => `${iso.slice(0, 8)}01`
export function finMes(iso) {
  const d = aFecha(inicioMes(iso))
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return aIso(d)
}
export function sumarMeses(iso, n) {
  const d = aFecha(inicioMes(iso))
  d.setUTCMonth(d.getUTCMonth() + n)
  return aIso(d)
}
export function rangoDias(desde, hasta) {
  const r = []
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) r.push(d)
  return r
}

export const diaCorto = (iso) => DIAS[diaSemana(iso)]
export const diaLargo = (iso) => DIAS_LARGOS[diaSemana(iso)]
export const numDia = (iso) => Number(iso.slice(8, 10))
export const mesCorto = (iso) => MESES[Number(iso.slice(5, 7)) - 1]
export const mesLargo = (iso) => MESES_LARGOS[Number(iso.slice(5, 7)) - 1]
export const fechaCorta = (iso) => `${diaCorto(iso)} ${numDia(iso)} ${mesCorto(iso)}` // lun 23 nov
export const fechaNumerica = (iso) => `${numDia(iso)}/${Number(iso.slice(5, 7))}`
export const tituloMes = (iso) => `${mesLargo(iso)} ${iso.slice(0, 4)}`

// '07:00–19:00' → '7 AM – 7 PM' · '18:00–06:00' → '6 PM – 6 AM' · '07:30–15:00' → '7:30 AM – 3 PM'
const partes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return { num: `${h % 12 === 0 ? 12 : h % 12}${m ? `:${dos(m)}` : ''}`, sufijo: h < 12 ? 'AM' : 'PM' }
}
// Formato de hora elegido en Ajustes: 12 h (7 AM) o 24 h (07:00)
let formato24 = (() => { try { return localStorage.getItem('chambea.hora24') === '1' } catch { return false } })()
export const usar24h = (si) => { formato24 = si; try { localStorage.setItem('chambea.hora24', si ? '1' : '0') } catch { /* nada */ } }
export const es24h = () => formato24
export const hora = (hhmm) => { if (formato24) return hhmm; const p = partes(hhmm); return `${p.num} ${p.sufijo}` }
export const horario = (etiqueta = '') => etiqueta.split(/[–-]/).map((x) => hora(x.trim())).join(' – ')
// Pausas: '13:30–14:30' → '1:30 – 2:30 PM' (el AM/PM una sola vez si es el mismo)
export function pausa(etiqueta) {
  if (!etiqueta) return ''
  if (formato24) return etiqueta.replace(/[–-]/, ' – ')
  const [a, b] = etiqueta.split(/[–-]/).map((x) => partes(x.trim()))
  return a.sufijo === b.sufijo ? `${a.num} – ${b.num} ${b.sufijo}` : `${a.num} ${a.sufijo} – ${b.num} ${b.sufijo}`
}
export const horas = (t) => Math.round((new Date(t.fin) - new Date(t.inicio)) / 36e5)
// Tipo de turno según horario:
//  · 'dia'    turnos largos de día (6 AM – 6 PM, 7 AM – 7 PM)
//  · 'noche'  turnos largos de noche (6 PM – 6 AM, 7 PM – 7 AM)
//  · 'tarde'  turnos cortos que empiezan después del mediodía (3 – 11 PM, 6 – 10 PM, 7 – 11 PM)
//  · 'manana' turnos cortos que empiezan en la mañana (7 AM – 3 PM)
export function tipoTurno(t) {
  const h = Number(t.etiqueta.slice(0, 2))
  const largo = (new Date(t.fin) - new Date(t.inicio)) / 36e5 >= 11
  if (largo) return h >= 5 && h < 12 ? 'dia' : 'noche'
  return h >= 12 || h < 4 ? 'tarde' : 'manana'
}
export const esNoche = (t) => tipoTurno(t) === 'noche'
export const esCorto = (t) => ['tarde', 'manana'].includes(tipoTurno(t))

// "en 2 días 5 h" · "en 3 h 20 min" · "en 12 min"
export function faltan(ms) {
  const min = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d) return `${d} ${d === 1 ? 'día' : 'días'}${h ? ` ${h} h` : ''}`
  if (h) return `${h} h${m ? ` ${m} min` : ''}`
  return `${m} min`
}

export function haceCuanto(ts) {
  const min = Math.round((Date.now() - new Date(ts)) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}
