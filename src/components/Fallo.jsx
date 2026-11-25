// Si una pantalla falla, muestra un mensaje amable con el detalle y botón para recargar (en vez de pantalla en blanco)
import { Component } from 'react'
import Icono from './Icono'

export default class Fallo extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, verDetalle: false }
  }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[Chambea]', error, info?.componentStack) }
  render() {
    const { error, verDetalle } = this.state
    if (!error) return this.props.children
    const versionVieja = /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError/i.test(String(error?.message))
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="tarjeta space-y-3 text-center">
          <Icono n="alerta" size={36} className="mx-auto text-amber-600" />
          <p className="font-bold text-slate-900">{versionVieja ? 'Hay una versión nueva de Chambea' : 'Algo falló al abrir esta pantalla'}</p>
          <p className="text-sm text-slate-600">{versionVieja ? 'Recarga para usarla.' : 'Recarga la app. Si se repite, avisa a la administración.'}</p>
          <button className="btn-primario w-full" onClick={async () => {
            try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))) } catch { /* nada */ }
            window.location.reload()
          }}>Recargar</button>
          <button className="text-xs text-slate-500 underline" onClick={() => this.setState({ verDetalle: !verDetalle })}>{verDetalle ? 'Ocultar detalle' : 'Ver detalle'}</button>
          {verDetalle && <pre className="max-h-40 overflow-auto rounded-xl bg-slate-100 p-2 text-left text-[11px] text-slate-700">{String(error?.stack || error?.message || error)}</pre>}
        </div>
      </div>
    )
  }
}
