// Uso: npm run probar-importador -- ruta/al/HORARIO.xlsx
// Lee el archivo con el mismo código de la app e imprime un resumen y una huella por persona.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { leerHorarios, normalizar } from '../src/lib/importador.js'

const ruta = process.argv[2]
if (!ruta) { console.error('Falta la ruta del .xlsx'); process.exit(1) }
const b = readFileSync(ruta)
const secciones = await leerHorarios(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const huellas = {}
for (const s of secciones) {
  console.log(`${s.seccion} (${s.hoja}) ${s.desde} → ${s.hasta}`, s.resumen, `no reconocidos: ${s.raros.length}`)
  for (const r of s.raros.slice(0, 10)) console.log('   ?', r.nombre, r.fecha, JSON.stringify(r.valor))
  const g = {}
  for (const t of s.turnos) (g[normalizar(t.nombre)] ||= []).push(t)
  for (const [n, L] of Object.entries(g)) {
    L.sort((a, b) => a.inicio.localeCompare(b.inicio))
    const txt = L.map((t) => `${t.fecha}|${t.inicio.slice(11, 16)}|${t.fin.slice(11, 16)}|${t.funcion}`).join(',')
    huellas[`${n}|${s.seccion}`] = `${L.length}|${createHash('md5').update(txt).digest('hex')}`
  }
}
if (process.argv[3]) (await import('node:fs')).writeFileSync(process.argv[3], JSON.stringify(huellas, null, 1))
