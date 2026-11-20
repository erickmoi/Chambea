import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } },
)

const DOMINIO = import.meta.env.VITE_EMAIL_DOMAIN || 'chambea.internal'

// "Érick Díaz" → "erick.diaz" (sin tildes; espacios pasan a punto)
export const normalizarUsuario = (u) =>
  u.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.')
export const emailDe = (usuario) => `${normalizarUsuario(usuario)}@${DOMINIO}`

// Mensaje legible de un error de Supabase/Postgres
export const mensajeError = (e) => e?.message?.replace(/^.*?ERROR:\s*/, '') || 'Algo salió mal. Intenta otra vez.'
