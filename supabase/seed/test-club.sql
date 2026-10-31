-- A test club owned by alexpatten13@gmail.com, to click around in. Safe to run twice: it
-- does nothing if the club (/c/test-club) already exists. To start over, delete it first:
--   delete from public.clubs where slug = 'test-club';
--
-- Run after the migrations:
--   npx supabase db query --linked -f supabase/seed/test-club.sql
--
-- It acts as that account (the res_* functions read auth.uid() from the JWT claims), so it
-- goes through the same rules and functions as the app.

do $$
declare
  owner_id uuid;
  club jsonb;
  club_id uuid;
  tz text := 'America/New_York';
  courts jsonb;
  tennis uuid;
  sched uuid;
  doubles uuid;
  open_play uuid;
  private_lesson uuid;
  clinic_type uuid;
  lessons jsonb;
  head_pro uuid;
  teaching_pro uuid;
  me_instructor uuid;
  maria uuid;
  tomorrow date;
  next_week date;
begin
  select id into owner_id from auth.users where lower(email) = 'alexpatten13@gmail.com';
  if owner_id is null then
    raise exception 'No account for alexpatten13@gmail.com';
  end if;
  if exists (select 1 from public.clubs where slug = 'test-club') then
    raise notice 'The test club already exists: /c/test-club';
    return;
  end if;

  -- Act as the owner for the rest of this transaction.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', owner_id::text, true);

  club := public.res_create_club('Pickle Spots Test Club', 'test-club', tz, 5, '123 Main St, Test City');
  club_id := (club ->> 'id')::uuid;
  sched := (club -> 'schedulers' -> 0 ->> 'id')::uuid;
  doubles := (select (t ->> 'id')::uuid from jsonb_array_elements(club -> 'types') t where t ->> 'name' = 'Doubles');
  open_play := (select (t ->> 'id')::uuid from jsonb_array_elements(club -> 'types') t where t ->> 'name' = 'Open Play');
  private_lesson := (select (t ->> 'id')::uuid from jsonb_array_elements(club -> 'types') t where t ->> 'name' = 'Private Lesson');
  clinic_type := (select (t ->> 'id')::uuid from jsonb_array_elements(club -> 'types') t where t ->> 'name' = 'Clinic');

  -- Court 5 becomes a tennis court split into two pickleball courts (combo courts), plus a ball machine.
  tennis := (select (c ->> 'id')::uuid from jsonb_array_elements(club -> 'courts') c where c ->> 'name' = 'Court 5');
  perform public.res_save_court(club_id, jsonb_build_object('id', tennis, 'name', 'Tennis 1', 'sport', 'tennis', 'schedulerIds', jsonb_build_array(sched)));
  perform public.res_save_court(club_id, jsonb_build_object('name', 'Tennis 1A', 'parentId', tennis, 'schedulerIds', jsonb_build_array(sched)));
  perform public.res_save_court(club_id, jsonb_build_object('name', 'Tennis 1B', 'parentId', tennis, 'schedulerIds', jsonb_build_array(sched)));
  courts := public.res_save_court(club_id, jsonb_build_object('name', 'Ball Machine', 'kind', 'ball_machine', 'sport', 'other', 'maxMinutes', 60, 'schedulerIds', jsonb_build_array(sched))) -> 'courts';

  -- Prime time on weekday evenings.
  perform public.res_save_prime_time(club_id, '{"name": "Prime Time", "days": [1,2,3,4,5], "starts": "17:00", "ends": "20:00", "maxMinutes": 90, "maxPerWeek": 2}');

  -- Lessons: you as Head Pro (linked, so you get the Teaching tab), and a second pro.
  lessons := public.res_save_instructor_type(club_id, '{"name": "Head Pro"}');
  lessons := public.res_save_instructor_type(club_id, '{"name": "Teaching Pro"}');
  head_pro := (select (t ->> 'id')::uuid from jsonb_array_elements(lessons -> 'instructorTypes') t where t ->> 'name' = 'Head Pro');
  teaching_pro := (select (t ->> 'id')::uuid from jsonb_array_elements(lessons -> 'instructorTypes') t where t ->> 'name' = 'Teaching Pro');
  lessons := public.res_save_instructor(club_id, jsonb_build_object(
    'name', 'Alex Patten', 'typeId', head_pro, 'color', '#F2711C', 'account', 'alexpatten13@gmail.com',
    'bio', 'Head pro (test). Drills, strategy and match play for all levels.',
    'availability', jsonb_build_array(
      jsonb_build_object('days', jsonb_build_array(1,2,3,4,5), 'starts', '08:00', 'ends', '12:00'),
      jsonb_build_object('days', jsonb_build_array(0,1,2,3,4,5,6), 'starts', '16:00', 'ends', '20:00')
    )
  ));
  lessons := public.res_save_instructor(club_id, jsonb_build_object(
    'name', 'Maria Evans', 'typeId', teaching_pro, 'color', '#6A4FC8',
    'bio', 'Former college player. Beginners, juniors and doubles strategy.',
    'availability', jsonb_build_array(jsonb_build_object('days', jsonb_build_array(0,1,2,3,4,5,6), 'starts', '09:00', 'ends', '15:00'))
  ));
  me_instructor := (select (i ->> 'id')::uuid from jsonb_array_elements(lessons -> 'instructors') i where i ->> 'name' = 'Alex Patten');
  maria := (select (i ->> 'id')::uuid from jsonb_array_elements(lessons -> 'instructors') i where i ->> 'name' = 'Maria Evans');
  perform public.res_save_rate(club_id, '{"name": "Private", "priceCents": 6000}');
  perform public.res_save_rate(club_id, jsonb_build_object('instructorTypeId', head_pro, 'name', 'Private', 'priceCents', 8000));
  perform public.res_save_rate(club_id, jsonb_build_object('name', 'Semi-private', 'maxPlayers', 2, 'priceCents', 10000));

  tomorrow := (now() at time zone tz)::date + 1;
  next_week := (now() at time zone tz)::date + 7;

  -- A clinic: three weekly dates starting next week.
  perform public.res_create_clinic(club_id, jsonb_build_object(
    'title', 'Intro to Pickleball', 'description', 'Never played? Learn the rules, the serve and the dink. Paddles provided.',
    'instructorId', maria, 'typeId', clinic_type, 'courtId', (select (c ->> 'id')::uuid from jsonb_array_elements(courts) c where c ->> 'name' = 'Court 4'),
    'days', jsonb_build_array(extract(dow from next_week)::integer), 'startTime', '10:00', 'minutes', 90,
    'from', next_week, 'until', next_week + 14, 'maxPlayers', 8, 'priceCents', 9000, 'dropInPriceCents', 3500
  ));

  -- Something on the schedule tomorrow: your doubles game, open play, and a lesson you're teaching.
  perform public.res_book(
    (select (c ->> 'id')::uuid from jsonb_array_elements(courts) c where c ->> 'name' = 'Court 1'), doubles,
    ((tomorrow + time '18:00') at time zone tz), ((tomorrow + time '19:30') at time zone tz),
    '{}', array['Guest Player'], 'Evening doubles'
  );
  perform public.res_book(
    (select (c ->> 'id')::uuid from jsonb_array_elements(courts) c where c ->> 'name' = 'Court 2'), open_play,
    ((tomorrow + time '09:00') at time zone tz), ((tomorrow + time '11:00') at time zone tz),
    '{}', '{}', 'Morning Open Play', null, '{}', null, true
  );
  perform public.res_book_lesson(me_instructor, private_lesson, ((tomorrow + time '16:00') at time zone tz), 60, '{}', array['Test Student']);

  raise notice 'Created the test club: /c/test-club';
end;
$$;
