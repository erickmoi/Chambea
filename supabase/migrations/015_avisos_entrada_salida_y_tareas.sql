-- =====================================================================
-- 015 · Recordatorios de entrada y salida, y tareas automáticas
--  · Planilla: "Marca tu entrada en GeoVictoria" (antes) y "Marca tu salida" (al terminar).
--  · Servicios Profesionales: "Firma la hoja de asistencia" (solo a la entrada).
--  · Un solo trabajo por minuto y uno por hora (vencer solicitudes, vigilar la
--    sincronización con la hoja oficial y limpiar avisos viejos).
-- =====================================================================
alter table public.turnos add column if not exists salida_avisada boolean not null default false;
update public.turnos set salida_avisada = true where fin <= now();
alter table public.perfiles add column if not exists recordar_salida boolean not null default true;
alter table public.ajustes add column if not exists sync_alerta timestamptz;

drop index if exists public.turnos_marcaje_idx;
create index if not exists turnos_marcaje_idx on public.turnos (inicio) where not marcaje_avisado;
create index if not exists turnos_salida_idx on public.turnos (fin) where seccion = 'planilla' and not salida_avisada;

-- Al crear un turno o cambiarle la hora, los avisos se calculan solos
create or replace function private.banderas_turno()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.marcaje_avisado := new.inicio <= now();
  new.inicio_avisado := new.inicio <= now();
  new.salida_avisada := new.fin <= now();
  return new;
end;
$$;
drop trigger if exists turnos_banderas on public.turnos;
create trigger turnos_banderas before insert or update of inicio, fin on public.turnos
  for each row execute function private.banderas_turno();

-- Entrada: planilla → GeoVictoria; Servicios Profesionales → hoja de asistencia
create or replace function private.recordar_marcaje()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select geovictoria_activo from public.ajustes where id = 1), true) then
    update public.turnos set marcaje_avisado = true where not marcaje_avisado and inicio <= now() + interval '30 minutes';
    return;
  end if;
  with prox as (
    select t.id, t.inicio, t.seccion, pf.id as perfil
      from public.turnos t
      join public.perfiles pf on pf.persona_id = t.persona_id and pf.activo and pf.aprobado and pf.recordar_marcaje
     where not t.marcaje_avisado and t.inicio > now() and t.inicio <= now() + make_interval(mins => pf.marcaje_min)),
  marcados as (update public.turnos set marcaje_avisado = true where id in (select id from prox) returning id)
  insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
  select p.perfil, 'marcaje',
         case p.seccion when 'sp' then 'Firma la hoja de asistencia' else 'Marca tu entrada en GeoVictoria' end,
         'Tu turno de ' || case p.seccion when 'sp' then 'Servicios Profesionales' else 'planilla' end || ' empieza a las '
           || ltrim(to_char(p.inicio at time zone 'America/El_Salvador', 'HH12:MI'), '0') || ' '
           || to_char(p.inicio at time zone 'America/El_Salvador', 'AM') || '.',
         '/?vista=inicio'
    from prox p where p.id in (select id from marcados);
  update public.turnos set marcaje_avisado = true where not marcaje_avisado and inicio <= now();
end;
$$;

-- Salida: solo planilla, a la hora en que termina
create or replace function private.recordar_salida()
returns void language plpgsql security definer set search_path = '' as $$
begin
  with fin as (
    update public.turnos set salida_avisada = true
     where seccion = 'planilla' and not salida_avisada and fin <= now()
    returning persona_id, fin)
  insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
  select pf.id, 'salida', 'Marca tu salida en GeoVictoria',
         'Tu turno de planilla terminó a las ' || ltrim(to_char(f.fin at time zone 'America/El_Salvador', 'HH12:MI'), '0') || ' '
           || to_char(f.fin at time zone 'America/El_Salvador', 'AM') || '.',
         '/?vista=inicio'
    from fin f join public.perfiles pf on pf.persona_id = f.persona_id
   where f.fin > now() - interval '15 minutes'
     and pf.activo and pf.aprobado and pf.recordar_salida
     and coalesce((select geovictoria_activo from public.ajustes where id = 1), true);
  -- los SP no llevan aviso de salida
  update public.turnos set salida_avisada = true where seccion = 'sp' and not salida_avisada and fin <= now();
end;
$$;

-- Cada minuto: entrada, inicio de turno (pausas) y salida
create or replace function private.tareas_minuto()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.recordar_marcaje();
  perform private.avisar_inicio_turno();
  perform private.recordar_salida();
end;
$$;

-- Cada hora: vencer solicitudes, vigilar la sincronización y limpiar avisos viejos
create or replace function private.tareas_hora()
returns void language plpgsql security definer set search_path = '' as $$
declare v_a public.ajustes;
begin
  perform private.vencer();
  select * into v_a from public.ajustes where id = 1;
  if v_a.sync_ultima is not null and v_a.sync_ultima < now() - interval '3 hours'
     and (v_a.sync_alerta is null or v_a.sync_alerta < v_a.sync_ultima) then
    perform private.notificar_admins('sincronizacion', 'La hoja oficial no se sincroniza',
      'Han pasado más de 3 horas sin datos del puente. Revisa el proyecto en script.google.com.', '/?vista=admin');
    update public.ajustes set sync_alerta = now() where id = 1;
  end if;
  delete from public.notificaciones where leida and creado < now() - interval '60 days';
  delete from public.notificaciones where creado < now() - interval '120 days';
end;
$$;

do $$ begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('chambea-marcaje', 'chambea-inicio-turno', 'chambea-vencer');
end $$;
select cron.schedule('chambea-minuto', '* * * * *', 'select private.tareas_minuto()');
select cron.schedule('chambea-hora', '17 * * * *', 'select private.tareas_hora()');

create or replace function public.guardar_preferencias(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.perfiles set
    recordar_marcaje = coalesce((p ->> 'recordar_marcaje')::boolean, recordar_marcaje),
    recordar_salida = coalesce((p ->> 'recordar_salida')::boolean, recordar_salida),
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
    'recordar_marcaje', p.recordar_marcaje, 'recordar_salida', p.recordar_salida, 'marcaje_min', p.marcaje_min,
    'avisar_bolsa', p.avisar_bolsa, 'avisar_pausas', p.avisar_pausas,
    'puede_corregir', p.rol in ('admin', 'superadmin')
                      or coalesce((select edicion_turnos from public.ajustes where id = 1), 'todos') = 'todos',
    'persona_id', p.persona_id, 'persona', pe.nombre,
    'es_supervisor', coalesce(pe.es_supervisor, false),
    'referencias_planilla', coalesce(pe.referencias_planilla, false),
    'referencias_sp', coalesce(pe.referencias_sp, false))
    from public.perfiles p left join public.personas pe on pe.id = p.persona_id
   where p.id = (select auth.uid());
$$;

revoke all on function private.recordar_salida(), private.tareas_minuto(), private.tareas_hora(), private.banderas_turno()
  from public, anon, authenticated;
