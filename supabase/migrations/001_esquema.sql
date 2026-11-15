-- =====================================================================
-- CHAMBEA · 001 · Esquema base
-- Bolsa de cambios de turno (Planilla y Servicios Profesionales)
-- Escrituras SOLO por funciones (RPC). Las tablas solo se leen con RLS.
-- =====================================================================

create extension if not exists unaccent with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;

-- Normaliza nombres: sin tildes, mayúsculas, un solo espacio
create or replace function private.norm(t text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select upper(regexp_replace(trim(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))), '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------- personas
-- Personas tal como aparecen en las hojas (existen aunque no tengan cuenta)
create table public.personas (
  id bigint generated always as identity primary key,
  nombre text not null,
  nombre_norm text not null unique,
  es_supervisor boolean not null default false,
  referencias_planilla boolean not null default false,
  referencias_sp boolean not null default false,
  activo boolean not null default true,
  creado timestamptz not null default now()
);

-- Otras formas en que el nombre aparece en las hojas
create table public.alias_personas (
  alias_norm text primary key,
  persona_id bigint not null references public.personas(id) on delete cascade,
  creado timestamptz not null default now()
);
create index alias_personas_persona_idx on public.alias_personas (persona_id);

-- ---------------------------------------------------------------- perfiles
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique check (usuario = lower(trim(usuario))),
  nombre text not null,
  persona_id bigint unique references public.personas(id) on delete set null,
  rol text not null default 'usuario' check (rol in ('superadmin', 'admin', 'usuario')),
  activo boolean not null default true,
  aprobado boolean not null default false,
  tema text,
  creado timestamptz not null default now()
);

-- ---------------------------------------------------------------- importaciones
create table public.importaciones (
  id bigint generated always as identity primary key,
  seccion text not null check (seccion in ('planilla', 'sp')),
  desde date not null,
  hasta date not null,
  archivo text,
  subido_por uuid references public.perfiles(id) on delete set null,
  resumen jsonb not null default '{}'::jsonb,
  creado timestamptz not null default now(),
  check (hasta >= desde)
);
create index importaciones_subido_por_idx on public.importaciones (subido_por);

-- ---------------------------------------------------------------- turnos
create table public.turnos (
  id bigint generated always as identity primary key,
  persona_id bigint not null references public.personas(id) on delete cascade,
  seccion text not null check (seccion in ('planilla', 'sp')),
  fecha date not null,                 -- día en que inicia el turno
  inicio timestamptz not null,
  fin timestamptz not null,
  funcion text not null,
  etiqueta text not null,              -- p. ej. '07:00–19:00'
  importacion_id bigint references public.importaciones(id) on delete set null,
  es_cambio boolean not null default false,   -- 🔁
  persona_original_id bigint references public.personas(id) on delete set null,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  check (fin > inicio),
  check ((seccion = 'planilla' and funcion in ('triaje', 'referencias', 'supervisor'))
      or (seccion = 'sp' and funcion in ('general', 'referencias'))),
  unique (persona_id, seccion, inicio)
);
create index turnos_persona_inicio_idx on public.turnos (persona_id, inicio);
create index turnos_seccion_fecha_idx on public.turnos (seccion, fecha);
create index turnos_importacion_idx on public.turnos (importacion_id);
create index turnos_persona_original_idx on public.turnos (persona_original_id);

-- ---------------------------------------------------------------- solicitudes
create table public.solicitudes (
  id bigint generated always as identity primary key,
  seccion text not null check (seccion in ('planilla', 'sp')),
  tipo text not null check (tipo in ('permuta', 'ceder', 'cobertura', 'busco')),
  persona_id bigint not null references public.personas(id) on delete cascade,
  creado_por uuid references public.perfiles(id) on delete set null,
  turno_id bigint references public.turnos(id) on delete set null,
  funcion text not null,
  fechas date[] not null default '{}',  -- permuta: fechas que me sirven · busco: fechas que busco
  nota text check (char_length(nota) <= 300),
  estado text not null default 'abierta'
    check (estado in ('abierta', 'por_confirmar', 'aplicada', 'cancelada', 'vencida')),
  oferta_elegida_id bigint,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index solicitudes_estado_seccion_idx on public.solicitudes (estado, seccion);
create index solicitudes_persona_idx on public.solicitudes (persona_id);
create index solicitudes_turno_idx on public.solicitudes (turno_id);
create index solicitudes_creado_por_idx on public.solicitudes (creado_por);
-- Un turno solo puede estar en una solicitud viva a la vez
create unique index solicitudes_turno_viva_uq on public.solicitudes (turno_id)
  where estado in ('abierta', 'por_confirmar');

-- ---------------------------------------------------------------- ofertas
create table public.ofertas (
  id bigint generated always as identity primary key,
  solicitud_id bigint not null references public.solicitudes(id) on delete cascade,
  persona_id bigint not null references public.personas(id) on delete cascade,
  creado_por uuid references public.perfiles(id) on delete set null,
  turno_id bigint references public.turnos(id) on delete set null,  -- lo que ofrezco a cambio (permuta / busco)
  nota text check (char_length(nota) <= 300),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'elegida', 'aceptada', 'rechazada', 'retirada')),
  choques jsonb not null default '[]'::jsonb,  -- avisos que la persona confirmó
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index ofertas_solicitud_idx on public.ofertas (solicitud_id);
create index ofertas_persona_idx on public.ofertas (persona_id);
create index ofertas_turno_idx on public.ofertas (turno_id);
create index ofertas_creado_por_idx on public.ofertas (creado_por);
create unique index ofertas_viva_uq on public.ofertas (solicitud_id, persona_id)
  where estado in ('pendiente', 'elegida');

