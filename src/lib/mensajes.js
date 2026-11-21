// Mensajes de WhatsApp: cercanos, claros y con el enlace a Chambea
import { numDia, mesCorto, horario } from './fechas'
import { nombreBonito } from './datos'

const nombre = (n = '') => nombreBonito(n).split(' ')[0] || ''
const hola = (n) => (n ? `¡Hola, ${nombre(n)}! 👋 ¿Qué tal?` : '¡Hola! 👋 ¿Qué tal?')
const dia = (iso) => `${numDia(iso)} ${mesCorto(iso)}`
// "28 nov (7 PM – 7 AM)" · "28 nov (7 PM – 11 PM, Servicios Profesionales)"
export const turnoTexto = (t) => (t ? `${dia(t.fecha)} (${horario(t.etiqueta)}${t.seccion === 'sp' ? ', Servicios Profesionales' : ''})` : '')
const pie = (url) => (url ? `\n\nAquí lo puedes ver y responder con un toque en Chambea:\n${url}` : '')

// Le propongo a alguien: mi turno por el suyo
export const msgPropuesta = (persona, mio, suyo, url) =>
  `${hola(persona)}\n\nMe gustaría cambiar mi turno del ${turnoTexto(mio)} por tu turno del ${turnoTexto(suyo)}. ¿Puedes? 🙏${pie(url)}\n\n¡Gracias!`

// Recordatorio de una propuesta ya enviada
export const msgRecordatorio = (persona, url) =>
  `${hola(persona)}\n\nTe dejé una propuesta de cambio de turno en Chambea. ¿Le das una mirada cuando puedas? 🙏${pie(url)}`

// Escribo a quien publicó (permuta o donación)
export function msgAlAutor(persona, sol, url) {
  const t = turnoTexto(sol.turno)
  const cuerpo = sol.tipo === 'ceder'
    ? `Vi que donas tu turno del ${t}. ¡Me interesa! ¿Me lo das? 🙏`
    : `Vi tu permuta del ${t}. Tengo turno con el mismo horario y te lo puedo cambiar. ¿Te sirve?`
  return `${hola(persona)}\n\n${cuerpo}${pie(url)}`
}

// Respondo a quien se ofreció en mi solicitud
export const msgAlOferente = (persona, sol, oferta, url) =>
  `${hola(persona)}\n\nVi que te ofreciste para mi turno del ${turnoTexto(sol.turno)}${oferta?.turno ? ` a cambio de tu ${turnoTexto(oferta.turno)}` : ''}. ¡Gracias! ¿Lo confirmamos?${pie(url)}`

// Para compartir en el grupo
export function msgGrupo(tipo, t, fechas = [], url) {
  const cuerpo = tipo === 'ceder'
    ? `Dono mi turno del ${turnoTexto(t)} 🎁 ¿A alguien le sirve?`
    : `Busco permutar mi turno del ${turnoTexto(t)} 🔄${fechas.length ? `\nMe sirven: ${fechas.map(dia).join(', ')}.` : '\nPor otro con el mismo horario, la fecha que te quede mejor.'}`
  return `¡Hola, equipo! 👋\n\n${cuerpo}${pie(url)}\n\n¡Gracias!`
}

// Invitar a alguien a Chambea
export const msgInvitar = (persona, url) =>
  `${hola(persona)}\n\nYa estamos usando Chambea para las permutas de turno: ves tu horario, tus horas de comida y descanso, y cambias turnos sin perder nada en el chat. 🙌\n\nRegístrate aquí con tu nombre como sale en el horario:\n${url}`
