-- 021 · Al publicar una permuta, las fechas que aceptas deben ser posibles para ti
-- (no el mismo día, ni que te deje turnos cruzados, de planilla juntos o después de una noche)
create or replace function private.fechas_invalidas(p_persona bigint, p_turno bigint, p_fechas date[])
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_t public.turnos; v_f date; v_av jsonb; v_malas text[] := '{}';
begin
  select * into v_t from public.turnos where id = p_turno;
  foreach v_f in array coalesce(p_fechas, '{}') loop
    if v_f = v_t.fecha then v_malas := v_malas || (to_char(v_f, 'DD/MM') || ' (es el mismo día)'); continue; end if;
    v_av := private.avisos(p_persona, v_t.inicio + (v_f - v_t.fecha) * interval '1 day',
                           v_t.fin + (v_f - v_t.fecha) * interval '1 day', v_t.seccion, array[v_t.id]);
    if jsonb_array_length(v_av) > 0 then
      v_malas := v_malas || (to_char(v_f, 'DD/MM') || ' (' || lower(private.texto_aviso(v_av -> 0)) || ')');
    end if;
  end loop;
  return nullif(array_to_string(v_malas, ', '), '');
end;
$$;
revoke all on function private.fechas_invalidas(bigint, bigint, date[]) from public, anon, authenticated;

create or replace function public.publicar_solicitud(p_tipo text, p_turno_id bigint default null, p_seccion text default null,
  p_funcion text default null, p_fechas date[] default '{}', p_nota text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_t public.turnos; v_sec text; v_fun text; v_id bigint; v_malas text;
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
  v_malas := private.fechas_invalidas(v_p, p_turno_id, p_fechas);
  if v_malas is not null then
    raise exception 'No puedes recibir ese horario en: %. Quita esas fechas.', v_malas;
  end if;

  insert into public.solicitudes (seccion, tipo, persona_id, creado_por, turno_id, funcion, fechas, nota)
  values (v_sec, p_tipo, v_p, (select auth.uid()), p_turno_id, v_fun,
          coalesce(p_fechas, '{}'), nullif(trim(p_nota), ''))
  returning id into v_id;

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
