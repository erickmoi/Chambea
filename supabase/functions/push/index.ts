// Notificaciones push (Web Push).
// - Desde la base de datos (cabecera x-notif-token): un aviso nuevo para una persona.
// - Desde la app (sesión): "prueba" para confirmar que llegan.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notif-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

function llaveSecreta(): string {
  const nuevas = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (nuevas) { try { const k = JSON.parse(nuevas)?.default; if (k) return k } catch { /* antigua */ } }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}
const admin = createClient(Deno.env.get('SUPABASE_URL')!, llaveSecreta(), { auth: { persistSession: false, autoRefreshToken: false } })

let cfg: { vapid_public: string; vapid_private: string; notif_token: string } | null = null
async function config() {
  if (cfg) return cfg
  const { data, error } = await admin.rpc('notif_config')
  if (error || !data?.vapid_private) throw new Error('Falta la configuración de notificaciones')
  cfg = data
  webpush.setVapidDetails('mailto:starfieldstudio.app@gmail.com', data.vapid_public, data.vapid_private)
  return cfg!
}

async function enviar(perfilId: string, msg: { title: string; body: string; url?: string; tag?: string }) {
  const { data: subs } = await admin.from('push_suscripciones').select('id, endpoint, p256dh, auth').eq('perfil_id', perfilId)
  let enviados = 0
  const vencidas: number[] = []
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 86400 })
      enviados++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) vencidas.push(s.id)
      else console.error('push', code, (e as Error).message)
    }
  }))
  if (vencidas.length) await admin.from('push_suscripciones').delete().in('id', vencidas)
  return enviados
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  let c: Record<string, unknown>
  try { c = await req.json() } catch { return json({ error: 'Solicitud inválida' }, 400) }
  try {
    const k = await config()
    const tokenBD = req.headers.get('x-notif-token')
    if (tokenBD) {
      if (tokenBD !== k.notif_token) return json({ error: 'No autorizado' }, 403)
      const n = await enviar(String(c.perfil_id), {
        title: String(c.titulo ?? 'Chambea'), body: String(c.cuerpo ?? ''), url: String(c.url ?? '/'), tag: c.tag ? String(c.tag) : undefined,
      })
      return json({ ok: true, enviados: n })
    }
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const { data: u } = token ? await admin.auth.getUser(token) : { data: { user: null } }
    if (!u?.user) return json({ error: 'No autorizado' }, 401)
    if (c.accion === 'prueba') {
      const n = await enviar(u.user.id, { title: '🔔 Avisos activados', body: 'Así te llegarán las propuestas y respuestas de Chambea.', tag: 'prueba' })
      return json({ ok: true, enviados: n })
    }
    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'Error interno' }, 500)
  }
})
