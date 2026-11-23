// Lecturas y acciones contra Supabase, con caché local para ver el horario sin conexión.
import { supabase, mensajeError } from './supabase'
import { horario, fechaCorta, sumarDias, nombreComida } from './fechas'

export async function rpc(nombre, args) {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) throw new Error(mensajeError(error))
  return data
}

const CLAVE_CACHE = 'chambea.turnos'
const leerCache = () => {
  try { return JSON.parse(localStorage.getItem(CLAVE_CACHE)) || {} } catch { return {} }
}

// Mis turnos en un rango. Si no hay internet, devuelve lo último guardado.
export async function misTurnos(personaId, desde, hasta) {
  const { data, error } = await supabase.from('turnos')
    .select('id, seccion, fecha, inicio, fin, etiqueta, funcion, es_cambio, persona_original_id, comida, descanso')
    .eq('persona_id', personaId).gte('fecha', desde).lte('fecha', hasta).order('inicio')
  if (error) {
    const c = leerCache()
    if (c.personaId === personaId && c.turnos) {
      return { turnos: c.turnos.filter((t) => t.fecha >= desde && t.fecha <= hasta), sinConexion: true }
    }
    throw new Error(mensajeError(error))
  }
  try {
    const c = leerCache()
    const otros = c.personaId === personaId ? (c.turnos || []).filter((t) => t.fecha < desde || t.fecha > hasta) : []
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ personaId, turnos: [...otros, ...data], guardado: Date.now() }))
  } catch { /* sin almacenamiento */ }
  return { turnos: data, sinConexion: false }
}

export const SECCION = { planilla: 'Planilla', sp: 'Servicios Profesionales' }
export const SECCION_CORTA = { planilla: 'P', sp: 'SP' }
export const FUNCION = { triaje: 'Triaje', referencias: 'Referencias', supervisor: 'Supervisor', general: 'General' }
export const TIPO = {
  permuta: { texto: 'Permuta', icono: 'cambio', color: 'bg-planilla-claro text-planilla' },
  ceder: { texto: 'Donación', icono: 'ceder', color: 'bg-amber-50 text-amber-800' },
  cobertura: { texto: 'Pide cobertura', icono: 'cobertura', color: 'bg-red-50 text-red-700' },
  busco: { texto: 'Busca turno', icono: 'buscar', color: 'bg-sp-claro text-sp' },
}
export const ESTADO = {
  abierta: 'Abierta', por_confirmar: 'Por confirmar', aplicada: 'Cambio hecho', cancelada: 'Cancelada', vencida: 'Vencida',
  pendiente: 'Esperando respuesta', elegida: 'Te eligieron', aceptada: 'Aceptada', rechazada: 'No elegida', retirada: 'Retirada',
}

export const textoTurno = (t) => (t ? `${t.seccion === 'sp' ? 'SP · ' : ''}${fechaCorta(t.fecha)} · ${horario(t.etiqueta)}` : '')

// Explica un aviso de choque en palabras
export function textoAviso(a) {
  if (a.tipo === 'cruce') return `Choca con ${a.seccion === 'sp' ? 'un SP' : 'un turno de planilla'} del ${fechaCorta(a.fecha)} (${horario(a.etiqueta)})`
  if (a.tipo === 'pegado') return `Queda sin 12 h de descanso con un turno de planilla del ${fechaCorta(a.fecha)} (${horario(a.etiqueta)})`
  if (a.tipo === 'jornada_larga') return `Serían ${Math.round(a.horas)} h de trabajo seguidas`
  return 'Aviso'
}

