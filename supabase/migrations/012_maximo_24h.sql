-- =====================================================================
-- 012 · Máximo 24 horas de trabajo seguidas (sumando cualquier contrato)
--  Planilla + Servicios Profesionales pegados se permite, pero el bloque
--  continuo no puede pasar de ajustes.max_horas_continuas (24 h).
--  "Seguido" = menos de ajustes.min_descanso_min (60 min) entre turnos.
-- =====================================================================
create or replace function private.avisos(
  p_persona bigint, p_inicio timestamptz, p_fin timestamptz, p_seccion text, p_excluir bigint[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_gap interval; v_largo boolean := p_fin - p_inicio >= interval '11 hours'; v_res jsonb;
begin
  select make_interval(hours => min_descanso_planilla_h) into v_gap from public.ajustes where id = 1;
  v_res := coalesce((
    select jsonb_agg(jsonb_build_object(
             'tipo', case when t.inicio < p_fin and t.fin > p_inicio then 'cruce'
                          when p_seccion = 'planilla' then 'pegado' else 'pegado_sp' end,
             'turno_id', t.id, 'seccion', t.seccion, 'fecha', t.fecha, 'etiqueta', t.etiqueta) order by t.inicio)
      from public.turnos t
     where t.persona_id = p_persona and not (t.id = any(p_excluir))
       and t.inicio < p_fin + v_gap and t.fin > p_inicio - v_gap
       and (
         (t.inicio < p_fin and t.fin > p_inicio)
         or (p_seccion = 'planilla' and t.seccion = 'planilla')
         or (p_seccion = 'sp' and t.seccion = 'sp' and v_largo
             and t.fin - t.inicio >= interval '11 hours')
       )), '[]'::jsonb);
  -- Jornada continua de más de 24 h (cualquier contrato)
  return v_res || coalesce((
    select jsonb_agg(x) from jsonb_array_elements(private.choques(p_persona, p_inicio, p_fin, p_excluir)) x
     where x ->> 'tipo' = 'jornada_larga'), '[]'::jsonb);
end;
$$;

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
    when 'jornada_larga' then
      coalesce(p_quien || ' tendría', 'Tendrías') || ' ' || round((v_a ->> 'horas')::numeric) || ' horas de trabajo seguidas. El máximo es 24 h.'
    else
      v_sujeto || ' con dos turnos de 12 h de Servicios Profesionales seguidos (' || to_char((v_a ->> 'fecha')::date, 'DD/MM')
        || ', ' || private.texto_horario(v_a ->> 'etiqueta') || ').'
  end;
end;
$$;

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
      when 'jornada_larga' then 'Pasarías de 24 h de trabajo seguidas'
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
