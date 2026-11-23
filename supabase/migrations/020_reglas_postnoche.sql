-- 020 · Reglas por pares de turnos (misma persona)
--  · cruce: se traslapan.
--  · postnoche (cualquier contrato): después de un turno que pasa la medianoche, ese día no se entra a otro
--    turno que empiece antes de las 5 PM (no se puede noche y luego mañana).
--  · pegado (planilla + planilla): un solo turno de planilla por día y al menos 12 h entre ellos
--    (11 h si son días distintos, por la mezcla 7–7 / 6–6). Antes un 11 AM–11 PM + 7 AM se colaba: arreglado.
--  · pegado_sp (SP + SP): solo se bloquean dos SP de 12 h pegados. Con hueco o en el mismo día, se permite.
--  · Planilla + SP: se permiten pegados o con hueco (salvo cruce, postnoche y el máximo de 24 h seguidas).

create or replace function private.choque_par(a_ini timestamptz, a_fin timestamptz, a_sec text,
                                              b_ini timestamptz, b_fin timestamptz, b_sec text,
                                              p_gap_p interval, p_gap_sp interval)
returns text language plpgsql immutable set search_path = '' as $$
declare
  x_ini timestamptz; x_fin timestamptz; x_sec text; y_ini timestamptz; y_fin timestamptz; y_sec text;
  v_hueco interval; tz constant text := 'America/El_Salvador';
begin
  if a_ini < b_fin and a_fin > b_ini then return 'cruce'; end if;
  -- x = el que va primero
  if a_ini <= b_ini then x_ini := a_ini; x_fin := a_fin; x_sec := a_sec; y_ini := b_ini; y_fin := b_fin; y_sec := b_sec;
  else x_ini := b_ini; x_fin := b_fin; x_sec := b_sec; y_ini := a_ini; y_fin := a_fin; y_sec := a_sec; end if;
  v_hueco := y_ini - x_fin;

  -- después de una noche, nada ese mismo día antes de las 5 PM
  if (x_fin at time zone tz)::date > (x_ini at time zone tz)::date
     and (y_ini at time zone tz)::date = (x_fin at time zone tz)::date
     and extract(hour from (y_ini at time zone tz)) < 17 then
    return 'postnoche';
  end if;

  if x_sec = 'planilla' and y_sec = 'planilla' then
    if (x_ini at time zone tz)::date = (y_ini at time zone tz)::date then return 'pegado'; end if;
    if v_hueco < p_gap_p - interval '1 hour' then return 'pegado'; end if;
    return null;
  end if;

  if x_sec = 'sp' and y_sec = 'sp' and v_hueco < p_gap_sp
     and x_fin - x_ini >= interval '11 hours' and y_fin - y_ini >= interval '11 hours' then
    return 'pegado_sp';
  end if;
  return null;
end;
$$;