// ---------------------------------------------------------------- exportar
const icsFecha = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
export function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function exportarIcs(turnos, nombre) {
  const ev = turnos.map((t) => [
    'BEGIN:VEVENT', `UID:chambea-${t.id}@chambea`, `DTSTAMP:${icsFecha(Date.now())}`,
    `DTSTART:${icsFecha(t.inicio)}`, `DTEND:${icsFecha(t.fin)}`,
    // Solo los de Servicios Profesionales llevan "SP" antes de la hora; planilla va solo con la hora
    `SUMMARY:${t.seccion === 'sp' ? 'SP ' : ''}${horario(t.etiqueta)}${t.es_cambio ? ' (cambio)' : ''}`,
    `DESCRIPTION:${[SECCION[t.seccion], FUNCION[t.funcion], t.comida && `${nombreComida(t)} ${horario(t.comida)}`, t.descanso && `Descanso ${horario(t.descanso)}`].filter(Boolean).join(' · ')}`,
    'END:VEVENT'].join('\r\n'))
  descargar(`${nombre}.ics`, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chambea//ES', ...ev, 'END:VCALENDAR'].join('\r\n'), 'text/calendar')
}
export function exportarCsv(turnos, nombre) {
  const filas = [['Fecha', 'Sección', 'Horario', 'Función', 'Horas', 'Comida', 'Descanso', 'Cambio']]
  for (const t of turnos) {
    filas.push([t.fecha, SECCION[t.seccion], horario(t.etiqueta), FUNCION[t.funcion],
      Math.round((new Date(t.fin) - new Date(t.inicio)) / 36e5), t.comida || '', t.descanso || '', t.es_cambio ? 'Sí' : ''])
  }
  descargar(`${nombre}.csv`, '﻿' + filas.map((f) => f.join(',')).join('\n'), 'text/csv;charset=utf-8')
}

// Enlace de WhatsApp con texto y enlace directo a la solicitud
export const enlaceWhatsApp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`
export const urlSolicitud = (id) => `${window.location.origin}/?solicitud=${id}`

// 'ERICK MOISES DIAZ CHICA' → 'Erick Diaz' (nombre + primer apellido)
export function nombreBonito(n = '') {
  const p = n.trim().split(/\s+/).map((x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase())
  if (p.length >= 4) return `${p[0]} ${p[2]}`
  return p.slice(0, 2).join(' ')
}
export const iniciales = (n = '') => nombreBonito(n).split(' ').map((x) => x[0]).join('').slice(0, 2)

// WhatsApp directo a un número de El Salvador (8 dígitos)
export const enlaceWaA = (tel, texto) => `https://wa.me/503${tel}?text=${encodeURIComponent(texto)}`
export const telValido = (t) => /^[67]\d{7}$/.test(String(t || '').replace(/\D/g, '').replace(/^503(?=\d{8}$)/, ''))
export const limpiarTel = (t) => String(t || '').replace(/\D/g, '').replace(/^503(?=\d{8}$)/, '')
export const telBonito = (t) => (t ? `${t.slice(0, 4)}-${t.slice(4)}` : '')

// ---------------------------------------------------------------- quién está de turno
// Todos los turnos que tocan ese día (incluye las noches que vienen del día anterior)
export async function turnosDelDia(fecha) {
  const { data, error } = await supabase.from('turnos')
    .select('id, persona_id, seccion, fecha, inicio, fin, etiqueta, funcion, es_cambio, persona:personas!turnos_persona_id_fkey(nombre)')
    .gte('fecha', sumarDias(fecha, -1)).lte('fecha', fecha)
    .lt('inicio', `${sumarDias(fecha, 1)}T00:00:00-06:00`).gt('fin', `${fecha}T00:00:00-06:00`)
    .order('inicio')
  if (error) throw new Error(mensajeError(error))
  return data
}

// ---------------------------------------------------------------- ¿me sirve este turno?
// Compara un turno de Permutas con mis turnos: 'sirve' · 'choca' · 'pegado'
export function evaluarTurno(t, mios, minDescansoH = 8) {
  if (!t) return null
  const ini = new Date(t.inicio).getTime()
  const fin = new Date(t.fin).getTime()
  let pegado = null
  for (const m of mios) {
    if (m.id === t.id) return null // es mío
    const mi = new Date(m.inicio).getTime()
    const mf = new Date(m.fin).getTime()
    if (mi < fin && mf > ini) return { estado: 'choca', con: m }
    if (t.seccion === 'planilla' && m.seccion === 'planilla') {
      const hueco = Math.min(Math.abs(mi - fin), Math.abs(ini - mf)) / 36e5
      if (hueco < minDescansoH) pegado = m
    }
  }
  return pegado ? { estado: 'pegado', con: pegado } : { estado: 'sirve' }
}
