-- 022 · Referencias por persona en planilla
-- La hoja de incidencias (diciembre) no marca referencias, así que todos quedaban como "triaje" y
-- una persona de referencias podía permutar con quien no lo es. Ahora, en planilla:
--  · supervisor → 'supervisor'; persona de referencias → 'referencias'; el resto → 'triaje'
--  · se aplica al insertar y también cuando la carga/sincronización vuelve a escribir la función
--  · triaje solo lo pueden tomar quienes NO son de referencias ni supervisores

create or replace function private.funcion_por_persona()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sup boolean; v_ref boolean;
begin
  if new.seccion = 'planilla' and new.funcion in ('triaje', 'referencias', 'supervisor') then
    select es_supervisor, referencias_planilla into v_sup, v_ref from public.personas where id = new.persona_id;
    if v_sup then new.funcion := 'supervisor';
    elsif v_ref then new.funcion := 'referencias';
    else new.funcion := 'triaje';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists turnos_funcion_persona on public.turnos;
create trigger turnos_funcion_persona before insert or update of funcion, persona_id on public.turnos
  for each row execute function private.funcion_por_persona();
revoke all on function private.funcion_por_persona() from public, anon, authenticated;

create or replace function private.puede_tomar(p_persona bigint, p_seccion text, p_funcion text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.activo and case
      when p_seccion = 'planilla' and p_funcion = 'supervisor'  then p.es_supervisor
      when p_seccion = 'planilla' and p_funcion = 'referencias' then p.referencias_planilla and not p.es_supervisor
      when p_seccion = 'planilla' and p_funcion = 'triaje'      then not p.es_supervisor and not p.referencias_planilla
      when p_seccion = 'sp'       and p_funcion = 'referencias' then p.referencias_sp
      when p_seccion = 'sp'       and p_funcion = 'general'     then true
      else false end
    from public.personas p where p.id = p_persona), false);
$$;

-- Corrige los turnos ya cargados (el disparador asigna la función correcta)
update public.turnos set funcion = funcion
 where seccion = 'planilla' and funcion in ('triaje', 'referencias');

-- Si la administración cambia a alguien a referencias / supervisor (o se lo quita), se ajustan sus turnos futuros
create or replace function private.funcion_al_cambiar_persona()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.turnos set funcion = funcion
   where persona_id = new.id and seccion = 'planilla' and funcion in ('triaje', 'referencias', 'supervisor')
     and inicio > now();
  return null;
end;
$$;
drop trigger if exists personas_funcion_turnos on public.personas;
create trigger personas_funcion_turnos after update of referencias_planilla, es_supervisor on public.personas
  for each row when (old.referencias_planilla is distinct from new.referencias_planilla
                     or old.es_supervisor is distinct from new.es_supervisor)
  execute function private.funcion_al_cambiar_persona();
revoke all on function private.funcion_al_cambiar_persona() from public, anon, authenticated;
