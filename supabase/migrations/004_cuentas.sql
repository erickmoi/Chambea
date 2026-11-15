-- =====================================================================
-- CHAMBEA · 004 · Cuentas: registro con aprobación, enlace al horario,
-- bloqueo por intentos fallidos y administración de usuarios.
-- Flujo: cada quien se registra (usuario + nombre + PIN) → la base sugiere
-- su nombre del horario → un admin aprueba y confirma el enlace.
-- =====================================================================

alter table public.perfiles
  add column persona_sugerida_id bigint references public.personas(id) on delete set null;
create index perfiles_persona_sugerida_idx on public.perfiles (persona_sugerida_id);

-- Persona del horario que corresponde a un nombre escrito (exacto → alias → parecido)
create or replace function private.persona_de_nombre(p_nombre text)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select id from public.personas where nombre_norm = private.norm(p_nombre)),
    (select persona_id from public.alias_personas where alias_norm = private.norm(p_nombre)),
    private.similar_a(private.norm(p_nombre)));
$$;

create or replace function private.notificar_admins(p_tipo text, p_titulo text, p_cuerpo text, p_url text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
  select id, p_tipo, p_titulo, p_cuerpo, p_url
    from public.perfiles where rol in ('superadmin', 'admin') and activo and aprobado;
$$;

-- Al registrarse: crea el perfil, sugiere su nombre del horario y avisa a la administración
create or replace function private.nuevo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_nombre text; v_sug bigint;
begin
  v_nombre := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1));
  v_sug := private.persona_de_nombre(v_nombre);
  if v_sug is not null and exists (select 1 from public.perfiles where persona_id = v_sug) then
    v_sug := null;  -- ese nombre ya tiene cuenta
  end if;
  insert into public.perfiles (id, usuario, nombre, persona_sugerida_id)
  values (new.id,
          lower(trim(coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1)))),
          v_nombre, v_sug);
  perform private.notificar_admins('cuenta_nueva', '👤 Cuenta por aprobar',
    v_nombre || ' (@' || lower(trim(coalesce(new.raw_user_meta_data ->> 'usuario', ''))) || ') se registró.',
    '/?vista=usuarios');
  return new;
end;
$$;

-- ---------------------------------------------------------------- mi cuenta
create or replace function public.mi_cuenta()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'usuario', p.usuario, 'nombre', p.nombre, 'rol', p.rol,
    'activo', p.activo, 'aprobado', p.aprobado, 'tema', p.tema,
    'persona_id', p.persona_id, 'persona', pe.nombre,
    'es_supervisor', coalesce(pe.es_supervisor, false),
    'referencias_planilla', coalesce(pe.referencias_planilla, false),
    'referencias_sp', coalesce(pe.referencias_sp, false))
    from public.perfiles p left join public.personas pe on pe.id = p.persona_id
   where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------- bloqueo por intentos
create table private.intentos_login (
  usuario text primary key,
  fallos integer not null default 0,
  bloqueado_hasta timestamptz,
  actualizado timestamptz not null default now()
);

create or replace function public.login_estado(p_usuario text)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((
    select greatest(0, ceil(extract(epoch from (bloqueado_hasta - now()))))::integer
      from private.intentos_login where usuario = lower(trim(p_usuario))), 0);
$$;

