-- =====================================================================
-- 009 · Paquete "Inicio": comida y descanso de cada turno, aviso de
-- horario cambiado, recordatorio de GeoVictoria, pendientes, panel admin
-- y tiempo real para los avisos.
-- =====================================================================

-- ---------------------------------------------------------------- columnas nuevas
alter table public.turnos
  add column if not exists comida text,            -- '13:30–14:30'
  add column if not exists descanso text,          -- '17:30–18:00'
  add column if not exists marcaje_avisado boolean not null default false;
update public.turnos set marcaje_avisado = true where inicio <= now();
create index if not exists turnos_marcaje_idx on public.turnos (inicio)
  where seccion = 'planilla' and not marcaje_avisado;
create index if not exists turnos_fecha_idx on public.turnos (fecha);

alter table public.perfiles
  add column if not exists recordar_marcaje boolean not null default true;

-- ---------------------------------------------------------------- importar (con comida/descanso y aviso de cambios)
create or replace function private.importar(
  p_seccion text, p_desde date, p_hasta date, p_archivo text, p_filas jsonb,
  p_subido_por uuid, p_conservar_cambios boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_imp bigint; v_nuevas text[]; v_parecidos jsonb; v_borrados integer; v_insertados integer;
  v_total integer := jsonb_array_length(p_filas); v_cancel integer := 0; v_x record;
  v_habia boolean; v_avisados integer := 0;
begin
  if p_seccion not in ('planilla', 'sp') then raise exception 'Sección no válida.'; end if;
  if p_hasta < p_desde then raise exception 'Rango de fechas no válido.'; end if;

  create temp table _f on commit drop as
  select trim(regexp_replace(f ->> 'nombre', '\s+', ' ', 'g')) as nombre,
         private.norm(f ->> 'nombre') as n,
         (f ->> 'fecha')::date as fecha,
         (f ->> 'inicio')::timestamptz as inicio,
         (f ->> 'fin')::timestamptz as fin,
         f ->> 'funcion' as funcion,
         f ->> 'etiqueta' as etiqueta,
         nullif(f ->> 'comida', '') as comida,
         nullif(f ->> 'descanso', '') as descanso,
         coalesce((f ->> 'supervisor')::boolean, false) as supervisor,
         null::bigint as persona_id
    from jsonb_array_elements(p_filas) f;

  if exists (select 1 from _f where fecha < p_desde or fecha > p_hasta) then
    raise exception 'Hay filas fuera del rango % a %.', p_desde, p_hasta;
  end if;

  -- 1) Personas: nombre exacto → alias → nombre parecido → nueva
  update _f set persona_id = p.id from public.personas p where p.nombre_norm = _f.n;
  update _f set persona_id = a.persona_id from public.alias_personas a
   where _f.persona_id is null and a.alias_norm = _f.n;

  create temp table _par on commit drop as
  select distinct _f.n, _f.nombre, private.similar_a(_f.n) as persona_id from _f where _f.persona_id is null;
  delete from _par where persona_id is null;
  insert into public.alias_personas (alias_norm, persona_id)
  select n, persona_id from _par on conflict (alias_norm) do nothing;
  update _f set persona_id = _par.persona_id from _par where _f.persona_id is null and _f.n = _par.n;
  select coalesce(jsonb_agg(jsonb_build_object('hoja', _par.nombre, 'persona', p.nombre)), '[]'::jsonb)
    into v_parecidos from _par join public.personas p on p.id = _par.persona_id;

  -- Dentro del mismo archivo: un nombre corto contenido en UNO más largo = misma persona
  create temp table _dup on commit drop as
  select a.n as n_corto, min(b.n) as n_largo
    from (select distinct n from _f where persona_id is null) a
    join (select distinct n from _f where persona_id is null) b
      on a.n <> b.n and cardinality(regexp_split_to_array(a.n, ' ')) >= 2
     and regexp_split_to_array(a.n, ' ') <@ regexp_split_to_array(b.n, ' ')
   group by a.n having count(*) = 1;
  update _f set n = d.n_largo, nombre = (select f2.nombre from _f f2 where f2.n = d.n_largo limit 1)
    from _dup d where _f.n = d.n_corto;

  with nuevas as (
    insert into public.personas (nombre, nombre_norm)
    select distinct on (n) nombre, n from _f where persona_id is null order by n, nombre
    on conflict (nombre_norm) do nothing
    returning nombre)
  select coalesce(array_agg(nombre order by nombre), '{}') into v_nuevas from nuevas;
  update _f set persona_id = p.id from public.personas p where _f.persona_id is null and p.nombre_norm = _f.n;
  insert into public.alias_personas (alias_norm, persona_id)
  select d.n_corto, p.id from _dup d join public.personas p on p.nombre_norm = d.n_largo
  on conflict (alias_norm) do nothing;
  v_parecidos := v_parecidos || coalesce((select jsonb_agg(jsonb_build_object('hoja', d.n_corto, 'persona', p.nombre))
    from _dup d join public.personas p on p.nombre_norm = d.n_largo), '[]'::jsonb);

  update public.personas p set es_supervisor = true
   where p_seccion = 'planilla' and not p.es_supervisor
     and exists (select 1 from _f where _f.persona_id = p.id and _f.supervisor);
  update public.personas p set referencias_planilla = true
   where p_seccion = 'planilla' and not p.referencias_planilla
     and exists (select 1 from _f where _f.persona_id = p.id and _f.funcion = 'referencias');
  update public.personas p set referencias_sp = true
   where p_seccion = 'sp' and not p.referencias_sp
     and exists (select 1 from _f where _f.persona_id = p.id and _f.funcion = 'referencias');

  insert into public.importaciones (seccion, desde, hasta, archivo, subido_por)
  values (p_seccion, p_desde, p_hasta, p_archivo, p_subido_por) returning id into v_imp;

  -- 2) Reemplazo del rango: primero cerrar lo que dependa de esos turnos
  create temp table _borrar on commit drop as
  select id from public.turnos
   where seccion = p_seccion and fecha between p_desde and p_hasta
     and not (p_conservar_cambios and es_cambio);

  for v_x in update public.solicitudes set estado = 'cancelada', actualizado = now()
              where turno_id in (select id from _borrar) and estado in ('abierta', 'por_confirmar')
              returning id, persona_id
  loop
    v_cancel := v_cancel + 1;
    update public.ofertas set estado = 'rechazada', actualizado = now()
     where solicitud_id = v_x.id and estado in ('pendiente', 'elegida');
    perform private.notificar_persona(v_x.persona_id, 'solicitud_cancelada', 'Horario actualizado',
      'Se cargó un horario nuevo y tu solicitud se canceló porque el turno cambió.', '/?solicitud=' || v_x.id);
  end loop;
  for v_x in update public.ofertas set estado = 'retirada', actualizado = now()
              where turno_id in (select id from _borrar) and estado in ('pendiente', 'elegida')
              returning solicitud_id
  loop
    update public.solicitudes set estado = 'abierta', oferta_elegida_id = null, actualizado = now()
     where id = v_x.solicitud_id and estado = 'por_confirmar';
  end loop;

  -- Foto de lo que había, para avisar a cada quien si su horario cambió
  create temp table _antes on commit drop as
  select persona_id, inicio, fin from public.turnos where id in (select id from _borrar);
  v_habia := exists (select 1 from _antes);

  delete from public.turnos where id in (select id from _borrar);
  get diagnostics v_borrados = row_count;

  -- 3) Insertar (omitiendo duplicados de turnos de cambio conservados y repetidos de la hoja)
  insert into public.turnos (persona_id, seccion, fecha, inicio, fin, funcion, etiqueta, comida, descanso, importacion_id, marcaje_avisado)
  select f.persona_id, p_seccion, f.fecha, f.inicio, f.fin, f.funcion, f.etiqueta, f.comida, f.descanso, v_imp, f.inicio <= now()
    from _f f
   where not exists (
     select 1 from public.turnos k
      where k.es_cambio and k.seccion = p_seccion and k.inicio = f.inicio and k.fin = f.fin
        and f.persona_id in (k.persona_id, k.persona_original_id))
  on conflict (persona_id, seccion, inicio) do nothing;
  get diagnostics v_insertados = row_count;

  -- Aviso personal: "Tu horario cambió" (solo si ya había horario cargado en ese rango)
  if v_habia then
    for v_x in
      with nuevo as (select persona_id, inicio, fin from public.turnos where importacion_id = v_imp),
      dif as ((select * from _antes except select * from nuevo) union (select * from nuevo except select * from _antes))
      select persona_id, count(distinct (inicio at time zone 'America/El_Salvador')::date) as dias,
             string_agg(distinct to_char(inicio at time zone 'America/El_Salvador', 'DD/MM'), ', ') as fechas
        from dif group by persona_id
    loop
      v_avisados := v_avisados + 1;
      perform private.notificar_persona(v_x.persona_id, 'horario_cambiado',
        'Tu horario de ' || case p_seccion when 'sp' then 'Servicios Profesionales' else 'planilla' end || ' cambió',
        case when v_x.dias <= 6 then 'Revisa: ' || v_x.fechas || '.' else v_x.dias || ' días distintos. Revisa tu horario.' end,
        '/?vista=horario');
    end loop;
  end if;

  update public.importaciones set resumen = jsonb_build_object(
    'filas', v_total, 'insertados', v_insertados, 'reemplazados', v_borrados,
    'omitidos', v_total - v_insertados, 'personas_nuevas', to_jsonb(v_nuevas),
    'enlazados_por_parecido', v_parecidos, 'solicitudes_canceladas', v_cancel, 'personas_avisadas', v_avisados)
   where id = v_imp;

  return (select resumen || jsonb_build_object('importacion_id', id) from public.importaciones where id = v_imp);
