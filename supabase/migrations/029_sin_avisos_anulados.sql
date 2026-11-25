-- 029 · actualizar_hoja: la observación se actualiza antes de las pausas y no se avisan pausas ni altas
-- de turnos marcados con Permuta / Permiso / Incapacidad (ya no los trabaja esa persona).
do $$
declare d text; n text; bloque text := '  update public.turnos t set observacion = p.observacion from _par p
   where t.id = p.turno_id and coalesce(p.observacion, '''') <> coalesce(p.obs_antes, '''');

';
begin
  d := pg_get_functiondef('private.actualizar_hoja'::regproc);
  n := replace(d, bloque, '');
  n := replace(n, '  create temp table _pausas (', bloque || '  create temp table _pausas (');
  n := replace(n, 'from _pausas where inicio > now() group by persona_id',
    'from _pausas where inicio > now()
       and not exists (select 1 from public.turnos x where x.persona_id = _pausas.persona_id and x.inicio = _pausas.inicio and x.anulado)
     group by persona_id');
  n := replace(n, 'select persona_id, fecha from _altas where inicio > now()) c',
    'select persona_id, fecha from _altas where inicio > now() and coalesce(observacion, '''') !~* ''(permuta|permiso|incapacidad)'') c');
  if position('x.anulado' in n) = 0 or position('!~*' in n) = 0 then raise exception 'no se pudo ajustar'; end if;
  execute n;
end $$;
