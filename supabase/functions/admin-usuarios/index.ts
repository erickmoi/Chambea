// Restablecer el PIN de otra persona. Requiere la llave secreta, por eso vive en el servidor.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } })

function llaveSecreta(): string {
  const nuevas = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (nuevas) {
    try {
      const k = JSON.parse(nuevas)?.default
      if (k) return k
    } catch { /* usa la llave antigua */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, llaveSecreta(), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const PIN_RE = /^\d{6}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  // ¿Quién llama?
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'No autorizado' }, 401)
  const { data: u, error: eu } = await admin.auth.getUser(token)
  if (eu || !u.user) return json({ error: 'No autorizado' }, 401)
  const { data: yo } = await admin.from('perfiles').select('id, rol, activo, aprobado').eq('id', u.user.id).maybeSingle()
  if (!yo?.activo || !yo.aprobado || !['superadmin', 'admin'].includes(yo.rol)) return json({ error: 'No autorizado' }, 403)

  let cuerpo: Record<string, unknown>
  try { cuerpo = await req.json() } catch { return json({ error: 'Solicitud inválida' }, 400) }

  try {
    if (cuerpo.accion === 'restablecer_pin') {
      const id = String(cuerpo.usuario_id ?? '')
      const pin = String(cuerpo.pin ?? '')
      if (!PIN_RE.test(pin)) return json({ error: 'El PIN debe tener 6 números.' }, 400)
      if (id === yo.id) return json({ error: 'Cambia tu propio PIN desde Mi cuenta.' }, 400)
      const { data: destino } = await admin.from('perfiles').select('id, rol').eq('id', id).maybeSingle()
      if (!destino) return json({ error: 'Cuenta no encontrada.' }, 404)
      // Nadie toca al superadmin; solo el superadmin toca a un admin
      if (destino.rol === 'superadmin' || (destino.rol === 'admin' && yo.rol !== 'superadmin'))
        return json({ error: 'No tienes permiso para cambiar el PIN de esta persona.' }, 403)
      const { error } = await admin.auth.admin.updateUserById(id, { password: pin })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'Error interno' }, 500)
  }
})
