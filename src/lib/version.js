// Versión visible en Ajustes y notas de "Novedades" (se muestran una vez por versión)
export const VERSION = '0.6.0'

export const NOVEDADES = [
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
export function hayNovedades() {
  try { return localStorage.getItem(CLAVE) !== VERSION } catch { return false }
}
export function marcarNovedadesVistas() {
  try { localStorage.setItem(CLAVE, VERSION) } catch { /* sin almacenamiento */ }
}
