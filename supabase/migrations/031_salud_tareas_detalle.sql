-- 031 · revisar_salud: solo cuenta tareas con status 'failed' (antes contaba la propia tarea en curso)
-- y muestra el detalle del último error. Aplicada con reemplazo de texto sobre la función de 026.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('private.revisar_salud'::regproc);
  n := replace(d, $a$and status <> 'succeeded';$a$, $b$and status = 'failed';$b$);
  if n <> d then execute n; end if;
end $$;