-- 5 fallos seguidos en 15 min ⇒ bloqueo de 15 min
create or replace function public.login_fallo(p_usuario text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_u text := lower(trim(p_usuario)); v_f private.intentos_login; v_nombre text;
begin
  select nombre into v_nombre from public.perfiles where usuario = v_u;
  if not found then return jsonb_build_object('restantes', null, 'bloqueado_seg', 0); end if;

  insert into private.intentos_login as i (usuario, fallos, actualizado) values (v_u, 1, now())
  on conflict (usuario) do update set
    fallos = case when i.actualizado < now() - interval '15 minutes'
                    or (i.bloqueado_hasta is not null and i.bloqueado_hasta <= now())
                  then 1 else i.fallos + 1 end,
    bloqueado_hasta = case when i.bloqueado_hasta > now() then i.bloqueado_hasta end,
    actualizado = now()
  returning * into v_f;

  if v_f.bloqueado_hasta is null and v_f.fallos >= 5 then
    update private.intentos_login set bloqueado_hasta = now() + interval '15 minutes', fallos = 0
     where usuario = v_u returning * into v_f;
    perform private.notificar_admins('seguridad', '🔒 Cuenta bloqueada 15 min',
      '5 intentos fallidos de PIN en la cuenta de ' || split_part(v_nombre, ' ', 1) || ' (@' || v_u || ').',
      '/?vista=usuarios');
  end if;

  return jsonb_build_object(
    'restantes', case when v_f.bloqueado_hasta is null then 5 - v_f.fallos end,
    'bloqueado_seg', coalesce(greatest(0, ceil(extract(epoch from (v_f.bloqueado_hasta - now()))))::integer, 0));
end;
$$;

create or replace function public.login_ok()
returns void language sql security definer set search_path = '' as $$
  delete from private.intentos_login
   where usuario = (select usuario from public.perfiles where id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------- administración
create or replace function public.usuarios_admin()
returns table (id uuid, usuario text, nombre text, rol text, activo boolean, aprobado boolean, creado timestamptz,
               persona_id bigint, persona text, sugerida_id bigint, sugerida text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  return query
  select p.id, p.usuario, p.nombre, p.rol, p.activo, p.aprobado, p.creado,
         p.persona_id, pe.nombre, p.persona_sugerida_id, ps.nombre
    from public.perfiles p
    left join public.personas pe on pe.id = p.persona_id
    left join public.personas ps on ps.id = p.persona_sugerida_id
   order by p.aprobado, p.creado desc;
end;
$$;

-- Personas del horario sin cuenta (para enlazar)
create or replace function public.personas_sin_cuenta()
returns table (id bigint, nombre text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  return query
  select pe.id, pe.nombre from public.personas pe
   where pe.activo and not exists (select 1 from public.perfiles p where p.persona_id = pe.id)
   order by pe.nombre;
end;
$$;

-- Aprueba (o re-enlaza) una cuenta con su nombre del horario
create or replace function public.aprobar_usuario(p_perfil uuid, p_persona bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_p public.perfiles;
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  select * into v_p from public.perfiles where id = p_perfil for update;
  if not found then raise exception 'Cuenta no encontrada.'; end if;
  if p_persona is null or not exists (select 1 from public.personas where id = p_persona) then
    raise exception 'Elige el nombre del horario de esta persona.';
  end if;
  if exists (select 1 from public.perfiles where persona_id = p_persona and id <> p_perfil) then
    raise exception 'Ese nombre del horario ya está enlazado a otra cuenta.';
  end if;
  update public.perfiles set persona_id = p_persona, persona_sugerida_id = null, aprobado = true, activo = true
   where id = p_perfil;
  if not v_p.aprobado then
    insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
    values (p_perfil, 'cuenta_aprobada', '🎉 Tu cuenta fue aprobada', 'Ya puedes ver tu horario y la bolsa de cambios.', '/');
  end if;
end;
$$;

-- Activa / desactiva. Nadie se desactiva a sí mismo; solo el superadmin toca a un admin; nadie toca al superadmin.
create or replace function public.cambiar_estado_usuario(p_perfil uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_yo public.perfiles; v_d public.perfiles;
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  select * into v_yo from public.perfiles where id = (select auth.uid());
  select * into v_d from public.perfiles where id = p_perfil;
  if not found then raise exception 'Cuenta no encontrada.'; end if;
  if v_d.id = v_yo.id then raise exception 'No puedes desactivar tu propia cuenta.'; end if;
  if v_d.rol = 'superadmin' or (v_d.rol = 'admin' and v_yo.rol <> 'superadmin') then
    raise exception 'No tienes permiso para cambiar esta cuenta.';
  end if;
  update public.perfiles set activo = p_activo where id = p_perfil;
end;
$$;

-- Solo el superadmin nombra o quita administradores
create or replace function public.asignar_rol(p_perfil uuid, p_rol text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.perfiles where id = (select auth.uid()) and rol = 'superadmin' and activo) then
    raise exception 'Solo el superadministrador puede cambiar roles.';
  end if;
  if p_rol not in ('admin', 'usuario') then raise exception 'Rol no válido.'; end if;
  update public.perfiles set rol = p_rol where id = p_perfil and rol <> 'superadmin';
  if not found then raise exception 'No se puede cambiar el rol de esa cuenta.'; end if;
end;
$$;

-- ---------------------------------------------------------------- permisos
revoke all on function private.persona_de_nombre(text), private.notificar_admins(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.mi_cuenta(), public.login_estado(text), public.login_fallo(text), public.login_ok(),
  public.usuarios_admin(), public.personas_sin_cuenta(), public.aprobar_usuario(uuid, bigint),
  public.cambiar_estado_usuario(uuid, boolean), public.asignar_rol(uuid, text)
  from public, anon, authenticated;
grant execute on function public.login_estado(text), public.login_fallo(text) to anon, authenticated;
grant execute on function public.mi_cuenta(), public.login_ok(), public.usuarios_admin(), public.personas_sin_cuenta(),
  public.aprobar_usuario(uuid, bigint), public.cambiar_estado_usuario(uuid, boolean), public.asignar_rol(uuid, text)
  to authenticated;