end;
$$;




-- ---------------------------------------------------------------- lo que me toca responder
create or replace function public.pendientes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona();
begin
  return coalesce((select jsonb_agg(x order by x->>'creado') from (
    -- Me eligieron (o me propusieron directo): debo aceptar o rechazar
    select jsonb_build_object('tipo', 'confirmar', 'solicitud_id', s.id, 'tipo_solicitud', s.tipo,
             'seccion', s.seccion, 'directa', s.destino_persona_id is not null,
             'de', private.nombre_corto(s.persona_id), 'turno', private.json_turno(s.turno_id),
             'mi_turno', private.json_turno(o.turno_id), 'creado', o.actualizado) as x
      from public.ofertas o join public.solicitudes s on s.id = o.solicitud_id
     where o.persona_id = v_p and o.estado = 'elegida' and s.estado = 'por_confirmar'
    union all
    -- Mis solicitudes abiertas con respuestas: debo elegir
    select jsonb_build_object('tipo', 'elegir', 'solicitud_id', s.id, 'tipo_solicitud', s.tipo,
             'seccion', s.seccion, 'turno', private.json_turno(s.turno_id), 'fechas', s.fechas,
             'respuestas', (select count(*) from public.ofertas o where o.solicitud_id = s.id and o.estado = 'pendiente'),
             'creado', s.actualizado)
      from public.solicitudes s
     where s.persona_id = v_p and s.estado = 'abierta'
       and exists (select 1 from public.ofertas o where o.solicitud_id = s.id and o.estado = 'pendiente')
  ) q), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- panel del admin
create or replace function public.panel_admin()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mes date := date_trunc('month', now() at time zone 'America/El_Salvador')::date;
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  return jsonb_build_object(
    'personas', (select count(*) from public.personas where activo),
    'con_cuenta', (select count(*) from public.personas pe where pe.activo
                     and exists (select 1 from public.perfiles p where p.persona_id = pe.id and p.activo)),
    'cuentas', (select count(*) from public.perfiles where activo),
    'sin_enlazar', (select count(*) from public.perfiles where activo and persona_id is null and rol = 'usuario'),
    'abiertas', (select count(*) from public.solicitudes where estado in ('abierta', 'por_confirmar')),
    'cambios_mes', (select count(*) from public.cambios where not revertido
                      and (creado at time zone 'America/El_Salvador')::date >= v_mes),
    'cambios_mes_planilla', (select count(*) from public.cambios c join public.turnos t on t.id = c.turno_id
                      where not c.revertido and t.seccion = 'planilla'
                        and (c.creado at time zone 'America/El_Salvador')::date >= v_mes),
    'hasta_planilla', (select max(fecha) from public.turnos where seccion = 'planilla'),
    'hasta_sp', (select max(fecha) from public.turnos where seccion = 'sp'),
    'ultima_carga', (select max(creado) from public.importaciones),
    'recordar_carga_dias', (select recordar_carga_dias from public.ajustes where id = 1));
end;
$$;

-- ---------------------------------------------------------------- tiempo real para la campanita
do $$ begin
  alter publication supabase_realtime add table public.notificaciones;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- permisos
revoke all on function public.pendientes(), public.panel_admin() from public, anon;
grant execute on function public.pendientes(), public.panel_admin() to authenticated;

-- =====================================================================
-- Ajustes: generales (admin) y personales (cada usuario)
-- =====================================================================
alter table public.ajustes
  add column if not exists registro_abierto boolean not null default true,
  add column if not exists geovictoria_activo boolean not null default true,
  add column if not exists edicion_turnos text not null default 'todos' check (edicion_turnos in ('todos', 'admin')),
  add column if not exists recordar_carga_dias integer not null default 4 check (recordar_carga_dias between 1 and 15),
  add column if not exists anuncio text check (char_length(anuncio) <= 280),
  add column if not exists anuncio_hasta date;

alter table public.perfiles
  add column if not exists marcaje_min integer not null default 15 check (marcaje_min in (5, 10, 15, 20, 30)),
  add column if not exists avisar_bolsa boolean not null default true;

-- Turnos corregidos a mano (cuando la hoja tenía un error)
alter table public.turnos
  add column if not exists corregido_por uuid references public.perfiles(id) on delete set null,
  add column if not exists corregido timestamptz;

-- Recordatorio GeoVictoria: con los minutos que eligió cada quien y si el admin lo tiene activo
create or replace function private.recordar_marcaje()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select geovictoria_activo from public.ajustes where id = 1), true) then
    update public.turnos set marcaje_avisado = true
     where seccion = 'planilla' and not marcaje_avisado and inicio <= now() + interval '30 minutes';
    return;
  end if;
  with prox as (
    select t.id, t.inicio, pf.id as perfil
      from public.turnos t
      join public.perfiles pf on pf.persona_id = t.persona_id and pf.activo and pf.aprobado and pf.recordar_marcaje
     where t.seccion = 'planilla' and not t.marcaje_avisado
       and t.inicio > now() and t.inicio <= now() + make_interval(mins => pf.marcaje_min)),
  marcados as (
    update public.turnos set marcaje_avisado = true where id in (select id from prox) returning id)
  insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
  select p.perfil, 'marcaje', 'Marca tu entrada en GeoVictoria',
         'Tu turno de planilla empieza a las '
           || ltrim(to_char(p.inicio at time zone 'America/El_Salvador', 'HH12:MI'), '0') || ' '
           || to_char(p.inicio at time zone 'America/El_Salvador', 'AM') || '.',
         '/?vista=inicio'
    from prox p where p.id in (select id from marcados);
  update public.turnos set marcaje_avisado = true
   where seccion = 'planilla' and not marcaje_avisado and inicio <= now();
