-- 030 · "Permuta recibida" (turno con P y fondo gris en la hoja) SÍ se trabaja; solo se anula lo dado o el permiso
alter table public.turnos drop column if exists anulado;
alter table public.turnos add column anulado boolean
  generated always as (observacion is not null and observacion !~* 'recibid') stored;

create or replace function private.banderas_turno()
returns trigger language plpgsql set search_path = '' as $$
declare v_anulado boolean := new.observacion is not null and new.observacion !~* 'recibid';
begin
  new.marcaje_avisado := v_anulado or new.inicio <= now();
  new.inicio_avisado := v_anulado or new.inicio <= now();
  new.salida_avisada := v_anulado or new.fin <= now();
  new.referencias_avisado := v_anulado or new.fin <= now() or not (new.seccion = 'planilla' and new.funcion = 'referencias');
  return new;
end;
$$;

do $$
declare d text; n text;
begin
  d := pg_get_functiondef('private.actualizar_hoja'::regproc);
  n := replace(d, 'and coalesce(observacion, '''') !~* ''(permuta|permiso|incapacidad)'') c',
                  'and (observacion is null or observacion ~* ''recibid'')) c');
  if n = d then raise exception 'no se pudo ajustar actualizar_hoja'; end if;
  execute n;
end $$;
