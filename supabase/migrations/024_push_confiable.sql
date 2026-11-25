-- 024 · Envío de notificaciones push confiable
-- Problema: la función "push" tarda >5 s en arrancar en frío y pg_net cortaba la llamada a los 5 s → aviso perdido.
-- Solución: 30 s de espera, registro de cada envío y reintento automático (hasta 3 intentos) desde la tarea de cada minuto.

alter table public.notificaciones
  add column if not exists push_req bigint,
  add column if not exists push_intentos smallint not null default 0,
  add column if not exists push_ok boolean;

-- Un envío (devuelve el id de la petición de pg_net)
create or replace function private.mandar_push(p_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_n public.notificaciones; v_cfg private.config_push; v_req bigint;
begin
  select * into v_n from public.notificaciones where id = p_id;
  select * into v_cfg from private.config_push where id = 1;
  if v_n.id is null or v_cfg.url is null then return null; end if;
  select net.http_post(
    url := v_cfg.url,
    body := jsonb_build_object('perfil_id', v_n.perfil_id, 'titulo', v_n.titulo, 'cuerpo', v_n.cuerpo, 'url', v_n.url, 'tag', v_n.tipo),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notif-token', v_cfg.token),
    timeout_milliseconds := 30000) into v_req;
  update public.notificaciones set push_req = v_req, push_intentos = push_intentos + 1 where id = p_id;
  return v_req;
end;
$$;

create or replace function private.enviar_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.push_suscripciones where perfil_id = new.perfil_id) then return null; end if;
  perform private.mandar_push(new.id);
  return null;
end;
$$;

-- Revisa los envíos de las últimas 2 h: marca los que llegaron y reintenta los que fallaron
create or replace function private.reintentar_push()
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  for v in
    select n.id, n.push_intentos, n.creado, r.status_code, r.error_msg, (r.id is not null) as hay_respuesta,
           exists (select 1 from net.http_request_queue q where q.id = n.push_req) as en_cola
      from public.notificaciones n
      left join net._http_response r on r.id = n.push_req
     where n.push_req is not null and n.push_ok is null and n.creado > now() - interval '2 hours'
  loop
    if v.status_code between 200 and 299 then
      update public.notificaciones set push_ok = true where id = v.id;
    elsif v.en_cola then
      continue; -- todavía no sale
    elsif v.hay_respuesta or v.creado < now() - interval '3 minutes' then
      if v.push_intentos >= 3 then
        update public.notificaciones set push_ok = false where id = v.id;
      else
        perform private.mandar_push(v.id);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function private.tareas_minuto()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.recordar_marcaje();
  perform private.avisar_inicio_turno();
  perform private.recordar_referencias();
  perform private.recordar_salida();
  perform private.reintentar_push();
end;
$$;

create index if not exists notificaciones_push_pend on public.notificaciones (creado) where push_req is not null and push_ok is null;

revoke all on function private.mandar_push(bigint), private.reintentar_push() from public, anon, authenticated;
