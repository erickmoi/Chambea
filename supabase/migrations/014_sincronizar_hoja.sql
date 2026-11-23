-- =====================================================================
-- 014 · Carga inteligente y sincronización con la hoja oficial
--  · private.actualizar_hoja compara la hoja con lo que hay y solo cambia
--    lo necesario: pausas (almuerzo/cena/descanso), turnos nuevos y quitados.
--    Los turnos con permutas hechas en Chambea se conservan.
--  · La usan la carga manual del Excel y el puente de Google Apps Script
--    (función "sincronizar", cada hora).
-- =====================================================================
create table if not exists private.config_sync (id integer primary key default 1 check (id = 1), token text not null);

alter table public.ajustes
  add column if not exists sync_ultima timestamptz,
  add column if not exists sync_resumen jsonb;

create or replace function private.actualizar_hoja(
  p_seccion text, p_desde date, p_hasta date, p_filas jsonb,
  p_origen text, p_por uuid default null, p_incluir_pasado boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_desde_cambios date := case when p_incluir_pasado then p_desde
                               else greatest(p_desde, (now() at time zone 'America/El_Salvador')::date - 1) end;
  v_imp bigint; v_x record; v_cancel integer := 0; v_altas integer := 0; v_bajas integer := 0;
  v_pausas integer := 0; v_iguales integer := 0; v_avisados integer := 0; v_nuevas text[]; v_existentes integer;
begin
  if p_seccion not in ('planilla', 'sp') then raise exception 'Sección no válida.'; end if;
  drop table if exists _f, _par, _bajas, _altas, _pausas;

  create temp table _f on commit drop as
  select trim(regexp_replace(f ->> 'nombre', '\s+', ' ', 'g')) as nombre,
         (f ->> 'fecha')::date as fecha, (f ->> 'inicio')::timestamptz as inicio, (f ->> 'fin')::timestamptz as fin,
         f ->> 'funcion' as funcion, f ->> 'etiqueta' as etiqueta,
         nullif(f ->> 'comida', '') as comida, nullif(f ->> 'descanso', '') as descanso,
         coalesce((f ->> 'supervisor')::boolean, false) as supervisor,
         private.persona_de_nombre(f ->> 'nombre') as persona_id
    from jsonb_array_elements(p_filas) f
   where (f ->> 'fecha')::date between p_desde and p_hasta;

  -- Nombres que no existen: se crean (personal nuevo en la hoja)
  with nuevas as (
    insert into public.personas (nombre, nombre_norm)
    select distinct on (private.norm(nombre)) nombre, private.norm(nombre) from _f where persona_id is null
    on conflict (nombre_norm) do nothing returning nombre)
  select coalesce(array_agg(nombre), '{}') into v_nuevas from nuevas;
  update _f set persona_id = private.persona_de_nombre(nombre) where persona_id is null;
  delete from _f where persona_id is null;

  -- Seguridad: si la hoja viene casi vacía comparada con lo cargado, no se quita nada
  select count(*) into v_existentes from public.turnos
   where seccion = p_seccion and fecha between v_desde_cambios and p_hasta and not es_cambio;
  if v_existentes > 20 and (select count(*) from _f where fecha >= v_desde_cambios) < v_existentes * 0.5 then
    raise exception 'La hoja de % parece incompleta (% turnos contra % cargados). No se aplicó nada.',
      p_seccion, (select count(*) from _f where fecha >= v_desde_cambios), v_existentes;
  end if;

  update public.personas p set es_supervisor = true
   where p_seccion = 'planilla' and not p.es_supervisor and exists (select 1 from _f where _f.persona_id = p.id and _f.supervisor);
  update public.personas p set referencias_planilla = true
   where p_seccion = 'planilla' and not p.referencias_planilla and exists (select 1 from _f where _f.persona_id = p.id and _f.funcion = 'referencias');
  update public.personas p set referencias_sp = true
   where p_seccion = 'sp' and not p.referencias_sp and exists (select 1 from _f where _f.persona_id = p.id and _f.funcion = 'referencias');

  -- Emparejar: mismo horario y la persona es la dueña actual o la original (si hubo permuta)
  create temp table _par on commit drop as
  select distinct on (f.persona_id, f.inicio) f.*, t.id as turno_id, t.persona_id as titular,
         t.comida as comida_antes, t.descanso as descanso_antes, t.funcion as funcion_antes
    from _f f join public.turnos t
      on t.seccion = p_seccion and t.inicio = f.inicio and t.fin = f.fin
     and f.persona_id in (t.persona_id, t.persona_original_id)
   order by f.persona_id, f.inicio, t.es_cambio;

  select count(*) into v_iguales from _par
   where coalesce(comida, '') = coalesce(comida_antes, '') and coalesce(descanso, '') = coalesce(descanso_antes, '');

  -- 1) Pausas que cambiaron (un solo aviso por persona, con sus fechas)
  create temp table _pausas (persona_id bigint, fecha date, inicio timestamptz, comida text, descanso text) on commit drop;
  with upd as (
    update public.turnos t set comida = p.comida, descanso = p.descanso,
           funcion = case when t.es_cambio then t.funcion else p.funcion end
      from _par p
     where t.id = p.turno_id
       and (coalesce(p.comida, '') <> coalesce(p.comida_antes, '') or coalesce(p.descanso, '') <> coalesce(p.descanso_antes, ''))
    returning t.persona_id, t.fecha, t.inicio, t.comida, t.descanso)
  insert into _pausas select * from upd;
  select count(*) into v_pausas from _pausas;
  for v_x in
    select persona_id, count(*) as n, min(fecha) as primera,
           string_agg(to_char(fecha, 'DD/MM'), ', ' order by fecha) as fechas,
           (array_agg(comida order by fecha))[1] as comida, (array_agg(descanso order by fecha))[1] as descanso
      from _pausas where inicio > now() group by persona_id
  loop
    perform private.notificar_persona(v_x.persona_id, 'pausas_cambiadas',
      case when v_x.n = 1 then 'Cambió tu almuerzo/cena o descanso del ' || to_char(v_x.primera, 'DD/MM')
           else 'Cambiaron tus pausas en ' || v_x.n || ' turnos' end,
      case when v_x.n = 1 then concat_ws(' · ',
             case when v_x.comida is not null then
               case when split_part(v_x.comida, ':', 1)::int >= 17 or split_part(v_x.comida, ':', 1)::int < 5
                    then 'Cena ' else 'Almuerzo ' end || private.texto_horario(v_x.comida) end,
             case when v_x.descanso is not null then 'Descanso ' || private.texto_horario(v_x.descanso) end)
           else 'Fechas: ' || v_x.fechas || '. Revísalas en tu horario.' end,
      '/?vista=horario');
  end loop;

  create temp table _bajas on commit drop as
  select t.id, t.persona_id, t.fecha, t.etiqueta from public.turnos t
   where t.seccion = p_seccion and t.fecha between v_desde_cambios and p_hasta and not t.es_cambio
     and not exists (select 1 from _par where _par.turno_id = t.id);

  for v_x in update public.solicitudes set estado = 'cancelada', actualizado = now()
              where turno_id in (select id from _bajas) and estado in ('abierta', 'por_confirmar')
              returning id, persona_id
  loop
    v_cancel := v_cancel + 1;
    update public.ofertas set estado = 'rechazada', actualizado = now()
     where solicitud_id = v_x.id and estado in ('pendiente', 'elegida');
    perform private.notificar_persona(v_x.persona_id, 'solicitud_cancelada', 'Horario actualizado',
      'Tu turno cambió en la hoja oficial y tu solicitud se canceló.', '/?solicitud=' || v_x.id);
  end loop;
  for v_x in update public.ofertas set estado = 'retirada', actualizado = now()
              where turno_id in (select id from _bajas) and estado in ('pendiente', 'elegida')
              returning solicitud_id
  loop
    update public.solicitudes set estado = 'abierta', oferta_elegida_id = null, actualizado = now()
     where id = v_x.solicitud_id and estado = 'por_confirmar';
  end loop;
  delete from public.turnos where id in (select id from _bajas);
  get diagnostics v_bajas = row_count;

  -- 3) Turnos nuevos
  create temp table _altas on commit drop as
  select f.* from _f f
   where f.fecha >= v_desde_cambios
     and not exists (select 1 from _par where _par.persona_id = f.persona_id and _par.inicio = f.inicio);

  if v_bajas + (select count(*) from _altas) + v_pausas > 0 then
    insert into public.importaciones (seccion, desde, hasta, archivo, subido_por)
    values (p_seccion, p_desde, p_hasta, p_origen, p_por) returning id into v_imp;
  end if;

  insert into public.turnos (persona_id, seccion, fecha, inicio, fin, funcion, etiqueta, comida, descanso,
                             importacion_id, marcaje_avisado, inicio_avisado)
  select persona_id, p_seccion, fecha, inicio, fin, funcion, etiqueta, comida, descanso, v_imp, inicio <= now(), inicio <= now()
    from _altas
  on conflict (persona_id, seccion, inicio) do nothing;
  get diagnostics v_altas = row_count;

  -- 4) Aviso personal de horario cambiado (solo turnos que aún no pasan)
  for v_x in
    select persona_id, string_agg(distinct to_char(fecha, 'DD/MM'), ', ') as fechas from (
      select persona_id, fecha from _bajas where fecha >= (now() at time zone 'America/El_Salvador')::date
      union all
      select persona_id, fecha from _altas where inicio > now()) c
    group by persona_id
  loop
    v_avisados := v_avisados + 1;
    perform private.notificar_persona(v_x.persona_id, 'horario_cambiado',
      'Tu horario de ' || case p_seccion when 'sp' then 'Servicios Profesionales' else 'planilla' end || ' cambió',
      'Revisa: ' || v_x.fechas || '.', '/?vista=horario');
  end loop;

  if v_imp is not null then
    update public.importaciones set resumen = jsonb_build_object(
      'origen', p_origen, 'filas', (select count(*) from _f), 'insertados', v_altas, 'reemplazados', v_bajas,
      'pausas', v_pausas, 'omitidos', v_iguales, 'personas_nuevas', to_jsonb(v_nuevas),
      'enlazados_por_parecido', '[]'::jsonb, 'solicitudes_canceladas', v_cancel, 'personas_avisadas', v_avisados)
     where id = v_imp;
  end if;

  return jsonb_build_object('seccion', p_seccion, 'desde', p_desde, 'hasta', p_hasta, 'importacion_id', v_imp,
    'insertados', v_altas, 'reemplazados', v_bajas, 'pausas', v_pausas, 'omitidos', v_iguales,
    'personas_nuevas', to_jsonb(v_nuevas), 'enlazados_por_parecido', '[]'::jsonb,
    'solicitudes_canceladas', v_cancel, 'personas_avisadas', v_avisados);
