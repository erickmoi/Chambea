// Íconos de la app: Phosphor "dos tonos" (solo se incluye el SVG que se usa).
// Uso: <Icono n="subir" /> · tamaño por defecto 20 px, color = color del texto.
import X from '@phosphor-icons/core/duotone/x-duotone.svg?raw'
import XBold from '@phosphor-icons/core/bold/x-bold.svg?raw'
import UploadSimple from '@phosphor-icons/core/duotone/upload-simple-duotone.svg?raw'
import FileXls from '@phosphor-icons/core/duotone/file-xls-duotone.svg?raw'
import CheckCircle from '@phosphor-icons/core/duotone/check-circle-duotone.svg?raw'
import Warning from '@phosphor-icons/core/duotone/warning-duotone.svg?raw'
import Users from '@phosphor-icons/core/duotone/users-duotone.svg?raw'
import CalendarBlank from '@phosphor-icons/core/duotone/calendar-blank-duotone.svg?raw'
import ArrowsLeftRight from '@phosphor-icons/core/duotone/arrows-left-right-duotone.svg?raw'
import Link from '@phosphor-icons/core/duotone/link-duotone.svg?raw'
import Info from '@phosphor-icons/core/duotone/info-duotone.svg?raw'

const UI = {
  cerrar: X, subir: UploadSimple, excel: FileXls, ok: CheckCircle, alerta: Warning,
  usuarios: Users, calendario: CalendarBlank, cambio: ArrowsLeftRight, enlace: Link, info: Info,
}
const OTROS_PESOS = { bold: { cerrar: XBold } }

export default function Icono({ n, size = 20, weight = 'duotone', className = '', style, ...resto }) {
  const svg = (weight !== 'duotone' && OTROS_PESOS[weight]?.[n]) || UI[n]
  if (!svg) return null
  const lado = typeof size === 'number' ? `${size}px` : size
  return (
    <span aria-hidden="true" className={`icono inline-block shrink-0 ${className}`}
      style={{ width: lado, height: lado, ...style }} dangerouslySetInnerHTML={{ __html: svg }} {...resto} />
  )
}
