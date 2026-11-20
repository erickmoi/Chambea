import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { desactivarPush } from './push'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = cargando
  const [cuenta, setCuenta] = useState(null)
  const [cargandoCuenta, setCargandoCuenta] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    // No hacer llamadas a Supabase dentro de este callback (evita bloqueos)
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const cargarCuenta = useCallback(async () => {
    if (!session?.user) {
      setCuenta(null)
      return
    }
    setCargandoCuenta(true)
    const { data } = await supabase.rpc('mi_cuenta')
    setCuenta(data)
    setCargandoCuenta(false)
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    cargarCuenta()
  }, [cargarCuenta])

  const salir = async () => {
    await desactivarPush().catch(() => {})
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        cuenta,
        cargando: session === undefined || (cargandoCuenta && !cuenta),
        recargarCuenta: cargarCuenta,
        salir,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
export const esAdmin = (c) => !!c?.activo && !!c?.aprobado && ['superadmin', 'admin'].includes(c?.rol)
export const esSuperadmin = (c) => !!c?.activo && c?.rol === 'superadmin'