end;
$$;

-- Carga manual del Excel: ahora también es inteligente (solo cambia lo necesario)
create or replace function public.importar_turnos(
  p_seccion text, p_desde date, p_hasta date, p_archivo text, p_filas jsonb,
  p_conservar_cambios boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración puede cargar horarios.'; end if;
  return private.actualizar_hoja(p_seccion, p_desde, p_hasta, p_filas, coalesce(p_archivo, 'Excel'), (select auth.uid()), true);
end;
$$;

-- Puente de Google Apps Script → función "sincronizar" (con la clave de servicio)
create or replace function public.sincronizar_hoja(p_token text, p_secciones jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s jsonb; v_res jsonb := '[]'::jsonb; v_r jsonb; v_cambios integer := 0;
begin
  if p_token is distinct from (select token from private.config_sync where id = 1) then
    raise exception 'Clave de sincronización no válida.';
  end if;
  for v_s in select * from jsonb_array_elements(p_secciones) loop
    begin
      v_r := private.actualizar_hoja(v_s ->> 'seccion', (v_s ->> 'desde')::date, (v_s ->> 'hasta')::date,
               v_s -> 'turnos', 'Hoja oficial (' || coalesce(v_s ->> 'hoja', '') || ')', null, false);
      v_cambios := v_cambios + (v_r ->> 'insertados')::int + (v_r ->> 'reemplazados')::int + (v_r ->> 'pausas')::int;
    exception when others then
      v_r := jsonb_build_object('seccion', v_s ->> 'seccion', 'hoja', v_s ->> 'hoja', 'error', sqlerrm);
    end;
    v_res := v_res || jsonb_build_array(v_r || jsonb_build_object('hoja', v_s ->> 'hoja'));
  end loop;
  update public.ajustes set sync_ultima = now(), sync_resumen = jsonb_build_object('secciones', v_res, 'cambios', v_cambios) where id = 1;
  if v_cambios > 0 then
    perform private.notificar_admins('sincronizacion', 'Horario sincronizado',
      (select string_agg(case r ->> 'seccion' when 'sp' then 'SP' else 'Planilla' end || ': '
         || (r ->> 'pausas') || ' pausas, ' || (r ->> 'insertados') || ' turnos nuevos, ' || (r ->> 'reemplazados') || ' quitados', ' · ')
         from jsonb_array_elements(v_res) r where r ? 'pausas'), '/?vista=admin');
  end if;
  return jsonb_build_object('ok', true, 'cambios', v_cambios, 'secciones', v_res);
end;
$$;

revoke all on function private.actualizar_hoja(text, date, date, jsonb, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.sincronizar_hoja(text, jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_hoja(text, jsonb) to service_role;
