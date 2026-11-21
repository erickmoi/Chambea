-- =====================================================================
-- 011 · Reglas de permuta (se BLOQUEAN, ya no solo se advierten)
--  · Mismo horario: solo se permuta un turno por otro con la misma hora de
--    inicio y de fin (7–3 por 7–3, 6–6 por 6–6, 7–7 día por 7–7 día).
--    Aplica a Planilla y a Servicios Profesionales. Donaciones no aplican.
--  · Nunca dos turnos que se crucen.
--  · Planilla + planilla pegados: no (cualquier duración). Días seguidos sí.
--  · Servicios Profesionales pegados: solo si no son los dos de 12 h.
--  · Planilla + Servicios Profesionales pegados: sí, sin límite de horas.
--  "Pegado" = menos de ajustes.min_descanso_planilla_h horas entre uno y otro.
-- =====================================================================

-- '07:00–19:00' → '7 AM – 7 PM'
create or replace function private.texto_horario(p_etiqueta text)
returns text language sql immutable set search_path = '' as $$
  select string_agg(
           regexp_replace(ltrim(to_char(('2000-01-01 ' || x)::timestamp, 'HH12:MI'), '0'), ':00$', '') || ' ' || to_char(('2000-01-01 ' || x)::timestamp, 'AM'),
           ' – ' order by n)
    from unnest(regexp_split_to_array(p_etiqueta, '[–-]')) with ordinality as u(x, n);
$$;

-- Todo lo que impide que p_persona reciba [p_inicio, p_fin) de la sección p_seccion
create or replace function private.avisos(
  p_persona bigint, p_inicio timestamptz, p_fin timestamptz, p_seccion text, p_excluir bigint[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_gap interval; v_largo boolean := p_fin - p_inicio >= interval '11 hours';
begin
  select make_interval(hours => min_descanso_planilla_h) into v_gap from public.ajustes where id = 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tipo', case when t.inicio < p_fin and t.fin > p_inicio then 'cruce'
                          when p_seccion = 'planilla' then 'pegado' else 'pegado_sp' end,
             'turno_id', t.id, 'seccion', t.seccion, 'fecha', t.fecha, 'etiqueta', t.etiqueta) order by t.inicio)
      from public.turnos t
     where t.persona_id = p_persona and not (t.id = any(p_excluir))
       and t.inicio < p_fin + v_gap and t.fin > p_inicio - v_gap
       and (
         (t.inicio < p_fin and t.fin > p_inicio)                                         -- se cruzan
         or (p_seccion = 'planilla' and t.seccion = 'planilla')                          -- planilla pegada
         or (p_seccion = 'sp' and t.seccion = 'sp' and v_largo
             and t.fin - t.inicio >= interval '11 hours')                                -- SP 12 h + SP 12 h
       )), '[]'::jsonb);
end;
$$;

-- Ahora todo aviso descarta la opción
create or replace function private.avisos_graves(p_avisos jsonb, p_seccion text)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_array_length(coalesce(p_avisos, '[]'::jsonb)) > 0;
$$;

-- Si hay algún aviso, detiene la operación con un mensaje claro
create or replace function private.exigir_reglas(p_avisos jsonb, p_quien text default null)
returns void language plpgsql stable set search_path = '' as $$
declare v_a jsonb := p_avisos -> 0; v_sujeto text := coalesce(p_quien || ' quedaría', 'Te quedaría');
begin
  if v_a is null then return; end if;
  raise exception '%', case v_a ->> 'tipo'
    when 'cruce' then
      coalesce(p_quien || ': choca', 'Choca') || ' con un turno del ' || to_char((v_a ->> 'fecha')::date, 'DD/MM')
        || ' (' || private.texto_horario(v_a ->> 'etiqueta') || ').'
    when 'pegado' then
      v_sujeto || ' con dos turnos de planilla seguidos (' || to_char((v_a ->> 'fecha')::date, 'DD/MM') || ', '
        || private.texto_horario(v_a ->> 'etiqueta') || '). En planilla debe haber descanso entre turnos.'
    else
      v_sujeto || ' con dos turnos de 12 h de Servicios Profesionales seguidos (' || to_char((v_a ->> 'fecha')::date, 'DD/MM')
        || ', ' || private.texto_horario(v_a ->> 'etiqueta') || ').'
  end;
