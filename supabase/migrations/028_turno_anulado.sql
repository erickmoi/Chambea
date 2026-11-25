-- 028 · Turnos marcados en la hoja con PERMUTA / PERMISO / INCAPACIDAD: esa persona ya no los trabaja
--  · turnos.anulado (calculado de la observación)
--  · sin recordatorios (entrada, inicio, salida, referencias)
--  · no cuentan para reglas de permuta (choques, descansos, 24 h) ni se pueden permutar
--  · la revisión de salud no los cuenta como cruces

alter table public.turnos add column if not exists anulado boolean
  generated always as (coalesce(observacion ~* '(permuta|permiso|incapacidad)', false)) stored;

create or replace function private.banderas_turno()
returns trigger language plpgsql set search_path = '' as $$
declare v_anulado boolean := coalesce(new.observacion ~* '(permuta|permiso|incapacidad)', false);
begin
  new.marcaje_avisado := v_anulado or new.inicio <= now();
  new.inicio_avisado := v_anulado or new.inicio <= now();
  new.salida_avisada := v_anulado or new.fin <= now();
  new.referencias_avisado := v_anulado or new.fin <= now() or not (new.seccion = 'planilla' and new.funcion = 'referencias');
  return new;
end;
$$;
drop trigger if exists turnos_banderas on public.turnos;
create trigger turnos_banderas before insert or update of inicio, fin, observacion on public.turnos
  for each row execute function private.banderas_turno();

-- Los ya cargados: sin avisos pendientes
update public.turnos set marcaje_avisado = true, inicio_avisado = true, salida_avisada = true, referencias_avisado = true
 where anulado;

-- Reglas: un turno anulado no existe para choques, descansos ni jornada de 24 h
do $$
declare d text; n text; f text;
begin
  foreach f in array array['private.avisos', 'private.choques'] loop
    d := pg_get_functiondef(f::regproc);
    n := replace(d, 'where t.persona_id = p_persona and not (t.id = any(p_excluir))',
                    'where t.persona_id = p_persona and not (t.id = any(p_excluir)) and not t.anulado');
    if n = d then raise exception 'no se pudo ajustar %', f; end if;
    execute n;
  end loop;

  d := pg_get_functiondef('public.sugerir_permutas'::regproc);
  n := replace(d, 'and b.etiqueta = v_a.etiqueta and b.fecha <> v_a.fecha',
                  'and b.etiqueta = v_a.etiqueta and b.fecha <> v_a.fecha and not b.anulado');
  n := replace(n, 'if v_a.inicio <= now() then raise exception ''Ese turno ya empezó o ya pasó.''; end if;',
                  'if v_a.inicio <= now() then raise exception ''Ese turno ya empezó o ya pasó.''; end if;
  if v_a.anulado then raise exception ''Ese turno ya no es tuyo (%).'', v_a.observacion; end if;');
  if n = d then raise exception 'no se pudo ajustar sugerir_permutas'; end if;
  execute n;

  d := pg_get_functiondef('private.viabilidad'::regproc);
  n := replace(d, 'and b.inicio > now() and b.id <> v_a.id and b.fecha <> v_a.fecha',
                  'and b.inicio > now() and b.id <> v_a.id and b.fecha <> v_a.fecha and not b.anulado');
  if n = d then raise exception 'no se pudo ajustar viabilidad'; end if;
  execute n;

  d := pg_get_functiondef('public.publicar_solicitud'::regproc);
  n := replace(d, 'if v_t.inicio <= now() then raise exception ''Ese turno ya empezó o ya pasó.''; end if;',
                  'if v_t.inicio <= now() then raise exception ''Ese turno ya empezó o ya pasó.''; end if;
  if v_t.anulado then raise exception ''Ese turno ya no es tuyo (%).'', v_t.observacion; end if;');
  if n = d then raise exception 'no se pudo ajustar publicar_solicitud'; end if;
  execute n;

  d := pg_get_functiondef('public.ofertar'::regproc);
  n := replace(d, 'if v_b.inicio <= now() then raise exception ''Ese turno ya empezó o ya pasó.''; end if;',
                  'if v_b.inicio <= now() then raise exception ''Ese turno ya empezó o ya pasó.''; end if;
    if v_b.anulado then raise exception ''Ese turno ya no es tuyo (%).'', v_b.observacion; end if;');
  if n = d then raise exception 'no se pudo ajustar ofertar'; end if;
  execute n;

  d := pg_get_functiondef('private.revisar_salud'::regproc);
  n := replace(d, 'on a.persona_id = b.persona_id and a.id < b.id and a.inicio < b.fin and b.inicio < a.fin',
                  'on a.persona_id = b.persona_id and a.id < b.id and a.inicio < b.fin and b.inicio < a.fin and not a.anulado and not b.anulado');
  if n = d then raise exception 'no se pudo ajustar revisar_salud'; end if;
  execute n;
end $$;
