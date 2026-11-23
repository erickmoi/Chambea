// Versión visible en Ajustes y notas de "Novedades" (se muestran una vez por versión)
export const VERSION = '0.6.6'

export const NOVEDADES = [
  {
    version: '0.6.6',
    titulo: 'Avisos de entrada y salida',
    puntos: [
      'Planilla: te recordamos marcar la entrada y también la salida en GeoVictoria.',
      'Servicios Profesionales: te recordamos firmar la hoja de asistencia al entrar.',
      '“¿Quién está de turno?” más compacto y sin las noches del día anterior después de las 5 AM.',
      'Arreglos: la confirmación ya no queda detrás de otras ventanas y la barra inferior ya no se mueve.',
    ],
  },
  {
    version: '0.6.5',
    titulo: 'Horario siempre al día',
    puntos: [
      'Chambea se sincroniza cada hora con la hoja oficial de horarios.',
      'Si cambia tu almuerzo, cena o descanso, te llega un aviso.',
      'Si cambia tu horario, también te avisamos. Las permutas hechas en Chambea se conservan.',
    ],
  },
  {
    version: '0.6.4',
    titulo: 'Avisos al empezar tu turno',
    puntos: [
      'Al empezar tu turno te avisamos tu hora de almuerzo o cena y de descanso.',
      'Te guiamos para activar los avisos (en iPhone, primero agrega la app a la pantalla de inicio).',
      'Vista Mes: elige ver solo P / SP o también la hora corta (7–7, 7–3, 3–11).',
    ],
  },
  {
    version: '0.6.3',
    titulo: 'Detalles',
    puntos: [
      'Máximo 24 h de trabajo seguidas sumando planilla y Servicios Profesionales.',
      'Mensajes de WhatsApp más amables y claros para proponer, responder y compartir.',
      'En Inicio, “Cambiar este turno” solo aparece cuando aún no empieza; si estás en turno, ves tu próximo turno para cambiarlo.',
      'El ícono de la pantalla de inicio sigue al logo que elige la administración.',
    ],
  },
  {
    version: '0.6.2',
    titulo: 'Permutas más claras y con reglas',
    puntos: [
      'Cada permuta muestra el día en grande y las fechas que le sirven a quien la publica.',
      '“Puedes permutar” o “Te sirve”: ofrécete con un toque desde la tarjeta.',
      'Solo se permuta el mismo horario (7–3 por 7–3, 6–6 por 6–6, día por día, noche por noche).',
      'No se permiten dos turnos de planilla seguidos ni dos de 12 h de Servicios Profesionales seguidos. Planilla + Servicios Profesionales sí.',
      'Lo que no puedes tomar aparece al final, en gris, con el motivo.',
    ],
  },
  {
    version: '0.6.1',
    titulo: 'Ajustes rápidos',
    puntos: [
      'Horario más compacto: vista, filtro P / SP y botón para mostrar u ocultar las pausas en una sola línea.',
      'En los turnos de noche la comida ahora dice Cena.',
      'Arreglado: ya se ve quién más está de turno.',
      'Permutas: nuevo botón “Agregar solicitud” para publicar uno de tus turnos.',
    ],
  },
  {
    version: '0.6.0',
    titulo: 'Nueva pantalla de Inicio',
    puntos: [
      'Inicio: tu turno de hoy o el próximo, con cuenta regresiva y horario de comida y descanso.',
      'Un vistazo a mañana y lo que te toca responder, todo en la primera pantalla.',
      'Recordatorio para marcar en GeoVictoria 15 minutos antes de cada turno de planilla.',
      '¿Quién está de turno? Toca un día para ver al equipo de planilla y SP.',
      'La Bolsa ahora se llama Permutas: en planilla solo permutas; en Servicios Profesionales, permutas y donaciones. Te marcamos qué turnos te sirven sin choques.',
      'Resumen del mes: turnos, horas, noches, días libres y cambios.',
      'Horario más claro: AM/PM completo, día y noche con ícono, P y S en el mes.',
      'Más ajustes en Cuenta: color, letra, formato de hora, pantalla inicial y avisos a tu gusto.',
      '¿Un turno vino mal en la hoja? Ábrelo y toca “Corregir”.',
      'Nuevo ícono de la app.',
    ],
  },
  {
    version: '0.5.0',
    titulo: 'Tu horario y la bolsa de cambios',
    puntos: [
      'Mi horario en vista Agenda, Semana o Mes, con filtro Planilla / SP.',
      'Toca un turno para buscar con quién cambiar: te sugerimos personas y días sin turnos de planilla pegados.',
      'Propón el cambio directo a esa persona; si acepta, queda hecho 🔁.',
      'Bolsa de cambios para regalar, pedir cobertura o buscar turnos extra.',
      'Campanita de avisos, compartir a WhatsApp y exportar tu horario a Google Calendar o Excel.',
      'Modo oscuro, nueva tipografía y la app se puede instalar en el celular.',
      'Botón de WhatsApp para escribirle directo a quien te propone o acepta un cambio.',
      'Avisos en el celular (actívalos en Cuenta) y deshacer un cambio si jefatura no lo aprueba.',
    ],
  },
]

const CLAVE = 'chambea.version.vista'
const leerVista = () => { try { return localStorage.getItem(CLAVE) } catch { return null } }
// '0.6.10' > '0.6.9'
const mayor = (a, b) => {
  const x = a.split('.').map(Number), y = (b || '0').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}
// Solo las versiones que esta persona todavía no ha visto
export const novedadesPendientes = () => {
  const vista = leerVista()
  return vista ? NOVEDADES.filter((n) => mayor(n.version, vista)) : []
}
export const hayNovedades = () => novedadesPendientes().length > 0
// La primera vez (cuenta nueva o celular nuevo) no se muestra el historial: solo se marca como visto
export const primeraVez = () => leerVista() == null
export function marcarNovedadesVistas() {
  try { localStorage.setItem(CLAVE, VERSION) } catch { /* sin almacenamiento */ }
}
