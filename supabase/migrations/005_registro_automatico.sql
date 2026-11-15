-- =====================================================================
-- CHAMBEA · 005 · Registro sin aprobación
-- Si el nombre escrito corresponde a alguien del horario (y ese nombre no
-- tiene cuenta), la cuenta queda enlazada y activa al instante.
-- Si no, la persona puede volver a escribir su nombre (máx. 5 intentos)
-- o pedir a la administración que la enlace. Sin enlace no ve nada.
-- =====================================================================

alter table public.perfiles add column intentos_nombre integer not null default 0;

-- Solo ve datos quien está enlazado a su nombre del horario (o es admin)
create or replace function private.es_activo()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles
                  where id = (select auth.uid()) and activo and aprobado
                    and (persona_id is not null or rol in ('superadmin', 'admin')));
$$;

create or replace function private.nuevo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_nombre text; v_usuario text; v_p bigint;
begin
  v_nombre := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1));
  v_usuario := lower(trim(coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1))));
  v_p := private.persona_de_nombre(v_nombre);
  if v_p is not null and exists (select 1 from public.perfiles where persona_id = v_p) then
    v_p := null;  -- ese nombre ya tiene cuenta
  end if;

  insert into public.perfiles (id, usuario, nombre, persona_id, aprobado)
  values (new.id, v_usuario, v_nombre, v_p, v_p is not null);

  if v_p is not null then
    perform private.notificar_admins('cuenta_nueva', '👤 Cuenta nueva',
      v_nombre || ' (@' || v_usuario || ') quedó enlazado a ' || (select nombre from public.personas where id = v_p) || '.',
      '/?vista=usuarios');
  else
    perform private.notificar_admins('cuenta_nueva', '👤 Cuenta sin enlazar',
      v_nombre || ' (@' || v_usuario || ') se registró, pero no encontré su nombre en el horario.',
      '/?vista=usuarios');
  end if;
  return new;
end;
$$;

-- La persona vuelve a escribir su nombre para enlazarse sola
create or replace function public.reclamar_nombre(p_nombre text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_yo public.perfiles; v_p bigint; v_persona text;
begin
  select * into v_yo from public.perfiles where id = (select auth.uid()) for update;
  if not found or not v_yo.activo then raise exception 'Tu cuenta no está activa.'; end if;
  if v_yo.persona_id is not null then return jsonb_build_object('ok', true); end if;
  if v_yo.intentos_nombre >= 5 then
    raise exception 'Ya intentaste varias veces. Pide a la administración que enlace tu cuenta.';
  end if;
  if coalesce(cardinality(regexp_split_to_array(trim(p_nombre), '\s+')), 0) < 2 then
    raise exception 'Escribe tu nombre completo, como aparece en el horario.';
  end if;

  update public.perfiles set intentos_nombre = intentos_nombre + 1 where id = v_yo.id;
  v_p := private.persona_de_nombre(p_nombre);
  if v_p is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado', 'restantes', 4 - v_yo.intentos_nombre);
  end if;
  if exists (select 1 from public.perfiles where persona_id = v_p) then
    return jsonb_build_object('ok', false, 'motivo', 'ya_tiene_cuenta');
  end if;

  update public.perfiles set persona_id = v_p, aprobado = true, nombre = trim(p_nombre) where id = v_yo.id;
  select nombre into v_persona from public.personas where id = v_p;
  perform private.notificar_admins('cuenta_nueva', '👤 Cuenta enlazada',
    trim(p_nombre) || ' (@' || v_yo.usuario || ') quedó enlazado a ' || v_persona || '.', '/?vista=usuarios');
  return jsonb_build_object('ok', true, 'persona', v_persona);
end;
$$;

revoke all on function public.reclamar_nombre(text) from public, anon;
grant execute on function public.reclamar_nombre(text) to authenticated;
