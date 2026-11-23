-- 023 · Categoría "Gerencia médica" y turnos manuales
--  · personas.gerencia: ve todo como un compañero, agrega sus turnos a mano y NO participa en permutas
--  · turnos.manual: turnos agregados a mano; la carga/sincronización de la hoja no los borra
--  · agregar_persona / actualizar_persona (con categoría) para la administración

alter table public.personas add column if not exists gerencia boolean not null default false;
alter table public.turnos add column if not exists manual boolean not null default false;

insert into public.personas (nombre, nombre_norm, gerencia)
values ('JOSE CARLOS SANCHEZ', private.norm('JOSE CARLOS SANCHEZ'), true)
on conflict (nombre_norm) do update set gerencia = true;

-- ¿Participa en permutas?
create or replace function private.en_permutas(p_persona bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select not gerencia from public.personas where id = p_persona), true);
$$;

-- Gerencia no puede tomar turnos de nadie (y así tampoco aparece como opción para los demás)
create or replace function private.puede_tomar(p_persona bigint, p_seccion text, p_funcion text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.activo and not p.gerencia and case
      when p_seccion = 'planilla' and p_funcion = 'supervisor'  then p.es_supervisor
      when p_seccion = 'planilla' and p_funcion = 'referencias' then p.referencias_planilla and not p.es_supervisor
      when p_seccion = 'planilla' and p_funcion = 'triaje'      then not p.es_supervisor and not p.referencias_planilla
      when p_seccion = 'sp'       and p_funcion = 'referencias' then p.referencias_sp
      when p_seccion = 'sp'       and p_funcion = 'general'     then true
      else false end
    from public.personas p where p.id = p_persona), false);
$$;

create or replace function private.exigir_en_permutas(p_persona bigint, p_quien text default null)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.en_permutas(p_persona) then
    raise exception '%', coalesce(p_quien || ' es de gerencia médica', 'Gerencia médica') || ' y no participa en permutas.';
  end if;
end;
$$;

-- Bloqueos en publicar, ofertar y proponer (se agregan al inicio de cada función existente)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.publicar_solicitud'::regproc);
  d := replace(d, 'if p_turno_id is null then raise exception ''Elige el turno.''; end if;',
                  'if p_turno_id is null then raise exception ''Elige el turno.''; end if;
  perform private.exigir_en_permutas(v_p);');
  execute d;

  d := pg_get_functiondef('public.ofertar'::regproc);
  d := replace(d, 'if v_s.persona_id = v_p then raise exception ''No puedes responder tu propia solicitud.''; end if;',
                  'if v_s.persona_id = v_p then raise exception ''No puedes responder tu propia solicitud.''; end if;
  perform private.exigir_en_permutas(v_p);');
  execute d;

  d := pg_get_functiondef('public.proponer_permuta'::regproc);
  d := replace(d, 'perform private.exigir_otro_dia(v_a.id, v_b.id);',
                  'perform private.exigir_otro_dia(v_a.id, v_b.id);
  perform private.exigir_en_permutas(v_p);
  perform private.exigir_en_permutas(v_b.persona_id, private.nombre_corto(v_b.persona_id));');
  execute d;

  -- la hoja oficial no borra turnos manuales ni los cuenta para detectar hojas incompletas
  d := pg_get_functiondef('private.actualizar_hoja'::regproc);
  d := replace(d, 'and fecha between v_desde_cambios and p_hasta and not es_cambio;',
                  'and fecha between v_desde_cambios and p_hasta and not es_cambio and not manual;');
  d := replace(d, 'and t.fecha between v_desde_cambios and p_hasta and not t.es_cambio',
                  'and t.fecha between v_desde_cambios and p_hasta and not t.es_cambio and not t.manual');
  execute d;
end $$;

-- Permutas en modo lectura para gerencia
create or replace function public.bolsa(p_seccion text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p bigint := private.exigir_persona(); v_lee boolean := not private.en_permutas(v_p);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'tipo', s.tipo, 'seccion', s.seccion, 'funcion', s.funcion, 'fechas', s.fechas, 'nota', s.nota,
      'creado', s.creado, 'mia', s.persona_id = v_p,
      'autor', private.nombre_corto(s.persona_id), 'autor_completo', pe.nombre, 'autor_tel', private.telefono_de(s.persona_id),
      'turno', private.json_turno(s.turno_id),
      'respuestas', (select count(*) from public.ofertas o where o.solicitud_id = s.id and o.estado in ('pendiente', 'elegida')),
      'mi_respuesta', (select o.estado from public.ofertas o where o.solicitud_id = s.id and o.persona_id = v_p
                        order by o.creado desc limit 1),
      'viabilidad', case when s.persona_id = v_p then null
                         when v_lee then jsonb_build_object('estado', 'no', 'motivo', 'Gerencia médica: solo lectura')
                         else private.viabilidad(v_p, s.id) end)
      order by coalesce((select t.inicio from public.turnos t where t.id = s.turno_id), s.fechas[1]::timestamptz))
      from public.solicitudes s join public.personas pe on pe.id = s.persona_id
     where s.seccion = p_seccion and s.estado = 'abierta' and s.destino_persona_id is null
       and (s.turno_id is null or exists (select 1 from public.turnos t where t.id = s.turno_id and t.inicio > now()))
       and (s.persona_id = v_p or v_lee or private.puede_tomar(v_p, s.seccion, s.funcion))), '[]'::jsonb);
end;
$$;

