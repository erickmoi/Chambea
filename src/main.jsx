import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fuentes.css'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './lib/auth.jsx'
import { temaInicial } from './lib/tema'
import { escucharInstalacion } from './lib/instalar'
import { aplicarLogo, logoGuardado } from './lib/logo'

temaInicial()
aplicarLogo(logoGuardado())
escucharInstalacion()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)

// App instalable y abre rápido (solo en producción)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
