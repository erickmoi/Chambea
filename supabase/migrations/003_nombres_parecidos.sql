-- =====================================================================
-- CHAMBEA · 003 · Nombres parecidos = misma persona, y fusión de personas
-- Regla: si un nombre nuevo contiene (o está contenido en) las palabras de
-- UNA sola persona existente, es la misma. Si no, se compara por parecido
-- (trigramas >= 0.75) y solo se enlaza si hay un único candidato claro.
-- =====================================================================
create extension if not exists pg_trgm with schema extensions;

create or replace function private.similar_a(p_norm text)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_a text[] := regexp_split_to_array(p_norm, ' '); v_ids bigint[];
begin
  if p_norm is null or p_norm = '' then return null; end if;
  if cardinality(v_a) >= 2 then
    select array_agg(p.id) into v_ids from public.personas p
     where p.nombre_norm <> p_norm
       and (v_a <@ regexp_split_to_array(p.nombre_norm, ' ')
         or regexp_split_to_array(p.nombre_norm, ' ') <@ v_a);
    if cardinality(v_ids) = 1 then return v_ids[1]; end if;
    if cardinality(v_ids) > 1 then return null; end if;  -- ambiguo: que decida el admin
  end if;
  select array_agg(id order by s desc) into v_ids from (
    select p.id, extensions.similarity(p.nombre_norm, p_norm) s
      from public.personas p where extensions.similarity(p.nombre_norm, p_norm) >= 0.75) x;
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  return null;
end;
$$;

-- Une dos registros de la misma persona: todo lo de p_origen pasa a p_destino
create or replace function private.fusionar(p_origen bigint, p_destino bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_o public.personas; v_d public.personas;
begin
  if p_origen = p_destino then return; end if;
  select * into v_o from public.personas where id = p_origen for update;
  select * into v_d from public.personas where id = p_destino for update;
  if v_o.id is null or v_d.id is null then raise exception 'Persona no encontrada.'; end if;
  if exists (select 1 from public.perfiles where persona_id = p_origen)
     and exists (select 1 from public.perfiles where persona_id = p_destino) then
    raise exception 'Las dos personas ya tienen cuenta; revisa a mano.';
  end if;

  -- turnos repetidos (misma sección e inicio): se queda el del destino
  delete from public.turnos o using public.turnos d
   where o.persona_id = p_origen and d.persona_id = p_destino
     and o.seccion = d.seccion and o.inicio = d.inicio;
  update public.turnos set persona_id = p_destino where persona_id = p_origen;
  update public.turnos set persona_original_id = p_destino where persona_original_id = p_origen;
  update public.turnos set es_cambio = false, persona_original_id = null
   where persona_id = p_destino and persona_original_id = p_destino;
  update public.solicitudes set persona_id = p_destino where persona_id = p_origen;
  update public.ofertas set persona_id = p_destino where persona_id = p_origen;
  update public.cambios set de_persona_id = p_destino where de_persona_id = p_origen;
  update public.cambios set a_persona_id = p_destino where a_persona_id = p_origen;
  update public.perfiles set persona_id = p_destino where persona_id = p_origen;

  update public.personas set
    es_supervisor = v_d.es_supervisor or v_o.es_supervisor,
    referencias_planilla = v_d.referencias_planilla or v_o.referencias_planilla,
    referencias_sp = v_d.referencias_sp or v_o.referencias_sp
   where id = p_destino;

  update public.alias_personas set persona_id = p_destino where persona_id = p_origen;
  delete from public.personas where id = p_origen;
  insert into public.alias_personas (alias_norm, persona_id) values (v_o.nombre_norm, p_destino)
  on conflict (alias_norm) do update set persona_id = excluded.persona_id;
end;
$$;

create or replace function public.fusionar_personas(p_origen bigint, p_destino bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  perform private.fusionar(p_origen, p_destino);
end;
$$;

-- Vista previa con el nuevo criterio
create or replace function public.revisar_nombres(p_nombres text[])
returns table (nombre text, persona_id bigint, persona text, via text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  return query
  with x as (select nm, private.norm(nm) n from unnest(p_nombres) as u(nm)),
  m as (
    select x.nm,
           (select p.id from public.personas p where p.nombre_norm = x.n) as por_nombre,
           (select a.persona_id from public.alias_personas a where a.alias_norm = x.n) as por_alias,
           private.similar_a(x.n) as por_parecido
      from x)
  select m.nm, coalesce(m.por_nombre, m.por_alias, m.por_parecido), p.nombre,
         case when m.por_nombre is not null then 'nombre' when m.por_alias is not null then 'alias'
              when m.por_parecido is not null then 'parecido' else 'nueva' end
    from m left join public.personas p on p.id = coalesce(m.por_nombre, m.por_alias, m.por_parecido);
end;
$$;

-- Importador: igual que antes + enlace por parecido (y guarda el alias)
create or replace function private.importar(
  p_seccion text, p_desde date, p_hasta date, p_archivo text, p_filas jsonb,
  p_subido_por uuid, p_conservar_cambios boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_imp bigint; v_nuevas text[]; v_parecidos jsonb; v_borrados integer; v_insertados integer;
  v_total integer := jsonb_array_length(p_filas); v_cancel integer := 0; v_x record;
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

  delete from public.turnos where id in (select id from _borrar);
  get diagnostics v_borrados = row_count;

  -- 3) Insertar (omitiendo duplicados de turnos 🔁 conservados y repetidos de la hoja)
  insert into public.turnos (persona_id, seccion, fecha, inicio, fin, funcion, etiqueta, importacion_id)
  select f.persona_id, p_seccion, f.fecha, f.inicio, f.fin, f.funcion, f.etiqueta, v_imp
    from _f f
   where not exists (
     select 1 from public.turnos k
      where k.es_cambio and k.seccion = p_seccion and k.inicio = f.inicio and k.fin = f.fin
        and f.persona_id in (k.persona_id, k.persona_original_id))
  on conflict (persona_id, seccion, inicio) do nothing;
  get diagnostics v_insertados = row_count;

  update public.importaciones set resumen = jsonb_build_object(
    'filas', v_total, 'insertados', v_insertados, 'reemplazados', v_borrados,
    'omitidos', v_total - v_insertados, 'personas_nuevas', to_jsonb(v_nuevas),
    'enlazados_por_parecido', v_parecidos, 'solicitudes_canceladas', v_cancel)
   where id = v_imp;

  return (select resumen || jsonb_build_object('importacion_id', id) from public.importaciones where id = v_imp);
end;
$$;

revoke all on function private.similar_a(text), private.fusionar(bigint, bigint) from public, anon, authenticated;
revoke all on function public.fusionar_personas(bigint, bigint) from public, anon;
grant execute on function public.fusionar_personas(bigint, bigint) to authenticated;