-- Editar turnos: gerencia siempre puede con los suyos
create or replace function private.puede_editar_turno(v_t public.turnos)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.es_admin()
      or (v_t.persona_id = private.mi_persona()
          and (not private.en_permutas(v_t.persona_id)
               or coalesce((select edicion_turnos from public.ajustes where id = 1), 'todos') = 'todos'));
$$;

-- Agregar un turno a mano (gerencia: los suyos · administración: los de cualquiera)
create or replace function public.agregar_turno(p_seccion text, p_fecha date, p_inicio text, p_fin text,
  p_comida text default null, p_descanso text default null, p_persona_id bigint default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_yo bigint := private.mi_persona(); v_p bigint := coalesce(p_persona_id, private.mi_persona());
  v_ini timestamptz; v_fin timestamptz; v_id bigint; v_ch record;
begin
  if v_p is null then raise exception 'Tu cuenta no está enlazada a una persona del horario.'; end if;
  if not (private.es_admin() or (v_p = v_yo and not private.en_permutas(v_yo))) then
    raise exception 'Solo gerencia médica o la administración pueden agregar turnos a mano.';
  end if;
  if p_seccion not in ('planilla', 'sp') then raise exception 'Elige Planilla o Servicios Profesionales.'; end if;
  if p_fecha is null then raise exception 'Elige la fecha.'; end if;
  if p_inicio !~ '^\d{2}:\d{2}$' or p_fin !~ '^\d{2}:\d{2}$' then raise exception 'Hora no válida.'; end if;
  v_ini := (p_fecha::text || ' ' || p_inicio || ':00-06')::timestamptz;
  v_fin := ((case when p_fin <= p_inicio then p_fecha + 1 else p_fecha end)::text || ' ' || p_fin || ':00-06')::timestamptz;

  select t.fecha, t.etiqueta into v_ch from public.turnos t
   where t.persona_id = v_p and t.inicio < v_fin and t.fin > v_ini limit 1;
  if found then
    raise exception 'Choca con el turno del % (%).', to_char(v_ch.fecha, 'DD/MM'), private.texto_horario(v_ch.etiqueta);
  end if;

  insert into public.turnos (persona_id, seccion, fecha, inicio, fin, funcion, etiqueta, comida, descanso, manual,
                             corregido_por, corregido)
  values (v_p, p_seccion, p_fecha, v_ini, v_fin, case p_seccion when 'sp' then 'general' else 'triaje' end,
          p_inicio || '–' || p_fin, nullif(p_comida, ''), nullif(p_descanso, ''), true, (select auth.uid()), now())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.agregar_turno(text, date, text, text, text, text, bigint) to authenticated;

-- Personas: categoría y alta manual
drop function if exists public.actualizar_persona(bigint, boolean, boolean, boolean, boolean);
create or replace function public.actualizar_persona(p_id bigint, p_es_supervisor boolean, p_referencias_planilla boolean,
  p_referencias_sp boolean, p_activo boolean, p_gerencia boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  update public.personas set es_supervisor = p_es_supervisor, referencias_planilla = p_referencias_planilla,
         referencias_sp = p_referencias_sp, activo = p_activo, gerencia = coalesce(p_gerencia, false)
   where id = p_id;
end;
$$;
grant execute on function public.actualizar_persona(bigint, boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.agregar_persona(p_nombre text, p_gerencia boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_nombre text := upper(trim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'))); v_id bigint;
begin
  if not private.es_admin() then raise exception 'Solo la administración.'; end if;
  if length(v_nombre) < 5 then raise exception 'Escribe el nombre completo.'; end if;
  insert into public.personas (nombre, nombre_norm, gerencia)
  values (v_nombre, private.norm(v_nombre), coalesce(p_gerencia, false))
  on conflict (nombre_norm) do nothing returning id into v_id;
  if v_id is null then raise exception 'Ya existe una persona con ese nombre.'; end if;
  return v_id;
end;
$$;
grant execute on function public.agregar_persona(text, boolean) to authenticated;

-- mi_cuenta: gerencia y si participa en permutas
create or replace function public.mi_cuenta()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'usuario', p.usuario, 'nombre', p.nombre, 'rol', p.rol, 'telefono', p.telefono,
    'activo', p.activo, 'aprobado', p.aprobado, 'tema', p.tema,
    'recordar_marcaje', p.recordar_marcaje, 'recordar_salida', p.recordar_salida, 'salida_min', p.salida_min,
    'marcaje_min', p.marcaje_min, 'avisar_bolsa', p.avisar_bolsa, 'avisar_pausas', p.avisar_pausas,
    'referencias_aviso', p.referencias_aviso, 'referencias_hora', to_char(p.referencias_hora, 'HH24:MI'),
    'puede_corregir', p.rol in ('admin', 'superadmin') or coalesce(pe.gerencia, false)
                      or coalesce((select edicion_turnos from public.ajustes where id = 1), 'todos') = 'todos',
    'persona_id', p.persona_id, 'persona', pe.nombre,
    'es_supervisor', coalesce(pe.es_supervisor, false),
    'referencias_planilla', coalesce(pe.referencias_planilla, false),
    'referencias_sp', coalesce(pe.referencias_sp, false),
    'gerencia', coalesce(pe.gerencia, false),
    'en_permutas', not coalesce(pe.gerencia, false),
    'agrega_turnos', p.rol in ('admin', 'superadmin') or coalesce(pe.gerencia, false))
    from public.perfiles p left join public.personas pe on pe.id = p.persona_id
   where p.id = (select auth.uid());
$$;

revoke all on function private.en_permutas(bigint), private.exigir_en_permutas(bigint, text) from public, anon, authenticated;
