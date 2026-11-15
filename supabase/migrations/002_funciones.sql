-- =====================================================================
-- CHAMBEA · 002 · Reglas, choques, bolsa y aplicación de acuerdos
-- =====================================================================

-- ¿Esta persona puede quedarse con un turno de esa sección y función?
--  Planilla: supervisor ↔ supervisor · referencias ↔ referencias · triaje ↔ triaje (no supervisores)
--  SP: referencias ↔ referencias · general ↔ cualquiera
create or replace function private.puede_tomar(p_persona bigint, p_seccion text, p_funcion text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.activo and case
      when p_seccion = 'planilla' and p_funcion = 'supervisor'  then p.es_supervisor
      when p_seccion = 'planilla' and p_funcion = 'referencias' then p.referencias_planilla
      when p_seccion = 'planilla' and p_funcion = 'triaje'      then not p.es_supervisor
      when p_seccion = 'sp'       and p_funcion = 'referencias' then p.referencias_sp
      when p_seccion = 'sp'       and p_funcion = 'general'     then true
      else false end
    from public.personas p where p.id = p_persona), false);
$$;

-- Avisos si p_persona tuviera además un turno [p_inicio, p_fin), sin contar p_excluir.
--  · cruce: se traslapa con otro turno suyo
--  · jornada_larga: el bloque continuo (huecos < min_descanso_min) pasa de max_horas_continuas
create or replace function private.choques(
  p_persona bigint, p_inicio timestamptz, p_fin timestamptz, p_excluir bigint[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_max integer; v_gap interval;
  v_cruces jsonb; v_s timestamptz := p_inicio; v_e timestamptz := p_fin;
  v_a timestamptz; v_b timestamptz; v_res jsonb;
begin
  select max_horas_continuas, make_interval(mins => min_descanso_min)
    into v_max, v_gap from public.ajustes where id = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'cruce', 'turno_id', t.id, 'seccion', t.seccion,
           'fecha', t.fecha, 'etiqueta', t.etiqueta) order by t.inicio), '[]'::jsonb)
    into v_cruces
    from public.turnos t
   where t.persona_id = p_persona and not (t.id = any(p_excluir))
     and t.inicio < p_fin and t.fin > p_inicio;

  loop  -- expande el bloque continuo hasta que ya no crezca
    select least(min(t.inicio), v_s), greatest(max(t.fin), v_e) into v_a, v_b
      from public.turnos t
     where t.persona_id = p_persona and not (t.id = any(p_excluir))
       and t.inicio < v_e + v_gap and t.fin > v_s - v_gap;
    exit when v_a is null or (v_a = v_s and v_b = v_e);
    v_s := v_a; v_e := v_b;
  end loop;

  v_res := v_cruces;
  if v_e - v_s > make_interval(hours => v_max) then
    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'tipo', 'jornada_larga',
      'horas', round(extract(epoch from (v_e - v_s)) / 3600.0, 1),
      'desde', v_s, 'hasta', v_e));
  end if;
  return v_res;
end;
$$;