end;
$$;

-- Preferencias personales que viven en la base (avisos)
create or replace function public.guardar_preferencias(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.perfiles set
    recordar_marcaje = coalesce((p ->> 'recordar_marcaje')::boolean, recordar_marcaje),
    marcaje_min = coalesce((p ->> 'marcaje_min')::integer, marcaje_min),
    avisar_bolsa = coalesce((p ->> 'avisar_bolsa')::boolean, avisar_bolsa)
   where id = (select auth.uid());
end;
$$;

-- Ajustes generales (solo admin)
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
    actualizado = now()
   where id = 1;
end;
$$;

-- Registro: si el admin lo cierra, las cuentas nuevas esperan aprobación
create or replace function private.nuevo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_nombre text; v_usuario text; v_p bigint; v_tel text;
        v_abierto boolean := coalesce((select registro_abierto from public.ajustes where id = 1), true);
begin
  v_nombre := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1));
  v_usuario := lower(trim(coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1))));
  v_tel := regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefono', ''), '\D', '', 'g');
  if v_tel ~ '^503[0-9]{8}$' then v_tel := substr(v_tel, 4); end if;
  if v_tel !~ '^[0-9]{8}$' then v_tel := null; end if;
  v_p := private.persona_de_nombre(v_nombre);
  if v_p is not null and exists (select 1 from public.perfiles where persona_id = v_p) then v_p := null; end if;

  insert into public.perfiles (id, usuario, nombre, persona_id, aprobado, telefono, persona_sugerida_id)
  values (new.id, v_usuario, v_nombre, case when v_abierto then v_p end, v_p is not null and v_abierto, v_tel,
          case when not v_abierto then v_p end);

  if v_p is not null and v_abierto then
    perform private.notificar_admins('cuenta_nueva', 'Cuenta nueva',
      v_nombre || ' (@' || v_usuario || ') quedó enlazado a ' || (select nombre from public.personas where id = v_p) || '.', '/?vista=admin');
  elsif not v_abierto then
    perform private.notificar_admins('cuenta_nueva', 'Cuenta por aprobar',
      v_nombre || ' (@' || v_usuario || ') se registró y espera tu aprobación (registro cerrado).', '/?vista=admin');
  else
    perform private.notificar_admins('cuenta_nueva', 'Cuenta sin enlazar',
      v_nombre || ' (@' || v_usuario || ') se registró, pero no encontré su nombre en el horario.', '/?vista=admin');
  end if;
  return new;
