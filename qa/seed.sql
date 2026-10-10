-- Test people: the 9 seed accounts plus an admin ("Mochi"), mirroring production.
do $$
declare
  r record;
begin
  for r in select * from (values
    ('10000000-0000-0000-0000-000000000001'::uuid, '+15555500101', 'Maria', 'Santos', 'woman'),
    ('10000000-0000-0000-0000-000000000002'::uuid, '+15555500102', 'David', 'Chen', 'man'),
    ('10000000-0000-0000-0000-000000000003'::uuid, '+15555500103', 'Aisha', 'Bello', 'woman'),
    ('10000000-0000-0000-0000-000000000004'::uuid, '+15555500104', 'Robert', 'Kim', 'man'),
    ('10000000-0000-0000-0000-000000000005'::uuid, '+15555500105', 'Priya', 'Nair', 'woman'),
    ('10000000-0000-0000-0000-000000000006'::uuid, '+15555500106', 'Marcus', 'Alvarez', 'man'),
    ('10000000-0000-0000-0000-000000000007'::uuid, '+15555500107', 'Jordan', 'Blake', 'non_binary'),
    ('10000000-0000-0000-0000-000000000008'::uuid, '+15555500108', 'Sam', 'Rivera', 'woman'),
    ('10000000-0000-0000-0000-000000000009'::uuid, '+15555500109', 'Elena', 'Torres', 'woman'),
    ('10000000-0000-0000-0000-0000000000aa'::uuid, '+13105550000', 'Mochi', 'Watanabe', 'woman')
  ) as t(id, phone, first, last, gender) loop
    insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, last_sign_in_at)
    values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.phone, now(), '{"provider":"phone"}', '{}', now() - interval '30 days', now());
    insert into public.users (id, phone, gender_identity, meet_genders, messaging_preference, readiness_status,
      behavioral_tracking_disclosed_at, terms_accepted_at, verified)
    values (r.id, r.phone, r.gender, array['everyone'], 'anyone', 'ready', now() - interval '29 days', now() - interval '29 days', true);
    insert into public.profiles (user_id, first_name, last_name, birthdate, photo_url, location_city, location_state,
      location_lat, location_lng, search_radius_miles, min_friend_age, max_friend_age, response_time, completion_pct)
    values (r.id, r.first, r.last, date '1980-05-05', 'https://i.pravatar.cc/300?u=' || r.id, 'Los Angeles', 'California',
      34.05, -118.24, 50, 18, 100, '1-2 days', 100);
  end loop;
end $$;

-- Admin: production's users_protect_safety_columns trigger stops clients
-- changing is_admin; as the database owner this is allowed.
alter table public.users disable trigger users_protect_safety_columns;
update public.users set is_admin = true where id = '10000000-0000-0000-0000-0000000000aa';
alter table public.users enable trigger users_protect_safety_columns;