create or replace function private.avisos(p_persona bigint, p_inicio timestamptz, p_fin timestamptz, p_seccion text,
                                          p_excluir bigint[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_gap_p interval; v_gap_sp interval; v_res jsonb;
begin
  select make_interval(hours => min_descanso_planilla_h), make_interval(mins => min_descanso_min)
    into v_gap_p, v_gap_sp from public.ajustes where id = 1;

  select coalesce(jsonb_agg(jsonb_build_object('tipo', c.tipo, 'turno_id', c.id, 'seccion', c.seccion,
                                               'fecha', c.fecha, 'etiqueta', c.etiqueta) order by c.inicio), '[]'::jsonb)
    into v_res
    from (select t.*, private.choque_par(t.inicio, t.fin, t.seccion, p_inicio, p_fin, p_seccion, v_gap_p, v_gap_sp) as tipo
            from public.turnos t
           where t.persona_id = p_persona and not (t.id = any(p_excluir))
             and t.inicio < p_fin + interval '36 hours' and t.fin > p_inicio - interval '36 hours') c
   where c.tipo is not null;

  return v_res || coalesce((
    select jsonb_agg(x) from jsonb_array_elements(private.choques(p_persona, p_inicio, p_fin, p_excluir)) x
     where x ->> 'tipo' = 'jornada_larga'), '[]'::jsonb);
end;
$$;

create or replace function private.exigir_reglas(p_avisos jsonb, p_quien text default null)
returns void language plpgsql stable set search_path = '' as $$
declare v_a jsonb := p_avisos -> 0; v_sujeto text := coalesce(p_quien || ' quedaría', 'Te quedaría');
  v_cuando text;
begin
  if v_a is null then return; end if;
  v_cuando := to_char((v_a ->> 'fecha')::date, 'DD/MM') || ', ' || private.texto_horario(v_a ->> 'etiqueta');
  raise exception '%', case v_a ->> 'tipo'
    when 'cruce' then coalesce(p_quien || ': choca', 'Choca') || ' con un turno del ' || v_cuando || '.'
    when 'postnoche' then v_sujeto || ' un turno de día después de una noche (' || v_cuando
      || '). Después de una noche no se trabaja ese mismo día.'
    when 'pegado' then v_sujeto || ' con dos turnos de planilla muy juntos (' || v_cuando
      || '). En planilla: un turno por día y 12 h de descanso.'
    when 'jornada_larga' then coalesce(p_quien || ' tendría', 'Tendrías') || ' '
      || round((v_a ->> 'horas')::numeric) || ' horas de trabajo seguidas. El máximo es 24 h.'
    else v_sujeto || ' con dos turnos de 12 h de Servicios Profesionales seguidos (' || v_cuando || ').'
  end;
end;
$$;

-- Motivo en la tarjeta de Permutas (solo cambia el texto de los tipos)
create or replace function private.texto_aviso(p_av jsonb)
returns text language sql immutable set search_path = '' as $$
  select case p_av ->> 'tipo'
    when 'cruce' then 'Choca con tu turno del ' || to_char((p_av ->> 'fecha')::date, 'DD/MM')
    when 'postnoche' then 'Quedaría un turno de día después de una noche'
    when 'pegado' then 'Te quedarían dos turnos de planilla muy juntos'
    when 'jornada_larga' then 'Pasarías de 24 h de trabajo seguidas'
    else 'Te quedarían dos SP de 12 h seguidos' end;
$$;

create or replace function private.viabilidad(p_yo bigint, p_solicitud bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_s public.solicitudes; v_a public.turnos; v_op jsonb; v_av jsonb; v_hay_horario boolean; v_solo_mismo boolean;
begin
  select * into v_s from public.solicitudes where id = p_solicitud;
  select * into v_a from public.turnos where id = v_s.turno_id;
  if v_a.id is null then return jsonb_build_object('estado', 'no', 'motivo', 'El turno ya no está disponible.'); end if;

  if v_s.tipo <> 'permuta' then
    v_av := private.avisos(p_yo, v_a.inicio, v_a.fin, v_a.seccion, array[v_a.id]);
    if jsonb_array_length(v_av) = 0 then return jsonb_build_object('estado', 'sirve'); end if;
    return jsonb_build_object('estado', 'no', 'motivo', private.texto_aviso(v_av -> 0));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'fecha', b.fecha, 'etiqueta', b.etiqueta) order by b.inicio), '[]'::jsonb)
    into v_op
    from public.turnos b
   where b.persona_id = p_yo and b.seccion = v_a.seccion and b.funcion = v_a.funcion and b.etiqueta = v_a.etiqueta
     and b.inicio > now() and b.id <> v_a.id and b.fecha <> v_a.fecha
     and (cardinality(v_s.fechas) = 0 and b.fecha <= v_a.fecha + 45 or b.fecha = any(v_s.fechas))
     and not exists (select 1 from public.solicitudes x where x.turno_id = b.id and x.estado in ('abierta', 'por_confirmar'))
     and jsonb_array_length(private.avisos(p_yo, v_a.inicio, v_a.fin, v_a.seccion, array[v_a.id, b.id])) = 0
     and jsonb_array_length(private.avisos(v_s.persona_id, b.inicio, b.fin, b.seccion, array[v_a.id, b.id])) = 0;

  if jsonb_array_length(v_op) > 0 then return jsonb_build_object('estado', 'permutar', 'opciones', v_op); end if;

  select exists (select 1 from public.turnos b where b.persona_id = p_yo and b.seccion = v_a.seccion
                   and b.funcion = v_a.funcion and b.etiqueta = v_a.etiqueta and b.inicio > now()
                   and (cardinality(v_s.fechas) = 0 or b.fecha = any(v_s.fechas))),
         exists (select 1 from public.turnos b where b.persona_id = p_yo and b.seccion = v_a.seccion
                   and b.funcion = v_a.funcion and b.etiqueta = v_a.etiqueta and b.inicio > now() and b.fecha = v_a.fecha)
         and not exists (select 1 from public.turnos b where b.persona_id = p_yo and b.seccion = v_a.seccion
                   and b.funcion = v_a.funcion and b.etiqueta = v_a.etiqueta and b.inicio > now() and b.fecha <> v_a.fecha
                   and (cardinality(v_s.fechas) = 0 or b.fecha = any(v_s.fechas)))
    into v_hay_horario, v_solo_mismo;
  return jsonb_build_object('estado', 'no', 'motivo', case
    when v_solo_mismo then 'Ya tienes ese mismo turno ese día'
    when not v_hay_horario and cardinality(v_s.fechas) > 0
      then 'No tienes turnos de ' || private.texto_horario(v_a.etiqueta) || ' en esas fechas'
    when not v_hay_horario then 'No tienes turnos de ' || private.texto_horario(v_a.etiqueta)
    else 'A alguno de los dos le quedarían turnos juntos, cruzados o después de una noche' end);
end;
$$;

revoke all on function private.choque_par(timestamptz, timestamptz, text, timestamptz, timestamptz, text, interval, interval),
  private.texto_aviso(jsonb) from public, anon, authenticated;
