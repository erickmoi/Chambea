-- =====================================================================
-- CHAMBEA · 007 · WhatsApp obligatorio, historial de horarios, vencimientos,
-- deshacer cambios y notificaciones push
-- =====================================================================
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------- WhatsApp (8 dígitos de El Salvador)
alter table public.perfiles add column telefono text check (telefono ~ '^[0-9]{8}$');

create or replace function private.telefono_de(p_persona bigint)
returns text language sql stable security definer set search_path = '' as $$
  select telefono from public.perfiles where persona_id = p_persona and activo and aprobado limit 1;
$$;

create or replace function public.guardar_telefono(p_telefono text)
returns void language plpgsql security definer set search_path = '' as $$
declare v text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
begin
  if v ~ '^503[0-9]{8}$' then v := substr(v, 4); end if;
  if v !~ '^[67][0-9]{7}$' then raise exception 'Escribe un número de WhatsApp de 8 dígitos (empieza con 6 o 7).'; end if;
  update public.perfiles set telefono = v where id = (select auth.uid());
end;
$$;

-- El registro guarda el WhatsApp que se escribió en el formulario
create or replace function private.nuevo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_nombre text; v_usuario text; v_p bigint; v_tel text;
begin
  v_nombre := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1));
  v_usuario := lower(trim(coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1))));
  v_tel := regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefono', ''), '\D', '', 'g');
  if v_tel ~ '^503[0-9]{8}$' then v_tel := substr(v_tel, 4); end if;
  if v_tel !~ '^[0-9]{8}$' then v_tel := null; end if;
  v_p := private.persona_de_nombre(v_nombre);
  if v_p is not null and exists (select 1 from public.perfiles where persona_id = v_p) then v_p := null; end if;

  insert into public.perfiles (id, usuario, nombre, persona_id, aprobado, telefono)
  values (new.id, v_usuario, v_nombre, v_p, v_p is not null, v_tel);

  if v_p is not null then
    perform private.notificar_admins('cuenta_nueva', '👤 Cuenta nueva',
      v_nombre || ' (@' || v_usuario || ') quedó enlazado a ' || (select nombre from public.personas where id = v_p) || '.', '/?vista=usuarios');
  else
    perform private.notificar_admins('cuenta_nueva', '👤 Cuenta sin enlazar',
      v_nombre || ' (@' || v_usuario || ') se registró, pero no encontré su nombre en el horario.', '/?vista=usuarios');
  end if;
  return new;
end;
$$;

create or replace function public.mi_cuenta()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'usuario', p.usuario, 'nombre', p.nombre, 'rol', p.rol, 'telefono', p.telefono,
    'activo', p.activo, 'aprobado', p.aprobado, 'tema', p.tema,
    'persona_id', p.persona_id, 'persona', pe.nombre,
    'es_supervisor', coalesce(pe.es_supervisor, false),
    'referencias_planilla', coalesce(pe.referencias_planilla, false),
    'referencias_sp', coalesce(pe.referencias_sp, false))
    from public.perfiles p left join public.personas pe on pe.id = p.persona_id
   where p.id = (select auth.uid());
$$;

