-- =====================================================================
-- CHAMBEA · 006 · Sugerencias de permuta, propuestas directas y lecturas de la bolsa
--  · "Pegados": dos turnos de PLANILLA con menos de N horas de descanso
--    (ajustes.min_descanso_planilla_h, 8 h por defecto). En días seguidos con
--    descanso normal SÍ se permite.
--  · Propuesta directa: permuta dirigida a una persona; no aparece en la bolsa.
-- =====================================================================

alter table public.ajustes
  add column min_descanso_planilla_h integer not null default 8 check (min_descanso_planilla_h between 0 and 24);

alter table public.solicitudes
  add column destino_persona_id bigint references public.personas(id) on delete cascade;
create index solicitudes_destino_idx on public.solicitudes (destino_persona_id);

-- ---------------------------------------------------------------- avisos
-- Todo lo que pasaría si p_persona recibe [p_inicio, p_fin) de la sección p_seccion:
--  cruce (con la misma sección = grave; con la otra = aviso), pegado de planilla, jornada larga
create or replace function private.avisos(
  p_persona bigint, p_inicio timestamptz, p_fin timestamptz, p_seccion text, p_excluir bigint[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_gap interval; v_pegados jsonb;
begin
  select make_interval(hours => min_descanso_planilla_h) into v_gap from public.ajustes where id = 1;
  v_pegados := '[]'::jsonb;
  if p_seccion = 'planilla' then
    select coalesce(jsonb_agg(jsonb_build_object('tipo', 'pegado', 'turno_id', t.id, 'fecha', t.fecha,
             'etiqueta', t.etiqueta, 'seccion', t.seccion) order by t.inicio), '[]'::jsonb)
      into v_pegados
      from public.turnos t
     where t.persona_id = p_persona and t.seccion = 'planilla' and not (t.id = any(p_excluir))
       and t.inicio < p_fin + v_gap and t.fin > p_inicio - v_gap
       and not (t.inicio < p_fin and t.fin > p_inicio);  -- los cruces van aparte
  end if;
  return private.choques(p_persona, p_inicio, p_fin, p_excluir) || v_pegados;
end;
$$;

-- ¿Algún aviso descarta la opción? (cruce con la misma sección o pegado de planilla)
create or replace function private.avisos_graves(p_avisos jsonb, p_seccion text)
returns boolean language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements(p_avisos) a
                  where a ->> 'tipo' = 'pegado'
                     or (a ->> 'tipo' = 'cruce' and a ->> 'seccion' = p_seccion));
$$;

-- ---------------------------------------------------------------- sugerencias
-- Para MI turno p_turno_id: turnos compatibles de otras personas en [p_desde, p_hasta]
-- donde ni yo ni la otra persona quedamos con cruces de la misma sección ni planilla pegada.
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
      'tiene_cuenta', c.tiene_cuenta, 'avisos_mios', c.mios, 'avisos_suyos', c.suyos)
      order by c.tiene_cuenta desc, c.inicio) filter (where not private.avisos_graves(c.mios, c.seccion)
                                                       and not private.avisos_graves(c.suyos, c.seccion)), '[]'::jsonb),
    count(*) filter (where private.avisos_graves(c.mios, c.seccion) or private.avisos_graves(c.suyos, c.seccion))
    into v_res, v_desc
    from cand c;

  return jsonb_build_object('opciones', v_res, 'descartadas', v_desc, 'desde', p_desde, 'hasta', p_hasta);
end;
$$;

