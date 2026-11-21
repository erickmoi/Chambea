-- =====================================================================
-- 010 · Logo de la app elegido por la administración
-- =====================================================================
alter table public.ajustes
  add column if not exists logo text not null default 'A' check (logo in ('A', 'B', 'C', 'D', 'E'));

create or replace function public.guardar_ajustes_generales(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  update public.ajustes set
    max_horas_continuas = coalesce((p ->> 'max_horas_continuas')::integer, max_horas_continuas),
    min_descanso_planilla_h = coalesce((p ->> 'min_descanso_planilla_h')::integer, min_descanso_planilla_h),
    registro_abierto = coalesce((p ->> 'registro_abierto')::boolean, registro_abierto),
    geovictoria_activo = coalesce((p ->> 'geovictoria_activo')::boolean, geovictoria_activo),
    edicion_turnos = coalesce(p ->> 'edicion_turnos', edicion_turnos),
    recordar_carga_dias = coalesce((p ->> 'recordar_carga_dias')::integer, recordar_carga_dias),
    anuncio = case when p ? 'anuncio' then nullif(trim(p ->> 'anuncio'), '') else anuncio end,
    anuncio_hasta = case when p ? 'anuncio_hasta' then (nullif(p ->> 'anuncio_hasta', ''))::date else anuncio_hasta end,
    logo = coalesce(p ->> 'logo', logo),
    actualizado = now()
   where id = 1;
end;
$$;