-- Avisa a todas las cuentas activas enlazadas a una persona
create or replace function private.notificar_persona(
  p_persona bigint, p_tipo text, p_titulo text, p_cuerpo text default null, p_url text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notificaciones (perfil_id, tipo, titulo, cuerpo, url)
  select id, p_tipo, p_titulo, p_cuerpo, p_url
    from public.perfiles where persona_id = p_persona and activo and aprobado;
$$;

create or replace function private.nombre_corto(p_persona bigint)
returns text language sql stable security definer set search_path = '' as $$
  select initcap(split_part(nombre, ' ', 1)) from public.personas where id = p_persona;
$$;

create or replace function private.texto_turno(p_turno bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case seccion when 'sp' then 'SP ' else '' end || to_char(fecha, 'DD/MM') || ' ' || etiqueta
    from public.turnos where id = p_turno;
$$;

create or replace function private.exigir_persona()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v bigint := private.mi_persona();
begin
  if v is null then
    raise exception 'Tu cuenta todavía no está habilitada o no está enlazada a tu nombre del horario.';
  end if;
  return v;
end;
$$;

-- =====================================================================
-- RPC: consultar avisos antes de ofrecer / elegir
-- =====================================================================
create or replace function public.choques_si_recibo(p_recibo bigint, p_entrego bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona(); v_t public.turnos;
begin
  select * into v_t from public.turnos where id = p_recibo;
  if not found then raise exception 'Ese turno ya no existe.'; end if;
  return private.choques(v_p, v_t.inicio, v_t.fin, array_remove(array[p_entrego, p_recibo], null));
end;
$$;

-- =====================================================================
-- RPC: publicar solicitud
-- =====================================================================
create or replace function public.publicar_solicitud(
  p_tipo text, p_turno_id bigint default null, p_seccion text default null,
  p_funcion text default null, p_fechas date[] default '{}', p_nota text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_t public.turnos; v_sec text; v_fun text; v_id bigint;
  v_hoy date := (now() at time zone 'America/El_Salvador')::date;
  v_destino record;
begin
  if p_tipo not in ('permuta', 'ceder', 'cobertura', 'busco') then
    raise exception 'Tipo de solicitud no válido.';
  end if;

  if p_tipo = 'busco' then
    v_sec := p_seccion; v_fun := p_funcion;
    if v_sec not in ('planilla', 'sp') then raise exception 'Elige Planilla o SP.'; end if;
    if not private.puede_tomar(v_p, v_sec, v_fun) then
      raise exception 'No puedes tomar turnos de ese tipo.';
    end if;
    if coalesce(cardinality(p_fechas), 0) = 0 then raise exception 'Indica qué fechas buscas.'; end if;
  else
    if p_turno_id is null then raise exception 'Elige el turno.'; end if;
    select * into v_t from public.turnos where id = p_turno_id for update;
    if not found or v_t.persona_id <> v_p then raise exception 'Ese turno no es tuyo.'; end if;
    if v_t.inicio <= now() then raise exception 'Ese turno ya empezó o ya pasó.'; end if;
    if exists (select 1 from public.solicitudes
                where turno_id = p_turno_id and estado in ('abierta', 'por_confirmar')) then
      raise exception 'Ese turno ya está publicado.';
    end if;
    v_sec := v_t.seccion; v_fun := v_t.funcion;
    if p_tipo <> 'permuta' then p_fechas := '{}'; end if;
  end if;

  if exists (select 1 from unnest(p_fechas) f where f < v_hoy) then
    raise exception 'Hay fechas que ya pasaron.';
  end if;

  insert into public.solicitudes (seccion, tipo, persona_id, creado_por, turno_id, funcion, fechas, nota)
  values (v_sec, p_tipo, v_p, (select auth.uid()), p_turno_id, v_fun,
          coalesce(p_fechas, '{}'), nullif(trim(p_nota), ''))
  returning id into v_id;

  -- Aviso a quienes podrían responder
  for v_destino in
    select pe.id as persona from public.personas pe
     where pe.id <> v_p and private.puede_tomar(pe.id, v_sec, v_fun)
  loop
    perform private.notificar_persona(v_destino.persona, 'nueva_solicitud',
      case p_tipo when 'permuta' then '🔄 Permuta' when 'ceder' then '🎁 Turno cedido'
                  when 'cobertura' then '🆘 Piden cobertura' else '🔎 Buscan turno' end
        || case v_sec when 'sp' then ' · SP' else ' · Planilla' end,
      private.nombre_corto(v_p) || coalesce(': ' || private.texto_turno(p_turno_id), ''),
      '/?solicitud=' || v_id);
  end loop;
  return v_id;
end;
$$;

create or replace function public.cancelar_solicitud(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona(); v_s public.solicitudes; v_o record;
begin
  select * into v_s from public.solicitudes where id = p_id for update;
  if not found or v_s.persona_id <> v_p then raise exception 'Esa solicitud no es tuya.'; end if;
  if v_s.estado not in ('abierta', 'por_confirmar') then raise exception 'Esa solicitud ya está cerrada.'; end if;
  update public.solicitudes set estado = 'cancelada', actualizado = now() where id = p_id;
  for v_o in update public.ofertas set estado = 'rechazada', actualizado = now()
              where solicitud_id = p_id and estado in ('pendiente', 'elegida') returning persona_id
  loop
    perform private.notificar_persona(v_o.persona_id, 'solicitud_cancelada', 'Solicitud cancelada',
      private.nombre_corto(v_p) || ' canceló la solicitud a la que respondiste.', '/?solicitud=' || p_id);
  end loop;
end;
$$;

-- =====================================================================
-- RPC: ofrecerse a una solicitud
--   Si hay avisos y no se confirmaron, NO guarda y devuelve {ok:false, choques}
-- =====================================================================
create or replace function public.ofertar(
  p_solicitud_id bigint, p_turno_id bigint default null, p_nota text default null,
  p_confirmo_choque boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_s public.solicitudes; v_a public.turnos; v_b public.turnos;
  v_ch jsonb := '[]'::jsonb; v_id bigint;
begin
  select * into v_s from public.solicitudes where id = p_solicitud_id for update;
  if not found or v_s.estado <> 'abierta' then raise exception 'Esa solicitud ya no está disponible.'; end if;
  if v_s.persona_id = v_p then raise exception 'No puedes responder tu propia solicitud.'; end if;

  if v_s.tipo in ('permuta', 'busco') then
    if p_turno_id is null then raise exception 'Elige el turno que ofreces.'; end if;
    select * into v_b from public.turnos where id = p_turno_id;
    if not found or v_b.persona_id <> v_p then raise exception 'Ese turno no es tuyo.'; end if;
    if v_b.inicio <= now() then raise exception 'Ese turno ya empezó o ya pasó.'; end if;
    if v_b.seccion <> v_s.seccion or v_b.funcion <> v_s.funcion then
      raise exception 'Ese turno no es compatible (debe ser de la misma sección y función).';
    end if;
    if cardinality(v_s.fechas) > 0 and not (v_b.fecha = any(v_s.fechas)) then
      raise exception 'Esa fecha no está entre las que pidió.';
    end if;
  else
    p_turno_id := null;
    if not private.puede_tomar(v_p, v_s.seccion, v_s.funcion) then
      raise exception 'No puedes tomar turnos de ese tipo.';
    end if;
  end if;

  if v_s.tipo <> 'busco' then  -- recibiré el turno A
    select * into v_a from public.turnos where id = v_s.turno_id;
    if not found or v_a.inicio <= now() then raise exception 'El turno de esa solicitud ya no está disponible.'; end if;
    v_ch := private.choques(v_p, v_a.inicio, v_a.fin, array_remove(array[p_turno_id], null));
  end if;

  if jsonb_array_length(v_ch) > 0 and not p_confirmo_choque then
    return jsonb_build_object('ok', false, 'choques', v_ch);
  end if;

  insert into public.ofertas (solicitud_id, persona_id, creado_por, turno_id, nota, choques)
  values (p_solicitud_id, v_p, (select auth.uid()), p_turno_id, nullif(trim(p_nota), ''), v_ch)
  returning id into v_id;

  perform private.notificar_persona(v_s.persona_id, 'nueva_oferta', '🙋 Alguien respondió',
    private.nombre_corto(v_p) || coalesce(' ofrece ' || private.texto_turno(p_turno_id), ' puede tomar tu turno'),
    '/?solicitud=' || p_solicitud_id);
  return jsonb_build_object('ok', true, 'oferta_id', v_id, 'choques', v_ch);
end;
$$;

create or replace function public.retirar_oferta(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona(); v_o public.ofertas; v_s public.solicitudes;
begin
  select * into v_o from public.ofertas where id = p_id;
  if not found or v_o.persona_id <> v_p then raise exception 'Esa respuesta no es tuya.'; end if;
  select * into v_s from public.solicitudes where id = v_o.solicitud_id for update;
  select * into v_o from public.ofertas where id = p_id for update;
  if v_o.estado not in ('pendiente', 'elegida') then raise exception 'Esa respuesta ya está cerrada.'; end if;
  update public.ofertas set estado = 'retirada', actualizado = now() where id = p_id;
  if v_o.estado = 'elegida' then
    update public.solicitudes set estado = 'abierta', oferta_elegida_id = null, actualizado = now()
     where id = v_s.id;
  end if;
  perform private.notificar_persona(v_s.persona_id, 'oferta_retirada', 'Retiraron una respuesta',
    private.nombre_corto(v_p) || ' ya no puede con tu solicitud.', '/?solicitud=' || v_s.id);
end;
$$;

-- =====================================================================
-- RPC: quien publicó elige una respuesta
-- =====================================================================
create or replace function public.elegir_oferta(p_oferta_id bigint, p_confirmo_choque boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_o public.ofertas; v_s public.solicitudes; v_b public.turnos; v_ch jsonb := '[]'::jsonb;
begin
  select * into v_o from public.ofertas where id = p_oferta_id;
  if not found then raise exception 'Esa respuesta ya no existe.'; end if;
  select * into v_s from public.solicitudes where id = v_o.solicitud_id for update;
  select * into v_o from public.ofertas where id = p_oferta_id for update;
  if v_s.persona_id <> v_p then raise exception 'Esa solicitud no es tuya.'; end if;
  if v_s.estado <> 'abierta' then raise exception 'Ya elegiste a alguien o la solicitud está cerrada.'; end if;
  if v_o.estado <> 'pendiente' then raise exception 'Esa respuesta ya no está disponible.'; end if;

  if v_s.tipo in ('permuta', 'busco') then  -- recibiré el turno B
    select * into v_b from public.turnos where id = v_o.turno_id;
    if not found or v_b.inicio <= now() or v_b.persona_id <> v_o.persona_id then
      raise exception 'El turno ofrecido ya no está disponible.';
    end if;
    v_ch := private.choques(v_p, v_b.inicio, v_b.fin, array_remove(array[v_s.turno_id], null));
  end if;

  if jsonb_array_length(v_ch) > 0 and not p_confirmo_choque then
    return jsonb_build_object('ok', false, 'choques', v_ch);
  end if;

  update public.ofertas set estado = 'elegida', actualizado = now() where id = p_oferta_id;
  update public.solicitudes set estado = 'por_confirmar', oferta_elegida_id = p_oferta_id, actualizado = now()
   where id = v_s.id;

  perform private.notificar_persona(v_o.persona_id, 'te_eligieron', '✅ Te eligieron',
    private.nombre_corto(v_p) || ' aceptó tu respuesta. Confirma para aplicar el cambio.',
    '/?solicitud=' || v_s.id);
  return jsonb_build_object('ok', true, 'choques', v_ch);
end;
$$;

-- =====================================================================
-- Núcleo: aplica el acuerdo de una sola vez (todo o nada)
-- =====================================================================
create or replace function private.aplicar_acuerdo(p_oferta_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_o public.ofertas; v_s public.solicitudes; v_a public.turnos; v_b public.turnos;
  v_mov record; v_x record;
begin
  select * into v_o from public.ofertas where id = p_oferta_id;
  select * into v_s from public.solicitudes where id = v_o.solicitud_id;

  -- Bloquea los turnos involucrados en orden fijo para evitar interbloqueos
  perform 1 from public.turnos where id in (v_s.turno_id, v_o.turno_id) order by id for update;
  if v_s.turno_id is not null then select * into v_a from public.turnos where id = v_s.turno_id; end if;
  if v_o.turno_id is not null then select * into v_b from public.turnos where id = v_o.turno_id; end if;

  if v_s.tipo <> 'busco' and (v_a.id is null or v_a.persona_id <> v_s.persona_id or v_a.inicio <= now()) then
    raise exception 'El turno de la solicitud ya cambió; no se puede aplicar.';
  end if;
  if v_s.tipo in ('permuta', 'busco') and (v_b.id is null or v_b.persona_id <> v_o.persona_id or v_b.inicio <= now()) then
    raise exception 'El turno ofrecido ya cambió; no se puede aplicar.';
  end if;

  for v_mov in
    select v_a.id as turno, v_s.persona_id as de, v_o.persona_id as a where v_s.tipo <> 'busco'
    union all
    select v_b.id, v_o.persona_id, v_s.persona_id where v_s.tipo in ('permuta', 'busco')
  loop
    update public.turnos
       set persona_original_id = coalesce(persona_original_id, persona_id),
           persona_id = v_mov.a, es_cambio = true, actualizado = now()
     where id = v_mov.turno;
    -- si vuelve a su dueño original, ya no es cambio
    update public.turnos set es_cambio = false, persona_original_id = null
     where id = v_mov.turno and persona_original_id = persona_id;
    insert into public.cambios (solicitud_id, oferta_id, turno_id, de_persona_id, a_persona_id)
    values (v_s.id, v_o.id, v_mov.turno, v_mov.de, v_mov.a);

    -- Lo que dependía de ese turno ya no es válido
    for v_x in update public.solicitudes set estado = 'cancelada', actualizado = now()
                where turno_id = v_mov.turno and id <> v_s.id and estado in ('abierta', 'por_confirmar')
                returning id, persona_id
    loop
      update public.ofertas set estado = 'rechazada', actualizado = now()
       where solicitud_id = v_x.id and estado in ('pendiente', 'elegida');
    end loop;
    for v_x in update public.ofertas set estado = 'retirada', actualizado = now()
                where turno_id = v_mov.turno and id <> v_o.id and estado in ('pendiente', 'elegida')
                returning solicitud_id, estado
    loop
      update public.solicitudes set estado = 'abierta', oferta_elegida_id = null, actualizado = now()
       where id = v_x.solicitud_id and estado = 'por_confirmar';
    end loop;
  end loop;

  update public.ofertas set estado = 'aceptada', actualizado = now() where id = v_o.id;
  update public.ofertas set estado = 'rechazada', actualizado = now()
   where solicitud_id = v_s.id and id <> v_o.id and estado in ('pendiente', 'elegida');
  update public.solicitudes set estado = 'aplicada', actualizado = now() where id = v_s.id;

  perform private.notificar_persona(v_s.persona_id, 'cambio_aplicado', '🔁 Cambio aplicado',
    'Con ' || private.nombre_corto(v_o.persona_id) || '. Recuerda tramitarlo con jefatura.', '/?vista=horario');
  perform private.notificar_persona(v_o.persona_id, 'cambio_aplicado', '🔁 Cambio aplicado',
    'Con ' || private.nombre_corto(v_s.persona_id) || '. Recuerda tramitarlo con jefatura.', '/?vista=horario');
end;
$$;

-- =====================================================================
-- RPC: la persona elegida confirma (aplica) o declina
-- =====================================================================
create or replace function public.responder_eleccion(
  p_oferta_id bigint, p_acepta boolean, p_confirmo_choque boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p bigint := private.exigir_persona();
  v_o public.ofertas; v_s public.solicitudes; v_a public.turnos; v_ch jsonb := '[]'::jsonb;
begin
  select * into v_o from public.ofertas where id = p_oferta_id;
  if not found or v_o.persona_id <> v_p then raise exception 'Esa respuesta no es tuya.'; end if;
  select * into v_s from public.solicitudes where id = v_o.solicitud_id for update;
  select * into v_o from public.ofertas where id = p_oferta_id for update;
  if v_o.estado <> 'elegida' or v_s.estado <> 'por_confirmar' then
    raise exception 'Ya no hay nada que confirmar aquí.';
  end if;

  if not p_acepta then
    update public.ofertas set estado = 'retirada', actualizado = now() where id = p_oferta_id;
    update public.solicitudes set estado = 'abierta', oferta_elegida_id = null, actualizado = now()
     where id = v_s.id;
    perform private.notificar_persona(v_s.persona_id, 'eleccion_declinada', 'No se concretó',
      private.nombre_corto(v_p) || ' ya no puede. Tu solicitud volvió a estar abierta.', '/?solicitud=' || v_s.id);
    return jsonb_build_object('ok', true, 'aplicado', false);
  end if;

  if v_s.tipo <> 'busco' then  -- vuelvo a revisar mis avisos por si algo cambió
    select * into v_a from public.turnos where id = v_s.turno_id;
    if found then
      v_ch := private.choques(v_p, v_a.inicio, v_a.fin, array_remove(array[v_o.turno_id, v_a.id], null));
    end if;
  end if;
  if jsonb_array_length(v_ch) > 0 and not p_confirmo_choque then
    return jsonb_build_object('ok', false, 'choques', v_ch);
  end if;
  if jsonb_array_length(v_ch) > 0 then
    update public.ofertas set choques = v_ch where id = p_oferta_id;
  end if;

  perform private.aplicar_acuerdo(p_oferta_id);
  return jsonb_build_object('ok', true, 'aplicado', true);
end;
$$;

create or replace function public.marcar_leidas(p_ids bigint[] default null)
returns void language sql security definer set search_path = '' as $$
  update public.notificaciones set leida = true
   where perfil_id = (select auth.uid()) and not leida and (p_ids is null or id = any(p_ids));
$$;

-- =====================================================================
-- IMPORTACIÓN (solo admin)
-- p_filas: [{nombre, fecha, inicio, fin, funcion, etiqueta, supervisor}]
-- Reemplaza solo [p_desde, p_hasta] de esa sección. Con p_conservar_cambios
-- se respetan los turnos 🔁 y se omiten las filas de la hoja que los duplican.
-- =====================================================================
create or replace function private.importar(
  p_seccion text, p_desde date, p_hasta date, p_archivo text, p_filas jsonb,
  p_subido_por uuid, p_conservar_cambios boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_imp bigint; v_nuevas text[]; v_borrados integer; v_insertados integer;
  v_total integer := jsonb_array_length(p_filas); v_cancel integer := 0; v_x record;
begin
  if p_seccion not in ('planilla', 'sp') then raise exception 'Sección no válida.'; end if;
  if p_hasta < p_desde then raise exception 'Rango de fechas no válido.'; end if;

  create temp table _f on commit drop as
  select trim(regexp_replace(f ->> 'nombre', '\s+', ' ', 'g')) as nombre,
         private.norm(f ->> 'nombre') as n,
         (f ->> 'fecha')::date as fecha,
         (f ->> 'inicio')::timestamptz as inicio,
         (f ->> 'fin')::timestamptz as fin,
         f ->> 'funcion' as funcion,
         f ->> 'etiqueta' as etiqueta,
         coalesce((f ->> 'supervisor')::boolean, false) as supervisor,
         null::bigint as persona_id
    from jsonb_array_elements(p_filas) f;

  if exists (select 1 from _f where fecha < p_desde or fecha > p_hasta) then
    raise exception 'Hay filas fuera del rango % a %.', p_desde, p_hasta;
  end if;

  -- 1) Personas: por nombre, luego por alias; si no existe, se crea
  update _f set persona_id = p.id from public.personas p where p.nombre_norm = _f.n;
  update _f set persona_id = a.persona_id from public.alias_personas a
   where _f.persona_id is null and a.alias_norm = _f.n;
  with nuevas as (
    insert into public.personas (nombre, nombre_norm)
    select distinct on (n) nombre, n from _f where persona_id is null order by n, nombre
    on conflict (nombre_norm) do nothing
    returning nombre)
  select coalesce(array_agg(nombre order by nombre), '{}') into v_nuevas from nuevas;
  update _f set persona_id = p.id from public.personas p where _f.persona_id is null and p.nombre_norm = _f.n;

  -- Marcas que se infieren de la hoja (solo se encienden; el admin las puede apagar)
  update public.personas p set es_supervisor = true
   where p_seccion = 'planilla' and not p.es_supervisor
     and exists (select 1 from _f where _f.persona_id = p.id and _f.supervisor);
  update public.personas p set referencias_planilla = true
   where p_seccion = 'planilla' and not p.referencias_planilla
     and exists (select 1 from _f where _f.persona_id = p.id and _f.funcion = 'referencias');
  update public.personas p set referencias_sp = true
   where p_seccion = 'sp' and not p.referencias_sp
     and exists (select 1 from _f where _f.persona_id = p.id and _f.funcion = 'referencias');

  insert into public.importaciones (seccion, desde, hasta, archivo, subido_por)
  values (p_seccion, p_desde, p_hasta, p_archivo, p_subido_por) returning id into v_imp;

  -- 2) Turnos que se van a reemplazar: primero cerrar lo que dependa de ellos
  create temp table _borrar on commit drop as
  select id from public.turnos
   where seccion = p_seccion and fecha between p_desde and p_hasta
     and not (p_conservar_cambios and es_cambio);

  for v_x in update public.solicitudes set estado = 'cancelada', actualizado = now()
              where turno_id in (select id from _borrar) and estado in ('abierta', 'por_confirmar')
              returning id, persona_id
  loop
    v_cancel := v_cancel + 1;
    update public.ofertas set estado = 'rechazada', actualizado = now()
     where solicitud_id = v_x.id and estado in ('pendiente', 'elegida');
    perform private.notificar_persona(v_x.persona_id, 'solicitud_cancelada', 'Horario actualizado',
      'Se cargó un horario nuevo y tu solicitud se canceló porque el turno cambió.', '/?solicitud=' || v_x.id);
  end loop;
  for v_x in update public.ofertas set estado = 'retirada', actualizado = now()
              where turno_id in (select id from _borrar) and estado in ('pendiente', 'elegida')
              returning solicitud_id
  loop
    update public.solicitudes set estado = 'abierta', oferta_elegida_id = null, actualizado = now()
     where id = v_x.solicitud_id and estado = 'por_confirmar';
  end loop;

  delete from public.turnos where id in (select id from _borrar);
  get diagnostics v_borrados = row_count;

  -- 3) Insertar lo nuevo (omitiendo duplicados de turnos 🔁 conservados)
  insert into public.turnos (persona_id, seccion, fecha, inicio, fin, funcion, etiqueta, importacion_id)
  select f.persona_id, p_seccion, f.fecha, f.inicio, f.fin, f.funcion, f.etiqueta, v_imp
    from _f f
   where not exists (
     select 1 from public.turnos k
      where k.es_cambio and k.seccion = p_seccion and k.inicio = f.inicio and k.fin = f.fin
        and f.persona_id in (k.persona_id, k.persona_original_id))
  on conflict (persona_id, seccion, inicio) do nothing;
  get diagnostics v_insertados = row_count;

  update public.importaciones set resumen = jsonb_build_object(
    'filas', v_total, 'insertados', v_insertados, 'reemplazados', v_borrados,
    'omitidos', v_total - v_insertados, 'personas_nuevas', to_jsonb(v_nuevas),
    'solicitudes_canceladas', v_cancel)
   where id = v_imp;

  return (select resumen || jsonb_build_object('importacion_id', id) from public.importaciones where id = v_imp);
end;
$$;

create or replace function public.importar_turnos(
  p_seccion text, p_desde date, p_hasta date, p_archivo text, p_filas jsonb,
  p_conservar_cambios boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración puede cargar horarios.'; end if;
  return private.importar(p_seccion, p_desde, p_hasta, p_archivo, p_filas, (select auth.uid()), p_conservar_cambios);
end;
$$;

-- Vista previa: cómo se enlazaría cada nombre de la hoja
create or replace function public.revisar_nombres(p_nombres text[])
returns table (nombre text, persona_id bigint, persona text, via text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  return query
  select x.nm, coalesce(p.id, pa.id), coalesce(p.nombre, pa.nombre),
         case when p.id is not null then 'nombre' when pa.id is not null then 'alias' else 'nueva' end
    from unnest(p_nombres) as x(nm)
    left join public.personas p on p.nombre_norm = private.norm(x.nm)
    left join public.alias_personas a on p.id is null and a.alias_norm = private.norm(x.nm)
    left join public.personas pa on pa.id = a.persona_id;
end;
$$;

create or replace function public.guardar_alias(p_alias text, p_persona_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  insert into public.alias_personas (alias_norm, persona_id) values (private.norm(p_alias), p_persona_id)
  on conflict (alias_norm) do update set persona_id = excluded.persona_id;
end;
$$;

create or replace function public.actualizar_persona(
  p_id bigint, p_es_supervisor boolean, p_referencias_planilla boolean,
  p_referencias_sp boolean, p_activo boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  update public.personas set es_supervisor = p_es_supervisor, referencias_planilla = p_referencias_planilla,
         referencias_sp = p_referencias_sp, activo = p_activo
   where id = p_id;
end;
$$;

-- =====================================================================
-- Permisos de ejecución
-- =====================================================================
revoke all on function
  private.puede_tomar(bigint, text, text), private.choques(bigint, timestamptz, timestamptz, bigint[]),
  private.notificar_persona(bigint, text, text, text, text), private.nombre_corto(bigint),
  private.texto_turno(bigint), private.exigir_persona(), private.aplicar_acuerdo(bigint),
  private.importar(text, date, date, text, jsonb, uuid, boolean)
  from public, anon, authenticated;

revoke all on function
  public.choques_si_recibo(bigint, bigint),
  public.publicar_solicitud(text, bigint, text, text, date[], text),
  public.cancelar_solicitud(bigint),
  public.ofertar(bigint, bigint, text, boolean),
  public.retirar_oferta(bigint),
  public.elegir_oferta(bigint, boolean),
  public.responder_eleccion(bigint, boolean, boolean),
  public.marcar_leidas(bigint[]),
  public.importar_turnos(text, date, date, text, jsonb, boolean),
  public.revisar_nombres(text[]),
  public.guardar_alias(text, bigint),
  public.actualizar_persona(bigint, boolean, boolean, boolean, boolean)
  from public, anon;

grant execute on function
  public.choques_si_recibo(bigint, bigint),
  public.publicar_solicitud(text, bigint, text, text, date[], text),
  public.cancelar_solicitud(bigint),
  public.ofertar(bigint, bigint, text, boolean),
  public.retirar_oferta(bigint),
  public.elegir_oferta(bigint, boolean),
  public.responder_eleccion(bigint, boolean, boolean),
  public.marcar_leidas(bigint[]),
  public.importar_turnos(text, date, date, text, jsonb, boolean),
  public.revisar_nombres(text[]),
  public.guardar_alias(text, bigint),
  public.actualizar_persona(bigint, boolean, boolean, boolean, boolean)
  to authenticated;