drop function public.usuarios_admin();
create function public.usuarios_admin()
returns table (id uuid, usuario text, nombre text, rol text, activo boolean, aprobado boolean, creado timestamptz,
               persona_id bigint, persona text, sugerida_id bigint, sugerida text, telefono text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  return query
  select p.id, p.usuario, p.nombre, p.rol, p.activo, p.aprobado, p.creado,
         p.persona_id, pe.nombre, p.persona_sugerida_id, ps.nombre, p.telefono
    from public.perfiles p
    left join public.personas pe on pe.id = p.persona_id
    left join public.personas ps on ps.id = p.persona_sugerida_id
   order by p.aprobado, p.creado desc;
end;
$$;

-- ---------------------------------------------------------------- historial de horarios (archivo guardado)
alter table public.importaciones add column archivo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('horarios', 'horarios', false, 10485760,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do nothing;

create policy horarios_admin_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'horarios' and (select private.es_admin()));
create policy horarios_admin_leer on storage.objects for select to authenticated
  using (bucket_id = 'horarios' and (select private.es_admin()));

create or replace function public.adjuntar_archivo(p_importaciones bigint[], p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  update public.importaciones set archivo_path = p_path where id = any(p_importaciones);
end;
$$;

-- ---------------------------------------------------------------- vencimientos (cada hora)
create or replace function private.vencer()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_hoy date := (now() at time zone 'America/El_Salvador')::date;
begin
  with v as (
    update public.solicitudes s set estado = 'vencida', actualizado = now()
     where s.estado in ('abierta', 'por_confirmar')
       and ((s.turno_id is not null and exists (select 1 from public.turnos t where t.id = s.turno_id and t.inicio <= now()))
         or (s.turno_id is null and s.tipo = 'busco' and not exists (select 1 from unnest(s.fechas) f where f >= v_hoy)))
    returning s.id)
  update public.ofertas o set estado = 'rechazada', actualizado = now()
    from v where o.solicitud_id = v.id and o.estado in ('pendiente', 'elegida');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
select cron.schedule('chambea-vencer', '17 * * * *', 'select private.vencer()');

-- ---------------------------------------------------------------- deshacer un cambio
-- Si la jefatura no aprueba: cualquiera de los dos (o la administración) lo deshace,
-- mientras los turnos no hayan empezado y nadie los haya vuelto a cambiar.
create or replace function public.deshacer_cambio(p_cambio_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_p bigint := private.mi_persona(); v_c public.cambios; v_x record; v_admin boolean := private.es_admin();
begin
  select * into v_c from public.cambios where id = p_cambio_id;
  if not found or v_c.revertido then raise exception 'Ese cambio ya no se puede deshacer.'; end if;
  if not v_admin and v_p is distinct from v_c.de_persona_id and v_p is distinct from v_c.a_persona_id then
    raise exception 'Ese cambio no es tuyo.';
  end if;
  perform 1 from public.turnos t join public.cambios c on c.turno_id = t.id
   where (c.id = v_c.id or (v_c.oferta_id is not null and c.oferta_id = v_c.oferta_id)) and not c.revertido
   order by t.id for update of t;

  for v_x in select c.*, t.persona_id as actual, t.inicio from public.cambios c join public.turnos t on t.id = c.turno_id
              where (c.id = v_c.id or (v_c.oferta_id is not null and c.oferta_id = v_c.oferta_id)) and not c.revertido
  loop
    if v_x.actual <> v_x.a_persona_id or v_x.inicio <= now() then
      raise exception 'Uno de los turnos ya empezó o se volvió a cambiar; no se puede deshacer.';
    end if;
    update public.turnos set persona_id = v_x.de_persona_id, actualizado = now() where id = v_x.turno_id;
    update public.turnos set es_cambio = false, persona_original_id = null
     where id = v_x.turno_id and persona_original_id = persona_id;
    update public.cambios set revertido = true where id = v_x.id;
  end loop;

  perform private.notificar_persona(v_c.de_persona_id, 'cambio_deshecho', '↩️ Cambio deshecho',
    'Se deshizo el cambio con ' || private.nombre_corto(v_c.a_persona_id) || '. Revisa tu horario.', '/?vista=horario');
  perform private.notificar_persona(v_c.a_persona_id, 'cambio_deshecho', '↩️ Cambio deshecho',
    'Se deshizo el cambio con ' || private.nombre_corto(v_c.de_persona_id) || '. Revisa tu horario.', '/?vista=horario');
end;
$$;

-- ---------------------------------------------------------------- notificaciones push
create table public.push_suscripciones (
  id bigint generated always as identity primary key,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  creado timestamptz not null default now()
);
create index push_suscripciones_perfil_idx on public.push_suscripciones (perfil_id);
alter table public.push_suscripciones enable row level security;
revoke all on public.push_suscripciones from anon, authenticated;

-- URL de la función y token compartido (se llenan aparte, no van en el repo)
create table private.config_push (id integer primary key default 1 check (id = 1), url text not null, token text not null);

create or replace function public.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text)
returns void language sql security definer set search_path = '' as $$
  insert into public.push_suscripciones (perfil_id, endpoint, p256dh, auth)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set perfil_id = excluded.perfil_id, p256dh = excluded.p256dh, auth = excluded.auth;
$$;
create or replace function public.quitar_suscripcion(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_suscripciones where endpoint = p_endpoint and perfil_id = (select auth.uid());
$$;

-- Cada aviso nuevo se manda también como push (si la persona activó las notificaciones)
create or replace function private.enviar_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cfg private.config_push;
begin
  if not exists (select 1 from public.push_suscripciones where perfil_id = new.perfil_id) then return null; end if;
  select * into v_cfg from private.config_push where id = 1;
  if not found then return null; end if;
  perform net.http_post(
    url := v_cfg.url,
    body := jsonb_build_object('perfil_id', new.perfil_id, 'titulo', new.titulo, 'cuerpo', new.cuerpo, 'url', new.url, 'tag', new.tipo),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notif-token', v_cfg.token));
  return null;
end;
$$;
create trigger notificaciones_push after insert on public.notificaciones
for each row execute function private.enviar_push();

-- ---------------------------------------------------------------- lecturas con WhatsApp
create or replace function public.sugerir_permutas(p_turno_id bigint, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona(); v_a public.turnos;
  v_hoy date := (now() at time zone 'America/El_Salvador')::date;
  v_res jsonb; v_desc integer;
begin
  select * into v_a from public.turnos where id = p_turno_id;
  if not found or v_a.persona_id <> v_p then raise exception 'Ese turno no es tuyo.'; end if;
  if v_a.inicio <= now() then raise exception 'Ese turno ya empezó o ya pasó.'; end if;
  p_desde := greatest(coalesce(p_desde, v_a.fecha - 7), v_hoy);
  p_hasta := coalesce(p_hasta, v_a.fecha + 7);

  with cand as (
    select b.*, pe.nombre as persona_nombre,
           exists (select 1 from public.perfiles pf where pf.persona_id = b.persona_id and pf.activo and pf.aprobado) as tiene_cuenta,
           private.avisos(v_p, b.inicio, b.fin, b.seccion, array[v_a.id, b.id]) as mios,
           private.avisos(b.persona_id, v_a.inicio, v_a.fin, v_a.seccion, array[b.id, v_a.id]) as suyos
      from public.turnos b join public.personas pe on pe.id = b.persona_id
     where b.seccion = v_a.seccion and b.funcion = v_a.funcion and b.persona_id <> v_p
       and pe.activo and b.inicio > now() and b.fecha between p_desde and p_hasta
       and private.puede_tomar(v_p, b.seccion, b.funcion) and private.puede_tomar(b.persona_id, v_a.seccion, v_a.funcion)
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'turno_id', c.id, 'persona_id', c.persona_id, 'persona', c.persona_nombre,
      'fecha', c.fecha, 'inicio', c.inicio, 'fin', c.fin, 'etiqueta', c.etiqueta,
      'tiene_cuenta', c.tiene_cuenta, 'telefono', private.telefono_de(c.persona_id), 'avisos_mios', c.mios, 'avisos_suyos', c.suyos)
      order by c.tiene_cuenta desc, c.inicio) filter (where not private.avisos_graves(c.mios, c.seccion)
                                                       and not private.avisos_graves(c.suyos, c.seccion)), '[]'::jsonb),
    count(*) filter (where private.avisos_graves(c.mios, c.seccion) or private.avisos_graves(c.suyos, c.seccion))
    into v_res, v_desc
    from cand c;

  return jsonb_build_object('opciones', v_res, 'descartadas', v_desc, 'desde', p_desde, 'hasta', p_hasta);
end;
$$;

create or replace function public.bolsa(p_seccion text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'tipo', s.tipo, 'seccion', s.seccion, 'funcion', s.funcion, 'fechas', s.fechas, 'nota', s.nota,
      'creado', s.creado, 'mia', s.persona_id = v_p,
      'autor', private.nombre_corto(s.persona_id), 'autor_completo', pe.nombre, 'autor_tel', private.telefono_de(s.persona_id),
      'turno', private.json_turno(s.turno_id),
      'respuestas', (select count(*) from public.ofertas o where o.solicitud_id = s.id and o.estado in ('pendiente', 'elegida')),
      'mi_respuesta', (select o.estado from public.ofertas o where o.solicitud_id = s.id and o.persona_id = v_p
                        order by o.creado desc limit 1))
      order by coalesce((select t.inicio from public.turnos t where t.id = s.turno_id), s.fechas[1]::timestamptz))
      from public.solicitudes s join public.personas pe on pe.id = s.persona_id
     where s.seccion = p_seccion and s.estado = 'abierta' and s.destino_persona_id is null
       and (s.turno_id is null or exists (select 1 from public.turnos t where t.id = s.turno_id and t.inicio > now()))
       and (s.persona_id = v_p or private.puede_tomar(v_p, s.seccion, s.funcion))), '[]'::jsonb);
