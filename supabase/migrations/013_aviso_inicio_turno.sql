-- =====================================================================
-- 013 · Aviso al empezar el turno con la hora de almuerzo/cena y descanso
-- =====================================================================
alter table public.turnos add column if not exists inicio_avisado boolean not null default false;
update public.turnos set inicio_avisado = true where inicio <= now();
create index if not exists turnos_inicio_aviso_idx on public.turnos (inicio) where not inicio_avisado;

alter table public.perfiles add column if not exists avisar_pausas boolean not null default true;

create or replace function private.avisar_inicio_turno()
returns void language plpgsql security definer set search_path = '' as $$
begin
  with por_avisar as (
    update public.turnos set inicio_avisado = true
     where not inicio_avisado and inicio <= now()
    returning id, persona_id, seccion, inicio, etiqueta, comida, descanso)
  insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
  select pf.id, 'inicio_turno',
         'Empezó tu turno · ' || private.texto_horario(t.etiqueta),
         concat_ws(' · ',
           case when t.comida is not null then
             case when split_part(t.comida, ':', 1)::int >= 17 or split_part(t.comida, ':', 1)::int < 5
                  then 'Cena ' else 'Almuerzo ' end || private.texto_horario(t.comida) end,
           case when t.descanso is not null then 'Descanso ' || private.texto_horario(t.descanso) end),
         '/?vista=inicio'
    from por_avisar t
    join public.perfiles pf on pf.persona_id = t.persona_id and pf.activo and pf.aprobado and pf.avisar_pausas
   where t.inicio > now() - interval '15 minutes'
     and (t.comida is not null or t.descanso is not null);
end;
$$;
revoke all on function private.avisar_inicio_turno() from public, anon, authenticated;
select cron.schedule('chambea-inicio-turno', '* * * * *', 'select private.avisar_inicio_turno()');

create or replace function public.guardar_preferencias(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.perfiles set
    recordar_marcaje = coalesce((p ->> 'recordar_marcaje')::boolean, recordar_marcaje),
    marcaje_min = coalesce((p ->> 'marcaje_min')::integer, marcaje_min),
    avisar_bolsa = coalesce((p ->> 'avisar_bolsa')::boolean, avisar_bolsa),
    avisar_pausas = coalesce((p ->> 'avisar_pausas')::boolean, avisar_pausas)
   where id = (select auth.uid());
end;
$$;

create or replace function public.mi_cuenta()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'usuario', p.usuario, 'nombre', p.nombre, 'rol', p.rol, 'telefono', p.telefono,
    'activo', p.activo, 'aprobado', p.aprobado, 'tema', p.tema,
    'recordar_marcaje', p.recordar_marcaje, 'marcaje_min', p.marcaje_min, 'avisar_bolsa', p.avisar_bolsa,
    'avisar_pausas', p.avisar_pausas,
    'puede_corregir', p.rol in ('admin', 'superadmin')
                      or coalesce((select edicion_turnos from public.ajustes where id = 1), 'todos') = 'todos',
    'persona_id', p.persona_id, 'persona', pe.nombre,
    'es_supervisor', coalesce(pe.es_supervisor, false),
    'referencias_planilla', coalesce(pe.referencias_planilla, false),
    'referencias_sp', coalesce(pe.referencias_sp, false))
    from public.perfiles p left join public.personas pe on pe.id = p.persona_id
   where p.id = (select auth.uid());
$$;
