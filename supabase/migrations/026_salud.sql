-- 026 · Revisión automática de salud (cada hora) con reparación de lo que se puede arreglar solo
--  · Guarda el resultado en ajustes.salud (lo muestra Admin → Panel)
--  · Avisa a la administración solo cuando aparece un problema nuevo

alter table public.ajustes add column if not exists salud jsonb;

create or replace function private.revisar_salud()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_items jsonb := '[]'::jsonb; v_n integer; v_m integer; v_rep integer := 0; v_prob integer := 0;
  v_antes jsonb; v_res jsonb; v_nuevos text;
  v_a public.ajustes;
begin
  select * into v_a from public.ajustes where id = 1;
  v_antes := v_a.salud;

  -- 1. Avisos al teléfono atorados (sin respuesta tras 2 h): se cierran
  update public.notificaciones set push_ok = false
   where push_req is not null and push_ok is null and creado < now() - interval '2 hours';
  get diagnostics v_n = row_count;
  v_rep := v_rep + v_n;

  -- 2. Entrega de avisos en 24 h
  select count(*) filter (where push_ok is false), count(*) filter (where push_req is not null)
    into v_n, v_m from public.notificaciones where creado > now() - interval '24 hours';
  v_items := v_items || jsonb_build_object('id', 'avisos', 'titulo', 'Entrega de avisos (24 h)',
    'estado', case when v_n >= 3 and v_n > v_m * 0.2 then 'aviso' else 'ok' end,
    'detalle', case when v_m = 0 then 'Sin envíos todavía' else (v_m - v_n) || ' de ' || v_m || ' entregados' end);

  -- 3. Suscripciones de cuentas desactivadas: se borran
  delete from public.push_suscripciones s using public.perfiles p
   where p.id = s.perfil_id and (not p.activo or not p.aprobado);
  get diagnostics v_n = row_count;
  v_rep := v_rep + v_n;
  if v_n > 0 then
    v_items := v_items || jsonb_build_object('id', 'subs', 'titulo', 'Dispositivos de cuentas desactivadas',
      'estado', 'reparado', 'detalle', v_n || ' quitados');
  end if;

  -- 4. Tareas programadas con error
  select count(*) into v_n from cron.job_run_details where start_time > now() - interval '24 hours' and status <> 'succeeded';
  v_items := v_items || jsonb_build_object('id', 'tareas', 'titulo', 'Tareas automáticas (24 h)',
    'estado', case when v_n > 0 then 'aviso' else 'ok' end,
    'detalle', case when v_n > 0 then v_n || ' con error' else 'Sin errores' end);

  -- 5. Sincronización con la hoja oficial
  v_items := v_items || jsonb_build_object('id', 'hoja', 'titulo', 'Hoja oficial',
    'estado', case when v_a.sync_ultima is null or v_a.sync_ultima < now() - interval '3 hours' then 'aviso' else 'ok' end,
    'detalle', case when v_a.sync_ultima is null then 'Sin sincronizar'
                    else 'Última: ' || to_char(v_a.sync_ultima at time zone 'America/El_Salvador', 'DD/MM HH12:MI AM') end);

  -- 6. Solicitudes de turnos que ya empezaron: se vencen
  select count(*) into v_n from public.solicitudes s join public.turnos t on t.id = s.turno_id
   where s.estado in ('abierta', 'por_confirmar') and t.inicio <= now();
  if v_n > 0 then
    perform private.vencer();
    v_rep := v_rep + v_n;
    v_items := v_items || jsonb_build_object('id', 'vencidas', 'titulo', 'Solicitudes de turnos ya iniciados',
      'estado', 'reparado', 'detalle', v_n || ' cerradas');
  end if;

  -- 7. Función de turnos de planilla que no coincide con la categoría de la persona: se corrige
  with mal as (
    select t.id from public.turnos t join public.personas p on p.id = t.persona_id
     where t.seccion = 'planilla' and t.inicio > now()
       and t.funcion is distinct from case when p.es_supervisor then 'supervisor'
                                            when p.referencias_planilla then 'referencias' else 'triaje' end)
  update public.turnos t set funcion = funcion from mal where t.id = mal.id;
  get diagnostics v_n = row_count;
  v_rep := v_rep + v_n;
  if v_n > 0 then
    v_items := v_items || jsonb_build_object('id', 'funciones', 'titulo', 'Turnos con grupo equivocado',
      'estado', 'reparado', 'detalle', v_n || ' corregidos');
  end if;

  -- 8. Cuentas aprobadas sin enlazar a una persona del horario
  select count(*) into v_n from public.perfiles where activo and aprobado and persona_id is null;
  v_items := v_items || jsonb_build_object('id', 'sin_persona', 'titulo', 'Cuentas sin enlazar al horario',
    'estado', case when v_n > 0 then 'aviso' else 'ok' end,
    'detalle', case when v_n > 0 then v_n || ' por enlazar en Admin → Usuarios' else 'Todas enlazadas' end);

  -- 9. Turnos futuros que se cruzan en la misma persona (error en la hoja)
  select count(*) into v_n from public.turnos a join public.turnos b
    on a.persona_id = b.persona_id and a.id < b.id and a.inicio < b.fin and b.inicio < a.fin
   where a.inicio > now();
  v_items := v_items || jsonb_build_object('id', 'cruces', 'titulo', 'Turnos cruzados en el horario',
    'estado', case when v_n > 0 then 'aviso' else 'ok' end,
    'detalle', case when v_n > 0 then v_n || ' para revisar' else 'Ninguno' end);

  select count(*) into v_prob from jsonb_array_elements(v_items) x where x ->> 'estado' = 'aviso';
  v_res := jsonb_build_object('revisado', now(), 'problemas', v_prob, 'reparados', v_rep, 'items', v_items);
  update public.ajustes set salud = v_res where id = 1;

  -- Aviso a la administración solo por problemas nuevos
  select string_agg(x ->> 'titulo', ', ') into v_nuevos
    from jsonb_array_elements(v_items) x
   where x ->> 'estado' = 'aviso' and x ->> 'id' <> 'hoja'   -- la hoja ya tiene su propio aviso
     and not exists (select 1 from jsonb_array_elements(coalesce(v_antes -> 'items', '[]'::jsonb)) y
                      where y ->> 'id' = x ->> 'id' and y ->> 'estado' = 'aviso');
  if v_nuevos is not null then
    perform private.notificar_admins('salud', 'Chambea necesita revisión', v_nuevos || '. Detalle en Admin → Panel.', '/?vista=admin');
  end if;
  return v_res;
end;
$$;

create or replace function public.salud_admin(p_revisar boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  if p_revisar then return private.revisar_salud(); end if;
  return coalesce((select salud from public.ajustes where id = 1), private.revisar_salud());
end;
$$;
grant execute on function public.salud_admin(boolean) to authenticated;

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
  perform private.revisar_salud();
end;
$$;

revoke all on function private.revisar_salud() from public, anon, authenticated;