end;
$$;

create or replace function public.detalle_solicitud(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona(); v_s public.solicitudes; v_rel boolean;
begin
  select * into v_s from public.solicitudes where id = p_id;
  if not found then raise exception 'Esa solicitud no existe.'; end if;
  v_rel := v_s.persona_id = v_p or v_s.destino_persona_id = v_p
        or exists (select 1 from public.ofertas o where o.solicitud_id = p_id and o.persona_id = v_p);
  if not v_rel and (v_s.destino_persona_id is not null or not private.puede_tomar(v_p, v_s.seccion, v_s.funcion)) then
    raise exception 'No tienes acceso a esa solicitud.';
  end if;
  return jsonb_build_object(
    'id', v_s.id, 'tipo', v_s.tipo, 'seccion', v_s.seccion, 'funcion', v_s.funcion, 'fechas', v_s.fechas,
    'nota', v_s.nota, 'estado', v_s.estado, 'creado', v_s.creado, 'directa', v_s.destino_persona_id is not null,
    'mia', v_s.persona_id = v_p, 'autor', private.nombre_corto(v_s.persona_id), 'autor_tel', private.telefono_de(v_s.persona_id),
    'autor_completo', (select nombre from public.personas where id = v_s.persona_id),
    'turno', private.json_turno(v_s.turno_id),
    'ofertas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'estado', o.estado, 'nota', o.nota, 'choques', o.choques, 'creado', o.creado,
        'mia', o.persona_id = v_p, 'persona', private.nombre_corto(o.persona_id),
        'persona_completo', pe.nombre, 'telefono', private.telefono_de(o.persona_id), 'turno', private.json_turno(o.turno_id)) order by o.creado)
        from public.ofertas o join public.personas pe on pe.id = o.persona_id
       where o.solicitud_id = p_id and (v_s.persona_id = v_p or o.persona_id = v_p)), '[]'::jsonb),
    'respuestas', (select count(*) from public.ofertas o where o.solicitud_id = p_id and o.estado in ('pendiente', 'elegida')));
