-- 025 · Actividad en la app (para el panel de administración)
--  · latido(): la app lo llama al abrir y cada minuto mientras está visible
--  · actividad_admin(): en línea ahora, activos hoy / 7 días, uso por día y detalle por usuario

alter table public.perfiles
  add column if not exists ultima_vez timestamptz,
  add column if not exists ultima_version text,
  add column if not exists instalada boolean,
  add column if not exists aperturas integer not null default 0;

create table if not exists public.actividad_dias (
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  fecha date not null,
  primary key (perfil_id, fecha)
);
alter table public.actividad_dias enable row level security;
revoke all on public.actividad_dias from anon, authenticated;

create or replace function public.latido(p_version text default null, p_instalada boolean default null, p_abrir boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_yo uuid := (select auth.uid());
begin
  if v_yo is null then return; end if;
  update public.perfiles set ultima_vez = now(),
         ultima_version = coalesce(left(p_version, 20), ultima_version),
         instalada = coalesce(p_instalada, instalada),
         aperturas = aperturas + case when p_abrir then 1 else 0 end
   where id = v_yo;
  insert into public.actividad_dias (perfil_id, fecha)
  values (v_yo, (now() at time zone 'America/El_Salvador')::date)
  on conflict do nothing;
end;
$$;
grant execute on function public.latido(text, boolean, boolean) to authenticated;

create or replace function public.actividad_admin()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hoy date := (now() at time zone 'America/El_Salvador')::date;
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  return jsonb_build_object(
    'cuentas', (select count(*) from public.perfiles where activo and aprobado),
    'en_linea', (select count(*) from public.perfiles where activo and ultima_vez > now() - interval '2 minutes'),
    'hoy', (select count(*) from public.actividad_dias where fecha = v_hoy),
    'semana', (select count(distinct perfil_id) from public.actividad_dias where fecha > v_hoy - 7),
    'con_avisos', (select count(distinct s.perfil_id) from public.push_suscripciones s
                     join public.perfiles p on p.id = s.perfil_id where p.activo and p.aprobado),
    'instaladas', (select count(*) from public.perfiles where activo and aprobado and instalada),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('fecha', d::date, 'n',
                  (select count(*) from public.actividad_dias a where a.fecha = d::date)) order by d), '[]'::jsonb)
                  from generate_series(v_hoy - 13, v_hoy, interval '1 day') d),
    'usuarios', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'usuario', p.usuario, 'nombre', coalesce(pe.nombre, p.nombre), 'telefono', p.telefono,
        'ultima_vez', p.ultima_vez, 'version', p.ultima_version, 'instalada', p.instalada, 'aperturas', p.aperturas,
        'en_linea', p.ultima_vez > now() - interval '2 minutes',
        'avisos', exists (select 1 from public.push_suscripciones s where s.perfil_id = p.id),
        'dias_7', (select count(*) from public.actividad_dias a where a.perfil_id = p.id and a.fecha > v_hoy - 7))
        order by p.ultima_vez desc nulls last), '[]'::jsonb)
        from public.perfiles p left join public.personas pe on pe.id = p.persona_id
       where p.activo and p.aprobado));
end;
$$;
grant execute on function public.actividad_admin() to authenticated;