alter table public.solicitudes
  add constraint solicitudes_oferta_elegida_fk
  foreign key (oferta_elegida_id) references public.ofertas(id) on delete set null;
create index solicitudes_oferta_elegida_idx on public.solicitudes (oferta_elegida_id);

-- ---------------------------------------------------------------- cambios (historial 🔁)
create table public.cambios (
  id bigint generated always as identity primary key,
  solicitud_id bigint references public.solicitudes(id) on delete set null,
  oferta_id bigint references public.ofertas(id) on delete set null,
  turno_id bigint not null references public.turnos(id) on delete cascade,
  de_persona_id bigint not null references public.personas(id) on delete cascade,
  a_persona_id bigint not null references public.personas(id) on delete cascade,
  revertido boolean not null default false,
  creado timestamptz not null default now()
);
create index cambios_solicitud_idx on public.cambios (solicitud_id);
create index cambios_oferta_idx on public.cambios (oferta_id);
create index cambios_turno_idx on public.cambios (turno_id);
create index cambios_de_idx on public.cambios (de_persona_id);
create index cambios_a_idx on public.cambios (a_persona_id);

-- ---------------------------------------------------------------- notificaciones
create table public.notificaciones (
  id bigint generated always as identity primary key,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  cuerpo text,
  url text,
  leida boolean not null default false,
  creado timestamptz not null default now()
);
create index notificaciones_perfil_idx on public.notificaciones (perfil_id, leida, creado desc);

-- ---------------------------------------------------------------- ajustes
create table public.ajustes (
  id integer primary key default 1 check (id = 1),
  max_horas_continuas integer not null default 24 check (max_horas_continuas between 8 and 72),
  min_descanso_min integer not null default 60 check (min_descanso_min between 0 and 720),
  actualizado timestamptz not null default now()
);
insert into public.ajustes (id) values (1);

-- =====================================================================
-- Ayudantes para RLS
-- =====================================================================
create or replace function private.es_activo()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles
                  where id = (select auth.uid()) and activo and aprobado);
$$;

create or replace function private.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles
                  where id = (select auth.uid()) and activo and rol in ('superadmin', 'admin'));
$$;

create or replace function private.mi_persona()
returns bigint language sql stable security definer set search_path = '' as $$
  select persona_id from public.perfiles
   where id = (select auth.uid()) and activo and aprobado;
$$;

revoke all on function private.norm(text), private.es_activo(), private.es_admin(), private.mi_persona()
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.es_activo(), private.es_admin(), private.mi_persona() to authenticated;

-- =====================================================================
-- RLS: solo lectura; todo cambio pasa por funciones
-- =====================================================================
alter table public.personas       enable row level security;
alter table public.alias_personas enable row level security;
alter table public.perfiles       enable row level security;
alter table public.importaciones  enable row level security;
alter table public.turnos         enable row level security;
alter table public.solicitudes    enable row level security;
alter table public.ofertas        enable row level security;
alter table public.cambios        enable row level security;
alter table public.notificaciones enable row level security;
alter table public.ajustes        enable row level security;

revoke all on public.personas, public.alias_personas, public.perfiles, public.importaciones,
  public.turnos, public.solicitudes, public.ofertas, public.cambios, public.notificaciones,
  public.ajustes from anon, authenticated;
grant select on public.personas, public.alias_personas, public.perfiles, public.importaciones,
  public.turnos, public.solicitudes, public.ofertas, public.cambios, public.notificaciones,
  public.ajustes to authenticated;

create policy personas_leer on public.personas for select to authenticated
  using ((select private.es_activo()));
create policy turnos_leer on public.turnos for select to authenticated
  using ((select private.es_activo()));
create policy solicitudes_leer on public.solicitudes for select to authenticated
  using ((select private.es_activo()));
create policy ofertas_leer on public.ofertas for select to authenticated
  using ((select private.es_activo()));
create policy cambios_leer on public.cambios for select to authenticated
  using ((select private.es_activo()));
create policy ajustes_leer on public.ajustes for select to authenticated
  using (true);
create policy perfiles_leer on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select private.es_admin()));
create policy notificaciones_leer on public.notificaciones for select to authenticated
  using (perfil_id = (select auth.uid()));
create policy alias_leer on public.alias_personas for select to authenticated
  using ((select private.es_admin()));
create policy importaciones_leer on public.importaciones for select to authenticated
  using ((select private.es_admin()));

-- =====================================================================
-- Perfil automático al registrarse (usuario + PIN; correo ficticio)
-- =====================================================================
create or replace function private.nuevo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, usuario, nombre)
  values (
    new.id,
    lower(trim(coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1)))),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;
revoke all on function private.nuevo_usuario() from public, anon, authenticated;

create trigger al_crear_usuario
after insert on auth.users
for each row execute function private.nuevo_usuario();
