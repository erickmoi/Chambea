import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } },
)

const DOMINIO = import.meta.env.VITE_EMAIL_DOMAIN || 'chambea.internal'

export const normalizarUsuario = (u) => u.trim().toLowerCase()
export const emailDe = (usuario) => `${normalizarUsuario(usuario)}@${DOMINIO}`

// Mensaje legible de un error de Supabase/Postgres
export const mensajeError = (e) => e?.message?.replace(/^.*?ERROR:\s*/, '') || 'Algo salió mal. Intenta otra vez.'
