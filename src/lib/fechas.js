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

// '07:00–19:00' → '7A–7P' · '18:00–06:00' → '6P–6A' · '07:30–15:00' → '7:30A–3P'
function horaCorta(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const sufijo = h < 12 ? 'A' : 'P'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${dos(m)}` : ''}${sufijo}`
}
export const horario = (etiqueta = '') => etiqueta.split(/[–-]/).map((x) => horaCorta(x.trim())).join('–')
export const horas = (t) => Math.round((new Date(t.fin) - new Date(t.inicio)) / 36e5)
export const esNoche = (t) => Number(t.etiqueta.slice(0, 2)) >= 15

export function haceCuanto(ts) {
  const min = Math.round((Date.now() - new Date(ts)) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}
