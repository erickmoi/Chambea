-- =====================================================================
-- 017 · Recordatorio de reporte de referencias y minutos para la salida
--  · Referencias en turnos de planilla de día (7 AM – 7 PM): "Envía el reporte
--    de referencias" a la hora que elija cada quien (7:15 AM por defecto).
--  · Marcar salida: a la hora exacta o 5, 10, 15, 20 o 30 minutos después.
-- =====================================================================
alter table public.perfiles
  add column if not exists referencias_aviso boolean not null default true,
  add column if not exists referencias_hora time not null default '07:15',
  add column if not exists salida_min integer not null default 0 check (salida_min in (0, 5, 10, 15, 20, 30));

alter table public.turnos add column if not exists referencias_avisado boolean not null default false;
update public.turnos set referencias_avisado = true where fin <= now() or not (seccion = 'planilla' and funcion = 'referencias');
create index if not exists turnos_referencias_idx on public.turnos (fecha) where not referencias_avisado;

create or replace function private.banderas_turno()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.marcaje_avisado := new.inicio <= now();
  new.inicio_avisado := new.inicio <= now();
  new.salida_avisada := new.fin <= now();
  new.referencias_avisado := new.fin <= now() or not (new.seccion = 'planilla' and new.funcion = 'referencias');
  return new;
end;
$$;
drop trigger if exists turnos_banderas on public.turnos;
create trigger turnos_banderas before insert or update of inicio, fin on public.turnos
  for each row execute function private.banderas_turno();

-- Reporte de referencias: solo turnos de planilla de día (empiezan de 5 a 11 AM y duran 11 h o más)
create or replace function private.recordar_referencias()
returns void language plpgsql security definer set search_path = '' as $$
begin
  with listos as (
    select t.id, pf.id as perfil, t.etiqueta,
           ((t.fecha + pf.referencias_hora)::timestamp at time zone 'America/El_Salvador') as hora_aviso
      from public.turnos t
      join public.perfiles pf on pf.persona_id = t.persona_id and pf.activo and pf.aprobado and pf.referencias_aviso
     where not t.referencias_avisado and t.seccion = 'planilla' and t.funcion = 'referencias'
       and extract(hour from t.inicio at time zone 'America/El_Salvador') between 5 and 11
       and t.fin - t.inicio >= interval '11 hours'
       and t.inicio <= now() + interval '2 hours'),
  toca as (
    select * from listos where now() >= hora_aviso),
  marcados as (
    update public.turnos set referencias_avisado = true where id in (select id from toca) returning id)
  insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
  select perfil, 'referencias', 'Envía el reporte de referencias',
         'Turno de referencias ' || private.texto_horario(etiqueta) || '.', '/?vista=inicio'
    from toca where id in (select id from marcados) and now() < hora_aviso + interval '30 minutes';
  update public.turnos set referencias_avisado = true where not referencias_avisado and fin <= now();
end;
$$;

-- Salida de planilla: a la hora de salida o los minutos después que elija cada quien
create or replace function private.recordar_salida()
returns void language plpgsql security definer set search_path = '' as $$
begin
  with listos as (
    select t.id, t.fin, pf.id as perfil, t.fin + make_interval(mins => pf.salida_min) as hora_aviso
      from public.turnos t
      join public.perfiles pf on pf.persona_id = t.persona_id and pf.activo and pf.aprobado and pf.recordar_salida
     where t.seccion = 'planilla' and not t.salida_avisada and t.fin <= now()),
  toca as (select * from listos where now() >= hora_aviso),
  marcados as (update public.turnos set salida_avisada = true where id in (select id from toca) returning id)
  insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
  select perfil, 'salida', 'Marca tu salida en GeoVictoria',
         'Tu turno de planilla terminó a las ' || ltrim(to_char(fin at time zone 'America/El_Salvador', 'HH12:MI'), '0') || ' '
           || to_char(fin at time zone 'America/El_Salvador', 'AM') || '.',
         '/?vista=inicio'
    from toca
   where id in (select id from marcados) and now() < hora_aviso + interval '15 minutes'
     and coalesce((select geovictoria_activo from public.ajustes where id = 1), true);
  -- sin cuenta, con el aviso apagado o ya muy atrasados: se marcan sin avisar
  update public.turnos t set salida_avisada = true
   where not t.salida_avisada and t.fin <= now() - interval '45 minutes';
  update public.turnos set salida_avisada = true where seccion = 'sp' and not salida_avisada and fin <= now();
end;
$$;

create or replace function private.tareas_minuto()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.recordar_marcaje();
  perform private.avisar_inicio_turno();
  perform private.recordar_referencias();
  perform private.recordar_salida();
end;
$$;

create or replace function public.guardar_preferencias(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.perfiles set
    recordar_marcaje = coalesce((p ->> 'recordar_marcaje')::boolean, recordar_marcaje),
    recordar_salida = coalesce((p ->> 'recordar_salida')::boolean, recordar_salida),
    salida_min = coalesce((p ->> 'salida_min')::integer, salida_min),
    marcaje_min = coalesce((p ->> 'marcaje_min')::integer, marcaje_min),
    avisar_bolsa = coalesce((p ->> 'avisar_bolsa')::boolean, avisar_bolsa),
    avisar_pausas = coalesce((p ->> 'avisar_pausas')::boolean, avisar_pausas),
    referencias_aviso = coalesce((p ->> 'referencias_aviso')::boolean, referencias_aviso),
    referencias_hora = coalesce((p ->> 'referencias_hora')::time, referencias_hora)
   where id = (select auth.uid());
end;
$$;

create or replace function public.mi_cuenta()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'usuario', p.usuario, 'nombre', p.nombre, 'rol', p.rol, 'telefono', p.telefono,
    'activo', p.activo, 'aprobado', p.aprobado, 'tema', p.tema,
    'recordar_marcaje', p.recordar_marcaje, 'recordar_salida', p.recordar_salida, 'salida_min', p.salida_min,
    'marcaje_min', p.marcaje_min, 'avisar_bolsa', p.avisar_bolsa, 'avisar_pausas', p.avisar_pausas,
    'referencias_aviso', p.referencias_aviso, 'referencias_hora', to_char(p.referencias_hora, 'HH24:MI'),
    'puede_corregir', p.rol in ('admin', 'superadmin')
                      or coalesce((select edicion_turnos from public.ajustes where id = 1), 'todos') = 'todos',
    'persona_id', p.persona_id, 'persona', pe.nombre,
    'es_supervisor', coalesce(pe.es_supervisor, false),
    'referencias_planilla', coalesce(pe.referencias_planilla, false),
    'referencias_sp', coalesce(pe.referencias_sp, false))
    from public.perfiles p left join public.personas pe on pe.id = p.persona_id
   where p.id = (select auth.uid());
$$;

revoke all on function private.recordar_referencias() from public, anon, authenticated;