end;
$$;

-- ¿Puedo tomar esta solicitud? Para permutas: mis turnos con el mismo horario, en las fechas
-- que pidió (o cualquier fecha si no puso), sin cruces ni pegados para ninguno de los dos.
create or replace function private.viabilidad(p_yo bigint, p_solicitud bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_s public.solicitudes; v_a public.turnos; v_op jsonb; v_av jsonb; v_hay_horario boolean;
begin
  select * into v_s from public.solicitudes where id = p_solicitud;
  select * into v_a from public.turnos where id = v_s.turno_id;
  if v_a.id is null then return jsonb_build_object('estado', 'no', 'motivo', 'El turno ya no está disponible.'); end if;

  if v_s.tipo <> 'permuta' then
    v_av := private.avisos(p_yo, v_a.inicio, v_a.fin, v_a.seccion, array[v_a.id]);
    if jsonb_array_length(v_av) = 0 then return jsonb_build_object('estado', 'sirve'); end if;
    return jsonb_build_object('estado', 'no', 'motivo', case v_av -> 0 ->> 'tipo'
      when 'cruce' then 'Choca con tu turno del ' || to_char((v_av -> 0 ->> 'fecha')::date, 'DD/MM')
      when 'pegado' then 'Te quedarían dos turnos de planilla seguidos'
      else 'Te quedarían dos SP de 12 h seguidos' end);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'fecha', b.fecha, 'etiqueta', b.etiqueta) order by b.inicio), '[]'::jsonb)
    into v_op
    from public.turnos b
   where b.persona_id = p_yo and b.seccion = v_a.seccion and b.funcion = v_a.funcion and b.etiqueta = v_a.etiqueta
     and b.inicio > now() and b.id <> v_a.id
     and (cardinality(v_s.fechas) = 0 and b.fecha <= v_a.fecha + 45 or b.fecha = any(v_s.fechas))
     and not exists (select 1 from public.solicitudes x where x.turno_id = b.id and x.estado in ('abierta', 'por_confirmar'))
     and jsonb_array_length(private.avisos(p_yo, v_a.inicio, v_a.fin, v_a.seccion, array[v_a.id, b.id])) = 0
     and jsonb_array_length(private.avisos(v_s.persona_id, b.inicio, b.fin, b.seccion, array[v_a.id, b.id])) = 0;

  if jsonb_array_length(v_op) > 0 then return jsonb_build_object('estado', 'permutar', 'opciones', v_op); end if;

  select exists (select 1 from public.turnos b where b.persona_id = p_yo and b.seccion = v_a.seccion
                   and b.etiqueta = v_a.etiqueta and b.inicio > now()
                   and (cardinality(v_s.fechas) = 0 or b.fecha = any(v_s.fechas)))
    into v_hay_horario;
  return jsonb_build_object('estado', 'no', 'motivo', case
    when not v_hay_horario and cardinality(v_s.fechas) > 0
      then 'No tienes turnos de ' || private.texto_horario(v_a.etiqueta) || ' en esas fechas'
    when not v_hay_horario then 'No tienes turnos de ' || private.texto_horario(v_a.etiqueta)
    else 'Quedarían turnos seguidos o cruzados' end);
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
    if v_s.tipo = 'permuta' and v_b.etiqueta <> v_a.etiqueta then
      raise exception 'Solo se permuta el mismo horario: necesitas un turno de %.', private.texto_horario(v_a.etiqueta);
    end if;
    v_ch := private.avisos(v_p, v_a.inicio, v_a.fin, v_a.seccion, array_remove(array[p_turno_id, v_a.id], null));
    if v_s.tipo = 'permuta' then  -- la otra persona tampoco puede quedar con turnos pegados
      perform private.exigir_reglas(private.avisos(v_s.persona_id, v_b.inicio, v_b.fin, v_b.seccion, array[v_a.id, v_b.id]),
        private.nombre_corto(v_s.persona_id));
    end if;
  end if;

  perform private.exigir_reglas(v_ch, null);

  insert into public.ofertas (solicitud_id, persona_id, creado_por, turno_id, nota, choques)
  values (p_solicitud_id, v_p, (select auth.uid()), p_turno_id, nullif(trim(p_nota), ''), v_ch)
  returning id into v_id;

  perform private.notificar_persona(v_s.persona_id, 'nueva_oferta', 'Alguien respondió',
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

  perform private.exigir_reglas(v_ch, null);

  update public.ofertas set estado = 'elegida', actualizado = now() where id = p_oferta_id;
  update public.solicitudes set estado = 'por_confirmar', oferta_elegida_id = p_oferta_id, actualizado = now()
   where id = v_s.id;

  perform private.notificar_persona(v_o.persona_id, 'te_eligieron', 'Te eligieron',
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
  perform private.exigir_reglas(v_ch, null);

  perform private.aplicar_acuerdo(p_oferta_id);
  return jsonb_build_object('ok', true, 'aplicado', true);
end;
$$;

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
  if v_a.etiqueta <> v_b.etiqueta then
    raise exception 'Solo se permuta el mismo horario (%).', private.texto_horario(v_a.etiqueta);
  end if;
  if not exists (select 1 from public.perfiles where persona_id = v_b.persona_id and activo and aprobado) then
    raise exception 'Esa persona todavía no tiene cuenta en Chambea.';
  end if;
  if exists (select 1 from public.solicitudes where turno_id = v_a.id and estado in ('abierta', 'por_confirmar')) then
    raise exception 'Tu turno ya está en otra solicitud. Cancélala primero.';
  end if;

  perform private.exigir_reglas(private.avisos(v_p, v_b.inicio, v_b.fin, v_b.seccion, array[v_a.id, v_b.id]), null);
  perform private.exigir_reglas(private.avisos(v_b.persona_id, v_a.inicio, v_a.fin, v_a.seccion, array[v_a.id, v_b.id]),
    private.nombre_corto(v_b.persona_id));

  insert into public.solicitudes (seccion, tipo, persona_id, creado_por, turno_id, funcion, fechas, nota, estado, destino_persona_id)
  values (v_a.seccion, 'permuta', v_p, (select auth.uid()), v_a.id, v_a.funcion, array[v_b.fecha],
          nullif(trim(p_nota), ''), 'por_confirmar', v_b.persona_id)
  returning id into v_sol;
  insert into public.ofertas (solicitud_id, persona_id, turno_id, estado)
  values (v_sol, v_b.persona_id, v_b.id, 'elegida') returning id into v_of;
  update public.solicitudes set oferta_elegida_id = v_of where id = v_sol;

  perform private.notificar_persona(v_b.persona_id, 'propuesta', 'Te proponen un cambio',
    private.nombre_corto(v_p) || ' te da su ' || private.texto_turno(v_a.id) || ' por tu ' || private.texto_turno(v_b.id) || '.',
    '/?solicitud=' || v_sol);
  return jsonb_build_object('ok', true, 'solicitud_id', v_sol);
end;
$$;

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
       and b.etiqueta = v_a.etiqueta
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
                        order by o.creado desc limit 1),
      'viabilidad', case when s.persona_id = v_p then null else private.viabilidad(v_p, s.id) end)
      order by coalesce((select t.inicio from public.turnos t where t.id = s.turno_id), s.fechas[1]::timestamptz))
      from public.solicitudes s join public.personas pe on pe.id = s.persona_id
     where s.seccion = p_seccion and s.estado = 'abierta' and s.destino_persona_id is null
       and (s.turno_id is null or exists (select 1 from public.turnos t where t.id = s.turno_id and t.inicio > now()))
       and (s.persona_id = v_p or private.puede_tomar(v_p, s.seccion, s.funcion))), '[]'::jsonb);
end;
$$;

revoke all on function private.texto_horario(text), private.exigir_reglas(jsonb, text),
  private.viabilidad(bigint, bigint) from public, anon, authenticated;