end;
$$;

create or replace function public.mis_movimientos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona();
begin
  return jsonb_build_object(
    'publicadas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'tipo', s.tipo, 'seccion', s.seccion, 'estado', s.estado, 'creado', s.creado,
        'directa', s.destino_persona_id is not null,
        'destino', private.nombre_corto(s.destino_persona_id), 'destino_tel', private.telefono_de(s.destino_persona_id), 'turno', private.json_turno(s.turno_id), 'fechas', s.fechas,
        'respuestas', (select count(*) from public.ofertas o where o.solicitud_id = s.id and o.estado in ('pendiente', 'elegida')))
        order by s.creado desc)
      from public.solicitudes s where s.persona_id = v_p and s.creado > now() - interval '60 days'), '[]'::jsonb),
    'respondidas', coalesce((select jsonb_agg(jsonb_build_object(
        'oferta_id', o.id, 'estado', o.estado, 'solicitud_id', s.id, 'tipo', s.tipo, 'seccion', s.seccion,
        'directa', s.destino_persona_id is not null, 'solicitud_estado', s.estado,
        'autor', private.nombre_corto(s.persona_id), 'autor_tel', private.telefono_de(s.persona_id), 'turno', private.json_turno(s.turno_id),
        'mi_turno', private.json_turno(o.turno_id), 'creado', o.creado) order by o.creado desc)
      from public.ofertas o join public.solicitudes s on s.id = o.solicitud_id
     where o.persona_id = v_p and o.creado > now() - interval '60 days'), '[]'::jsonb),
    'cambios', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'creado', c.creado, 'recibi', c.a_persona_id = v_p, 'oferta_id', c.oferta_id,
        'se_puede_deshacer', exists (select 1 from public.turnos t where t.id = c.turno_id and t.persona_id = c.a_persona_id and t.inicio > now()),
        'con', private.nombre_corto(case when c.a_persona_id = v_p then c.de_persona_id else c.a_persona_id end),
        'turno', private.json_turno(c.turno_id)) order by c.creado desc)
      from public.cambios c where (c.a_persona_id = v_p or c.de_persona_id = v_p) and not c.revertido), '[]'::jsonb));
end;
$$;
-- ---------------------------------------------------------------- permisos
revoke all on function private.telefono_de(bigint), private.vencer(), private.enviar_push() from public, anon, authenticated;
revoke all on function public.guardar_telefono(text), public.usuarios_admin(), public.adjuntar_archivo(bigint[], text),
  public.deshacer_cambio(bigint), public.guardar_suscripcion(text, text, text), public.quitar_suscripcion(text)
  from public, anon;
grant execute on function public.guardar_telefono(text), public.usuarios_admin(), public.adjuntar_archivo(bigint[], text),
  public.deshacer_cambio(bigint), public.guardar_suscripcion(text, text, text), public.quitar_suscripcion(text)
  to authenticated;
