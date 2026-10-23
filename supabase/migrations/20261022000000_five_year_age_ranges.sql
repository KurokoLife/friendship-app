-- 2026-10-22: age ranges shown on profiles are 5 years wide (founder):
-- 18-24, 25-29, 30-34, 35-39, ... 65-69, 70+. They used to be decades after
-- 30 ("40s"), which hid too much (early 40s and late 40s looked the same).
-- Only what is shown changes; who you're matched with still follows each
-- person's exact age setting (min_friend_age / max_friend_age).
-- Safe to run twice. limen_db_version() -> 20261022000000.

create or replace function public.age_band(p_birthdate date)
returns text
language sql
immutable
as $$
  select case
    when p_birthdate is null then null
    else (
      select case
        when age < 18 then 'Under 18'
        when age <= 24 then '18-24'
        when age >= 70 then '70+'
        else ((age / 5) * 5)::text || '-' || ((age / 5) * 5 + 4)::text
      end
      from (select extract(year from age(current_date::timestamptz, p_birthdate::timestamptz))::integer as age) a
    )
  end;
$$;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261022000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