-- ---------------------------------------------------------------- propuesta directa
create or replace function public.proponer_permuta(
  p_mi_turno bigint, p_su_turno bigint, p_nota text default null, p_confirmo_choque boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona(); v_a public.turnos; v_b public.turnos;
  v_av jsonb; v_sol bigint; v_of bigint;
begin
  select * into v_a from public.turnos where id = p_mi_turno for update;
  select * into v_b from public.turnos where id = p_su_turno for update;
  if v_a.id is null or v_a.persona_id <> v_p then raise exception 'Ese turno no es tuyo.'; end if;
  if v_b.id is null or v_b.persona_id = v_p then raise exception 'Elige un turno de otra persona.'; end if;
  if v_a.inicio <= now() or v_b.inicio <= now() then raise exception 'Uno de los turnos ya empezó o ya pasó.'; end if;
  if v_a.seccion <> v_b.seccion or v_a.funcion <> v_b.funcion then
    raise exception 'Los turnos no son compatibles (misma sección y función).';
  end if;
  if not exists (select 1 from public.perfiles where persona_id = v_b.persona_id and activo and aprobado) then
    raise exception 'Esa persona todavía no tiene cuenta en Chambea.';
  end if;
  if exists (select 1 from public.solicitudes where turno_id = v_a.id and estado in ('abierta', 'por_confirmar')) then
    raise exception 'Tu turno ya está en otra solicitud. Cancélala primero.';
  end if;

  v_av := private.avisos(v_p, v_b.inicio, v_b.fin, v_b.seccion, array[v_a.id, v_b.id]);
  if jsonb_array_length(v_av) > 0 and not p_confirmo_choque then
    return jsonb_build_object('ok', false, 'choques', v_av);
  end if;

  insert into public.solicitudes (seccion, tipo, persona_id, creado_por, turno_id, funcion, fechas, nota, estado, destino_persona_id)
  values (v_a.seccion, 'permuta', v_p, (select auth.uid()), v_a.id, v_a.funcion, array[v_b.fecha],
          nullif(trim(p_nota), ''), 'por_confirmar', v_b.persona_id)
  returning id into v_sol;
  insert into public.ofertas (solicitud_id, persona_id, turno_id, estado)
  values (v_sol, v_b.persona_id, v_b.id, 'elegida') returning id into v_of;
  update public.solicitudes set oferta_elegida_id = v_of where id = v_sol;

  perform private.notificar_persona(v_b.persona_id, 'propuesta', '📩 Te proponen un cambio',
    private.nombre_corto(v_p) || ' te da su ' || private.texto_turno(v_a.id) || ' por tu ' || private.texto_turno(v_b.id) || '.',
    '/?solicitud=' || v_sol);
  return jsonb_build_object('ok', true, 'solicitud_id', v_sol);
end;
$$;

-- ---------------------------------------------------------------- avisos con la regla de pegados
create or replace function public.choques_si_recibo(p_recibo bigint, p_entrego bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona(); v_t public.turnos;
begin
  select * into v_t from public.turnos where id = p_recibo;
  if not found then raise exception 'Ese turno ya no existe.'; end if;
  return private.avisos(v_p, v_t.inicio, v_t.fin, v_t.seccion, array_remove(array[p_entrego, p_recibo], null));
end;
$$;

create or replace function public.ofertar(
  p_solicitud_id bigint, p_turno_id bigint default null, p_nota text default null,
  p_confirmo_choque boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_s public.solicitudes; v_a public.turnos; v_b public.turnos;
  v_ch jsonb := '[]'::jsonb; v_id bigint;
begin
  select * into v_s from public.solicitudes where id = p_solicitud_id for update;
  if not found or v_s.estado <> 'abierta' or v_s.destino_persona_id is not null then
    raise exception 'Esa solicitud ya no está disponible.';
  end if;
  if v_s.persona_id = v_p then raise exception 'No puedes responder tu propia solicitud.'; end if;

  if v_s.tipo in ('permuta', 'busco') then
    if p_turno_id is null then raise exception 'Elige el turno que ofreces.'; end if;
    select * into v_b from public.turnos where id = p_turno_id;
    if not found or v_b.persona_id <> v_p then raise exception 'Ese turno no es tuyo.'; end if;
    if v_b.inicio <= now() then raise exception 'Ese turno ya empezó o ya pasó.'; end if;
    if v_b.seccion <> v_s.seccion or v_b.funcion <> v_s.funcion then
      raise exception 'Ese turno no es compatible (debe ser de la misma sección y función).';
    end if;
    if cardinality(v_s.fechas) > 0 and not (v_b.fecha = any(v_s.fechas)) then
      raise exception 'Esa fecha no está entre las que pidió.';
    end if;
  else
    p_turno_id := null;
    if not private.puede_tomar(v_p, v_s.seccion, v_s.funcion) then
      raise exception 'No puedes tomar turnos de ese tipo.';
    end if;
  end if;

  if v_s.tipo <> 'busco' then
    select * into v_a from public.turnos where id = v_s.turno_id;
    if not found or v_a.inicio <= now() then raise exception 'El turno de esa solicitud ya no está disponible.'; end if;
    v_ch := private.avisos(v_p, v_a.inicio, v_a.fin, v_a.seccion, array_remove(array[p_turno_id, v_a.id], null));
  end if;

  if jsonb_array_length(v_ch) > 0 and not p_confirmo_choque then
    return jsonb_build_object('ok', false, 'choques', v_ch);
  end if;

  insert into public.ofertas (solicitud_id, persona_id, creado_por, turno_id, nota, choques)
  values (p_solicitud_id, v_p, (select auth.uid()), p_turno_id, nullif(trim(p_nota), ''), v_ch)
  returning id into v_id;

  perform private.notificar_persona(v_s.persona_id, 'nueva_oferta', '🙋 Alguien respondió',
    private.nombre_corto(v_p) || coalesce(' ofrece ' || private.texto_turno(p_turno_id), ' puede tomar tu turno'),
    '/?solicitud=' || p_solicitud_id);
  return jsonb_build_object('ok', true, 'oferta_id', v_id, 'choques', v_ch);
end;
$$;

create or replace function public.elegir_oferta(p_oferta_id bigint, p_confirmo_choque boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_o public.ofertas; v_s public.solicitudes; v_b public.turnos; v_ch jsonb := '[]'::jsonb;
begin
  select * into v_o from public.ofertas where id = p_oferta_id;
  if not found then raise exception 'Esa respuesta ya no existe.'; end if;
  select * into v_s from public.solicitudes where id = v_o.solicitud_id for update;
  select * into v_o from public.ofertas where id = p_oferta_id for update;
  if v_s.persona_id <> v_p then raise exception 'Esa solicitud no es tuya.'; end if;
  if v_s.estado <> 'abierta' then raise exception 'Ya elegiste a alguien o la solicitud está cerrada.'; end if;
  if v_o.estado <> 'pendiente' then raise exception 'Esa respuesta ya no está disponible.'; end if;

  if v_s.tipo in ('permuta', 'busco') then
    select * into v_b from public.turnos where id = v_o.turno_id;
    if not found or v_b.inicio <= now() or v_b.persona_id <> v_o.persona_id then
      raise exception 'El turno ofrecido ya no está disponible.';
    end if;
    v_ch := private.avisos(v_p, v_b.inicio, v_b.fin, v_b.seccion, array_remove(array[v_s.turno_id, v_b.id], null));
  end if;

  if jsonb_array_length(v_ch) > 0 and not p_confirmo_choque then
    return jsonb_build_object('ok', false, 'choques', v_ch);
  end if;

  update public.ofertas set estado = 'elegida', actualizado = now() where id = p_oferta_id;
  update public.solicitudes set estado = 'por_confirmar', oferta_elegida_id = p_oferta_id, actualizado = now()
   where id = v_s.id;

  perform private.notificar_persona(v_o.persona_id, 'te_eligieron', '✅ Te eligieron',
    private.nombre_corto(v_p) || ' aceptó tu respuesta. Confirma para aplicar el cambio.',
    '/?solicitud=' || v_s.id);
  return jsonb_build_object('ok', true, 'choques', v_ch);
end;
$$;

create or replace function public.responder_eleccion(
  p_oferta_id bigint, p_acepta boolean, p_confirmo_choque boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_o public.ofertas; v_s public.solicitudes; v_a public.turnos; v_ch jsonb := '[]'::jsonb;
begin
  select * into v_o from public.ofertas where id = p_oferta_id;
  if not found or v_o.persona_id <> v_p then raise exception 'Esa respuesta no es tuya.'; end if;
  select * into v_s from public.solicitudes where id = v_o.solicitud_id for update;
  select * into v_o from public.ofertas where id = p_oferta_id for update;
  if v_o.estado <> 'elegida' or v_s.estado <> 'por_confirmar' then
    raise exception 'Ya no hay nada que confirmar aquí.';
  end if;

  if not p_acepta then
    if v_s.destino_persona_id is not null then  -- propuesta directa rechazada: se cierra
      update public.ofertas set estado = 'rechazada', actualizado = now() where id = p_oferta_id;
      update public.solicitudes set estado = 'cancelada', actualizado = now() where id = v_s.id;
      perform private.notificar_persona(v_s.persona_id, 'propuesta_rechazada', 'Propuesta rechazada',
        private.nombre_corto(v_p) || ' no aceptó tu propuesta de cambio.', '/?solicitud=' || v_s.id);
    else
      update public.ofertas set estado = 'retirada', actualizado = now() where id = p_oferta_id;
      update public.solicitudes set estado = 'abierta', oferta_elegida_id = null, actualizado = now()
       where id = v_s.id;
      perform private.notificar_persona(v_s.persona_id, 'eleccion_declinada', 'No se concretó',
        private.nombre_corto(v_p) || ' ya no puede. Tu solicitud volvió a estar abierta.', '/?solicitud=' || v_s.id);
    end if;
    return jsonb_build_object('ok', true, 'aplicado', false);
  end if;

  if v_s.tipo <> 'busco' then
    select * into v_a from public.turnos where id = v_s.turno_id;
    if found then
      v_ch := private.avisos(v_p, v_a.inicio, v_a.fin, v_a.seccion, array_remove(array[v_o.turno_id, v_a.id], null));
    end if;
  end if;
  if jsonb_array_length(v_ch) > 0 and not p_confirmo_choque then
    return jsonb_build_object('ok', false, 'choques', v_ch);
  end if;
  if jsonb_array_length(v_ch) > 0 then
    update public.ofertas set choques = v_ch where id = p_oferta_id;
  end if;

  perform private.aplicar_acuerdo(p_oferta_id);
  return jsonb_build_object('ok', true, 'aplicado', true);
end;
$$;

-- ---------------------------------------------------------------- lecturas para la app
create or replace function private.json_turno(p_id bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'seccion', t.seccion, 'fecha', t.fecha, 'inicio', t.inicio, 'fin', t.fin,
           'etiqueta', t.etiqueta, 'funcion', t.funcion, 'es_cambio', t.es_cambio, 'persona_id', t.persona_id)
    from public.turnos t where t.id = p_id;
$$;

-- Bolsa: solicitudes abiertas que YO puedo tomar (más las mías abiertas)
create or replace function public.bolsa(p_seccion text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'tipo', s.tipo, 'seccion', s.seccion, 'funcion', s.funcion, 'fechas', s.fechas, 'nota', s.nota,
      'creado', s.creado, 'mia', s.persona_id = v_p,
      'autor', private.nombre_corto(s.persona_id), 'autor_completo', pe.nombre,
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

-- Detalle de una solicitud (las respuestas completas solo las ve quien publicó)
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
    'mia', v_s.persona_id = v_p, 'autor', private.nombre_corto(v_s.persona_id),
    'autor_completo', (select nombre from public.personas where id = v_s.persona_id),
    'turno', private.json_turno(v_s.turno_id),
    'ofertas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'estado', o.estado, 'nota', o.nota, 'choques', o.choques, 'creado', o.creado,
        'mia', o.persona_id = v_p, 'persona', private.nombre_corto(o.persona_id),
        'persona_completo', pe.nombre, 'turno', private.json_turno(o.turno_id)) order by o.creado)
        from public.ofertas o join public.personas pe on pe.id = o.persona_id
       where o.solicitud_id = p_id and (v_s.persona_id = v_p or o.persona_id = v_p)), '[]'::jsonb),
    'respuestas', (select count(*) from public.ofertas o where o.solicitud_id = p_id and o.estado in ('pendiente', 'elegida')));
end;
$$;

-- Mis movimientos: lo que publiqué, a qué respondí, propuestas recibidas e historial de cambios
create or replace function public.mis_movimientos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona();
begin
  return jsonb_build_object(
    'publicadas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'tipo', s.tipo, 'seccion', s.seccion, 'estado', s.estado, 'creado', s.creado,
        'directa', s.destino_persona_id is not null,
        'destino', private.nombre_corto(s.destino_persona_id), 'turno', private.json_turno(s.turno_id), 'fechas', s.fechas,
        'respuestas', (select count(*) from public.ofertas o where o.solicitud_id = s.id and o.estado in ('pendiente', 'elegida')))
        order by s.creado desc)
      from public.solicitudes s where s.persona_id = v_p and s.creado > now() - interval '60 days'), '[]'::jsonb),
    'respondidas', coalesce((select jsonb_agg(jsonb_build_object(
        'oferta_id', o.id, 'estado', o.estado, 'solicitud_id', s.id, 'tipo', s.tipo, 'seccion', s.seccion,
        'directa', s.destino_persona_id is not null, 'solicitud_estado', s.estado,
        'autor', private.nombre_corto(s.persona_id), 'turno', private.json_turno(s.turno_id),
        'mi_turno', private.json_turno(o.turno_id), 'creado', o.creado) order by o.creado desc)
      from public.ofertas o join public.solicitudes s on s.id = o.solicitud_id
     where o.persona_id = v_p and o.creado > now() - interval '60 days'), '[]'::jsonb),
    'cambios', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'creado', c.creado, 'recibi', c.a_persona_id = v_p,
        'con', private.nombre_corto(case when c.a_persona_id = v_p then c.de_persona_id else c.a_persona_id end),
        'turno', private.json_turno(c.turno_id)) order by c.creado desc)
      from public.cambios c where (c.a_persona_id = v_p or c.de_persona_id = v_p) and not c.revertido), '[]'::jsonb));
end;
$$;

-- Ajustes (solo admin)
create or replace function public.guardar_ajustes(p_max_horas integer, p_min_descanso_planilla_h integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  update public.ajustes set max_horas_continuas = p_max_horas, min_descanso_planilla_h = p_min_descanso_planilla_h,
         actualizado = now() where id = 1;
end;
$$;

-- ---------------------------------------------------------------- permisos
revoke all on function private.avisos(bigint, timestamptz, timestamptz, text, bigint[]),
  private.avisos_graves(jsonb, text), private.json_turno(bigint) from public, anon, authenticated;
revoke all on function public.sugerir_permutas(bigint, date, date), public.proponer_permuta(bigint, bigint, text, boolean),
  public.bolsa(text), public.detalle_solicitud(bigint), public.mis_movimientos(), public.guardar_ajustes(integer, integer)
  from public, anon;
grant execute on function public.sugerir_permutas(bigint, date, date), public.proponer_permuta(bigint, bigint, text, boolean),
  public.bolsa(text), public.detalle_solicitud(bigint), public.mis_movimientos(), public.guardar_ajustes(integer, integer)
  to authenticated;
