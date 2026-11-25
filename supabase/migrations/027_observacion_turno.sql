-- 027 · Observación del turno (PERMUTA, PERMISO PERSONAL…) que viene escrita debajo del horario en la hoja
--  · turnos.observacion: se guarda al cargar/sincronizar y se actualiza si cambia en la hoja
--  · quitar_turno: solo turnos agregados a mano (los de la hoja vuelven en la siguiente sincronización);
--    la administración puede quitar cualquiera

alter table public.turnos add column if not exists observacion text;

do $$
declare d text; n text;
begin
  d := pg_get_functiondef('private.actualizar_hoja'::regproc);
  n := replace(d, 'nullif(f ->> ''descanso'', '''') as descanso,',
                  'nullif(f ->> ''descanso'', '''') as descanso, nullif(f ->> ''observacion'', '''') as observacion,');
  n := replace(n, 't.funcion as funcion_antes',
                  't.funcion as funcion_antes, t.observacion as obs_antes');
  n := replace(n, '  create temp table _bajas on commit drop as',
                  '  update public.turnos t set observacion = p.observacion from _par p
   where t.id = p.turno_id and coalesce(p.observacion, '''') <> coalesce(p.obs_antes, '''');

  create temp table _bajas on commit drop as');
  n := replace(n, 'funcion, etiqueta, comida, descanso,
                             importacion_id, marcaje_avisado, inicio_avisado)
  select persona_id, p_seccion, fecha, inicio, fin, funcion, etiqueta, comida, descanso, v_imp, inicio <= now(), inicio <= now()',
                  'funcion, etiqueta, comida, descanso,
                             importacion_id, marcaje_avisado, inicio_avisado, observacion)
  select persona_id, p_seccion, fecha, inicio, fin, funcion, etiqueta, comida, descanso, v_imp, inicio <= now(), inicio <= now(), observacion');
  if (length(n) - length(replace(n, 'observacion', ''))) / length('observacion') < 8 then
    raise exception 'no se pudo ajustar actualizar_hoja';
  end if;
  execute n;
end $$;

create or replace function public.quitar_turno(p_turno_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.turnos;
begin
  select * into v_t from public.turnos where id = p_turno_id for update;
  if not found then raise exception 'Ese turno no existe.'; end if;
  if not private.puede_editar_turno(v_t) then raise exception 'No puedes quitar este turno.'; end if;
  if not v_t.manual and not private.es_admin() then
    raise exception 'Este turno viene de la hoja oficial y volvería a aparecer. Si tiene un error, usa "Corregir" o avisa a la administración.';
  end if;
  if exists (select 1 from public.solicitudes where turno_id = p_turno_id and estado in ('abierta', 'por_confirmar'))
     or exists (select 1 from public.ofertas where turno_id = p_turno_id and estado in ('pendiente', 'elegida')) then
    raise exception 'Este turno está en una permuta abierta. Cancélala primero.';
  end if;
  if exists (select 1 from public.cambios where turno_id = p_turno_id and not revertido) then
    raise exception 'Este turno viene de un cambio. Deshaz el cambio en Permutas → Míos.';
  end if;
  delete from public.turnos where id = p_turno_id;
  if not private.es_admin() then
    perform private.notificar_admins('turno_corregido', 'Turno quitado',
      private.nombre_corto(v_t.persona_id) || ' quitó su turno del ' || to_char(v_t.fecha, 'DD/MM') || ' (' || v_t.etiqueta || ').', '/?vista=admin');
  end if;
end;
$$;
