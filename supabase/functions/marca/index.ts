// Ícono y manifest de la app según el logo que eligió la administración (ajustes.logo).
// Netlify reenvía /manifest.webmanifest y /marca/* hacia aquí, así el ícono de inicio
// (iPhone y Android) queda enlazado con el logo elegido dentro de la app.
const LOGOS = ['A', 'B', 'C', 'D', 'E']
const ARCHIVOS: Record<string, string> = {
  'apple.png': 'apple', '192.png': '192', '512.png': '512', 'maskable.png': 'maskable',
}

async function logoActual(): Promise<string> {
  try {
    const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1/ajustes?id=eq.1&select=logo`
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    const [fila] = await r.json()
    return LOGOS.includes(fila?.logo) ? fila.logo : 'A'
  } catch {
    return 'A'
  }
}

// Origen de la app (Netlify lo manda al reenviar); si no viene, se usa ruta relativa
function origen(req: Request): string {
  const host = req.headers.get('x-forwarded-host')
  if (host && !host.includes('supabase.co')) return `https://${host}`
  const ref = req.headers.get('referer')
  try { if (ref && !ref.includes('supabase.co')) return new URL(ref).origin } catch { /* nada */ }
  return ''
}

Deno.serve(async (req) => {
  const archivo = new URL(req.url).pathname.split('/').pop() ?? ''
  const logo = await logoActual()
  const cache = { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' }

  if (archivo === 'manifest.webmanifest' || archivo === 'manifest') {
    const icono = (tam: string) => `/icons/logos/${logo}-${tam}.png`
    const manifest = {
      name: 'Chambea · Cambios de turno', short_name: 'Chambea', id: '/',
      description: 'Cambios de turno entre compañeros: planilla y servicios profesionales.',
      lang: 'es', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
      background_color: '#f8fafc', theme_color: '#f8fafc',
      icons: [
        { src: icono('192'), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icono('512'), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: icono('maskable'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
    return new Response(JSON.stringify(manifest), { headers: { ...cache, 'Content-Type': 'application/manifest+json' } })
  }

  const destino = archivo === 'favicon.svg'
    ? `/icons/logos/${logo}.svg`
    : ARCHIVOS[archivo] ? `/icons/logos/${logo}-${ARCHIVOS[archivo]}.png` : null
  if (!destino) return new Response('No encontrado', { status: 404 })
  return new Response(null, { status: 302, headers: { ...cache, Location: `${origen(req)}${destino}` } })
})
