-- 59 · Nombres de proyectos y equipos sin MAYÚSCULAS SOSTENIDAS.
--
-- Pedido de Juan Manuel Vicaría (18/11/2026), aprobado por Daniel: los nombres
-- escritos todo en mayúsculas ("FONDO CENTENARIO") pasan a mayúscula inicial en
-- cada palabra ("Fondo Centenario"), con los conectores en minúscula
-- ("Zona de Verificación"). Incluye siglas y marcas cortas (ARCO → Arco).
-- Los nombres que ya traen minúsculas se respetan tal cual (sabIO, CDO Alianza).
--
-- 1. La función nombre_sin_mayusculas().
-- 2. Triggers en proyectos.nombre, equipos.nombre_equipo y proyecto.titulo:
--    lo que llegue en mayúsculas, venga de donde venga, se guarda corregido.
-- 3. Corrige los nombres existentes y las actas que aún no se han enviado
--    (estado 'faltan_datos'). Las actas enviadas o completas no se tocan: su
--    PDF ya salió a firma con el nombre de ese momento.
--
-- Orden de despliegue: solo este SQL (el código no cambia).

create or replace function public.nombre_sin_mayusculas(t text)
returns text
language plpgsql
immutable
as $$
declare
  limpio text;
  letras text;
  palabras text[];
  i int;
  conectores constant text[] := array['de','del','la','las','los','el','y','e','o','u','en','para','por','con','al','a','sin','of','and','the','for'];
begin
  if t is null then return null; end if;
  limpio := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  letras := regexp_replace(limpio, '[^[:alpha:]]', '', 'g');
  -- Solo se corrige lo que está TODO en mayúsculas (y tiene al menos 2 letras).
  if length(letras) < 2 or letras <> upper(letras) then
    return limpio;
  end if;
  palabras := string_to_array(initcap(lower(limpio)), ' ');
  for i in 1 .. coalesce(array_length(palabras, 1), 0) loop
    if i > 1 and lower(palabras[i]) = any (conectores) then
      palabras[i] := lower(palabras[i]);
    elsif upper(palabras[i]) in ('SAS', 'S.A.S', 'S.A.S.', 'SA', 'S.A.', 'BIC') then
      palabras[i] := upper(palabras[i]);           -- tipo de sociedad
    elsif upper(palabras[i]) = 'LTDA' or upper(palabras[i]) = 'LTDA.' then
      palabras[i] := initcap(lower(palabras[i]));  -- Ltda.
    end if;
  end loop;
  return array_to_string(palabras, ' ');
end;
$$;

comment on function public.nombre_sin_mayusculas(text) is
  'Pasa a mayúscula inicial los nombres escritos todo en mayúsculas (pedido de Juan Manuel, 18/11/2026). Lo demás lo deja igual.';

create or replace function public.trg_nombre_sin_mayusculas()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'proyectos' then
    new.nombre := public.nombre_sin_mayusculas(new.nombre);
  elsif tg_table_name = 'equipos' then
    new.nombre_equipo := public.nombre_sin_mayusculas(new.nombre_equipo);
  elsif tg_table_name = 'proyecto' then
    new.titulo := public.nombre_sin_mayusculas(new.titulo);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_nombre_sin_mayusculas on public.proyectos;
create trigger trg_nombre_sin_mayusculas before insert or update of nombre on public.proyectos
  for each row execute function public.trg_nombre_sin_mayusculas();

drop trigger if exists trg_nombre_sin_mayusculas on public.equipos;
create trigger trg_nombre_sin_mayusculas before insert or update of nombre_equipo on public.equipos
  for each row execute function public.trg_nombre_sin_mayusculas();

drop trigger if exists trg_nombre_sin_mayusculas on public.proyecto;
create trigger trg_nombre_sin_mayusculas before insert or update of titulo on public.proyecto
  for each row execute function public.trg_nombre_sin_mayusculas();

-- Datos existentes (el trigger hace la corrección; solo se tocan los que cambian).
update public.proyectos set nombre = nombre        where nombre        is distinct from public.nombre_sin_mayusculas(nombre);
update public.equipos   set nombre_equipo = nombre_equipo where nombre_equipo is distinct from public.nombre_sin_mayusculas(nombre_equipo);
update public.proyecto  set titulo = titulo        where titulo        is distinct from public.nombre_sin_mayusculas(titulo);

update public.acta set nombre_proyecto = public.nombre_sin_mayusculas(nombre_proyecto)
 where estado = 'faltan_datos'
   and nombre_proyecto is distinct from public.nombre_sin_mayusculas(nombre_proyecto);