end;
$$;

-- Corregir o quitar un turno que vino mal en la hoja
create or replace function private.puede_editar_turno(v_t public.turnos)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.es_admin()
      or (v_t.persona_id = private.mi_persona()
          and coalesce((select edicion_turnos from public.ajustes where id = 1), 'todos') = 'todos');
$$;

create or replace function public.corregir_turno(
  p_turno_id bigint, p_inicio text, p_fin text, p_comida text default null, p_descanso text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.turnos; v_ini timestamptz; v_fin timestamptz; v_fecha_fin date;
begin
  select * into v_t from public.turnos where id = p_turno_id for update;
  if not found then raise exception 'Ese turno no existe.'; end if;
  if not private.puede_editar_turno(v_t) then raise exception 'No puedes corregir este turno.'; end if;
  if p_inicio !~ '^\d{2}:\d{2}$' or p_fin !~ '^\d{2}:\d{2}$' then raise exception 'Hora no válida.'; end if;
  if exists (select 1 from public.solicitudes where turno_id = p_turno_id and estado in ('abierta', 'por_confirmar'))
     or exists (select 1 from public.ofertas where turno_id = p_turno_id and estado in ('pendiente', 'elegida')) then
    raise exception 'Este turno está en una permuta abierta. Cancélala primero.';
  end if;
  v_fecha_fin := case when p_fin <= p_inicio then v_t.fecha + 1 else v_t.fecha end;
  v_ini := (v_t.fecha::text || ' ' || p_inicio || ':00-06')::timestamptz;
  v_fin := (v_fecha_fin::text || ' ' || p_fin || ':00-06')::timestamptz;
  if exists (select 1 from public.turnos where persona_id = v_t.persona_id and seccion = v_t.seccion
              and inicio = v_ini and id <> v_t.id) then
    raise exception 'Ya tienes ese turno registrado ese día.';
  end if;
  update public.turnos set inicio = v_ini, fin = v_fin, etiqueta = p_inicio || '–' || p_fin,
         comida = nullif(p_comida, ''), descanso = nullif(p_descanso, ''),
         marcaje_avisado = v_ini <= now(), corregido_por = (select auth.uid()), corregido = now()
   where id = p_turno_id;
  if not private.es_admin() then
    perform private.notificar_admins('turno_corregido', 'Turno corregido',
      private.nombre_corto(v_t.persona_id) || ' corrigió su turno del ' || to_char(v_t.fecha, 'DD/MM') || ': '
        || v_t.etiqueta || ' → ' || p_inicio || '–' || p_fin || '.', '/?vista=admin');
  end if;
end;
$$;

create or replace function public.quitar_turno(p_turno_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.turnos;
begin
  select * into v_t from public.turnos where id = p_turno_id for update;
  if not found then raise exception 'Ese turno no existe.'; end if;
  if not private.puede_editar_turno(v_t) then raise exception 'No puedes quitar este turno.'; end if;
  if exists (select 1 from public.solicitudes where turno_id = p_turno_id and estado in ('abierta', 'por_confirmar'))
     or exists (select 1 from public.ofertas where turno_id = p_turno_id and estado in ('pendiente', 'elegida')) then
    raise exception 'Este turno está en una permuta abierta. Cancélala primero.';
  end if;
  if exists (select 1 from public.cambios where turno_id = p_turno_id and not revertido) then
    raise exception 'Este turno viene de un cambio. Deshaz el cambio en Permutas → Míos.';
  end if;
  delete from public.turnos where id = p_turno_id;
  if not private.es_admin() then
    perform private.notificar_admins('turno_corregido', 'Turno quitado',
      private.nombre_corto(v_t.persona_id) || ' quitó su turno del ' || to_char(v_t.fecha, 'DD/MM') || ' (' || v_t.etiqueta || ').', '/?vista=admin');
  end if;
end;
$$;

-- mi_cuenta con preferencias y si puede corregir turnos
create or replace function public.mi_cuenta()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'usuario', p.usuario, 'nombre', p.nombre, 'rol', p.rol, 'telefono', p.telefono,
    'activo', p.activo, 'aprobado', p.aprobado, 'tema', p.tema,
    'recordar_marcaje', p.recordar_marcaje, 'marcaje_min', p.marcaje_min, 'avisar_bolsa', p.avisar_bolsa,
    'puede_corregir', p.rol in ('admin', 'superadmin')
                      or coalesce((select edicion_turnos from public.ajustes where id = 1), 'todos') = 'todos',
    'persona_id', p.persona_id, 'persona', pe.nombre,
    'es_supervisor', coalesce(pe.es_supervisor, false),
    'referencias_planilla', coalesce(pe.referencias_planilla, false),
    'referencias_sp', coalesce(pe.referencias_sp, false))
    from public.perfiles p left join public.personas pe on pe.id = p.persona_id
   where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------- publicar: planilla solo permutas; SP permutas y donaciones
create or replace function public.publicar_solicitud(
  p_tipo text, p_turno_id bigint default null, p_seccion text default null,
  p_funcion text default null, p_fechas date[] default '{}', p_nota text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_t public.turnos; v_sec text; v_fun text; v_id bigint;
  v_hoy date := (now() at time zone 'America/El_Salvador')::date;
  v_destino record;
begin
  if p_tipo not in ('permuta', 'ceder') then
    raise exception 'Solo se pueden publicar permutas (y donaciones en Servicios Profesionales).';
  end if;

    if p_turno_id is null then raise exception 'Elige el turno.'; end if;
    select * into v_t from public.turnos where id = p_turno_id for update;
    if not found or v_t.persona_id <> v_p then raise exception 'Ese turno no es tuyo.'; end if;
    if v_t.inicio <= now() then raise exception 'Ese turno ya empezó o ya pasó.'; end if;
    if exists (select 1 from public.solicitudes
                where turno_id = p_turno_id and estado in ('abierta', 'por_confirmar')) then
      raise exception 'Ese turno ya está publicado.';
    end if;
    v_sec := v_t.seccion; v_fun := v_t.funcion;
    if p_tipo = 'ceder' and v_sec <> 'sp' then
      raise exception 'En planilla solo se hacen permutas.';
    end if;
    if p_tipo <> 'permuta' then p_fechas := '{}'; end if;

  if exists (select 1 from unnest(p_fechas) f where f < v_hoy) then
    raise exception 'Hay fechas que ya pasaron.';
  end if;

  insert into public.solicitudes (seccion, tipo, persona_id, creado_por, turno_id, funcion, fechas, nota)
  values (v_sec, p_tipo, v_p, (select auth.uid()), p_turno_id, v_fun,
          coalesce(p_fechas, '{}'), nullif(trim(p_nota), ''))
  returning id into v_id;

  -- Aviso a quienes podrían responder
  for v_destino in
    select pe.id as persona from public.personas pe
     where pe.id <> v_p and private.puede_tomar(pe.id, v_sec, v_fun)
       and exists (select 1 from public.perfiles pf where pf.persona_id = pe.id and pf.avisar_bolsa)
  loop
    perform private.notificar_persona(v_destino.persona, 'nueva_solicitud',
      case p_tipo when 'permuta' then 'Permuta' else 'Donación de turno' end
        || case v_sec when 'sp' then ' · Servicios Profesionales' else ' · Planilla' end,
      private.nombre_corto(v_p) || coalesce(': ' || private.texto_turno(p_turno_id), ''),
      '/?solicitud=' || v_id);
  end loop;
  return v_id;
end;
$$;

revoke all on function private.puede_editar_turno(public.turnos), private.recordar_marcaje() from public, anon, authenticated;
revoke all on function public.guardar_preferencias(jsonb), public.guardar_ajustes_generales(jsonb),
  public.corregir_turno(bigint, text, text, text, text), public.quitar_turno(bigint) from public, anon;
grant execute on function public.guardar_preferencias(jsonb), public.guardar_ajustes_generales(jsonb),
  public.corregir_turno(bigint, text, text, text, text), public.quitar_turno(bigint) to authenticated;

-- ---------------------------------------------------------------- recordatorio GeoVictoria: cada minuto
select cron.schedule('chambea-marcaje', '* * * * *', 'select private.recordar_marcaje()');
