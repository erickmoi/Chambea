-- =====================================================================
-- 018 · Hojas de incidencias (GRUPOS | NOMBRE | fechas, sin área ni notas)
--  Al no traer la columna AREA, los supervisores se reconocen por la persona.
-- =====================================================================
create or replace function private.funcion_por_persona()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.seccion = 'planilla' and new.funcion = 'triaje'
     and exists (select 1 from public.personas where id = new.persona_id and es_supervisor) then
    new.funcion := 'supervisor';
  end if;
  return new;
end;
$$;
drop trigger if exists turnos_funcion_persona on public.turnos;
create trigger turnos_funcion_persona before insert on public.turnos
  for each row execute function private.funcion_por_persona();
revoke all on function private.funcion_por_persona() from public, anon, authenticated;
