// Recorrido de bienvenida: 3 pantallas la primera vez (se puede volver a ver desde Cuenta)
import { useState } from 'react'
import Icono from './Icono'
import { Hoja } from './ui'

const PASOS = [
  {
    icono: 'calendario',
    titulo: 'Tu horario, siempre a mano',
    texto: 'En Inicio ves tu turno de hoy o el próximo, con la hora de comida y de descanso. En Horario lo ves por agenda, semana o mes.',
    puntos: [
      ['sol', 'Turno de día'], ['luna', 'Turno de noche'], ['huella', 'Te recordamos marcar en GeoVictoria antes de cada turno de planilla'],
      ['calendario', 'P: Planilla · SP: Servicios Profesionales'],
    ],
  },
  {
    icono: 'cambio',
    titulo: 'Permutas y donaciones',
    texto: 'Toca cualquier turno tuyo para empezar.',
    puntos: [
      ['cambio', 'Permuta: cambias tu turno por uno de otra persona (Planilla y Servicios Profesionales).'],
      ['ceder', 'Donación: le das tu turno de Servicios Profesionales a quien lo quiera.'],
      ['buscar', 'Te sugerimos con quién y qué días, sin turnos de planilla pegados.'],
    ],
  },
  {
    icono: 'trato',
    titulo: 'Permutas y avisos',
    texto: 'En Permutas están los turnos que tus compañeros publican. Te marcamos cuáles te sirven sin choques.',
    puntos: [
      ['ok', '“Te sirve” = no choca con tus turnos.'],
      ['notificaciones', 'Activa los avisos en Cuenta para enterarte al instante.'],
      ['whatsapp', 'Escríbele por WhatsApp a quien te propone un cambio.'],
    ],
  },
]

const CLAVE = 'chambea.recorrido'
export const recorridoVisto = () => { try { return localStorage.getItem(CLAVE) === '1' } catch { return true } }

export default function Recorrido({ onCerrar }) {
  const [i, setI] = useState(0)
  const p = PASOS[i]
  const fin = () => { try { localStorage.setItem(CLAVE, '1') } catch { /* nada */ } onCerrar() }
  return (
    <Hoja titulo="Bienvenido a Chambea" icono="hola" onCerrar={fin} ancho="max-w-md">
      <div key={i} className="animar-entrada">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-marca-claro text-marca-texto">
          <Icono n={p.icono} size={44} />
        </div>
        <h3 className="text-center text-xl font-bold text-slate-900">{p.titulo}</h3>
        <p className="mt-2 text-center text-slate-700">{p.texto}</p>
        <ul className="mt-4 space-y-2">
          {p.puntos.map(([ic, t]) => (
            <li key={t} className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
              <Icono n={ic} size={20} className="mt-px text-marca-texto" />{t}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-5 flex items-center justify-center gap-1.5" aria-label={`Paso ${i + 1} de ${PASOS.length}`}>
        {PASOS.map((_, k) => <span key={k} className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-marca' : 'w-2 bg-slate-300'}`} />)}
      </div>
      <div className="mt-4 flex gap-2">
        {i > 0 ? <button className="btn-secundario flex-1" onClick={() => setI(i - 1)}>Atrás</button>
          : <button className="btn-secundario flex-1" onClick={fin}>Saltar</button>}
        {i < PASOS.length - 1
          ? <button data-autofoco className="btn-primario flex-1" onClick={() => setI(i + 1)}>Siguiente</button>
          : <button data-autofoco className="btn-primario flex-1" onClick={fin}>¡Empezar!</button>}
      </div>
    </Hoja>
  )
}
