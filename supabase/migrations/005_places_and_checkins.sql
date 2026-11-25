-- 005: Pivot from hidden metro-ticket treasures to curated places that visitors check in to.
-- Removes the treasure game and its data, keeps user accounts, resets points to the welcome bonus.

------------------------------------------------------------------------------
-- Remove the treasure game
------------------------------------------------------------------------------
drop function if exists public.scan_tag(text, float8, float8);
drop function if exists public.create_treasure(text, text, text, text, text, public.treasure_rarity, float8, float8);
drop function if exists public.treasure_proximity(uuid, float8, float8);
drop function if exists public.area_center(float8, float8);
drop function if exists public.normalize_uid(text);
drop table if exists public.treasure_reports, public.treasure_comments, public.user_treasures, public.ticket_scans cascade;
drop function if exists public.hide_reported_treasure();
delete from public.feed_events;
alter table public.feed_events drop column if exists treasure_id;
drop table if exists public.treasures cascade;
drop type if exists public.treasure_rarity;

alter table public.profiles drop column if exists role;
drop type if exists public.profile_role;

delete from public.app_config where key not in ('signup_bonus', 'referral_bonus');
insert into public.app_config (key, value) values ('checkin_radius_m', 100), ('collection_bonus', 100)
on conflict (key) do update set value = excluded.value;

-- Fresh start for existing users: old follows and points go, everyone gets the welcome bonus.
delete from public.follows;
delete from public.point_transactions;
update public.profiles set points = 0, lifetime_points = 0;
insert into public.point_transactions (user_id, amount, reason)
select id, public.cfg('signup_bonus'), 'signup_bonus' from public.profiles;

------------------------------------------------------------------------------
-- Collections and places (managed by the admin in the Supabase table editor)
------------------------------------------------------------------------------
create table public.collections (
  id text primary key,
  name_en text not null,
  name_el text not null,
  color text not null default '#4a7c59',
  sort integer not null default 0
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  collection_id text not null references public.collections(id),
  name_en text not null,
  name_el text not null,
  description_en text,
  description_el text,
  latitude float8 not null,
  longitude float8 not null,
  points integer not null default 50 check (points >= 0),
  image_url text,
  nfc_uid text unique,           -- UID of the NFC tag at the place (upper-case hex); private
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.collections enable row level security;
alter table public.places enable row level security;
create policy "Collections are public" on public.collections for select to anon, authenticated using (true);
create policy "Active places are public" on public.places for select to anon, authenticated using (is_active);
revoke all on public.collections, public.places from anon, authenticated;
grant select on public.collections to anon, authenticated;
grant select (id, collection_id, name_en, name_el, description_en, description_el, latitude, longitude, points, image_url, is_active, created_at)
  on public.places to anon, authenticated;

------------------------------------------------------------------------------
-- Visits (one per user per place) and reviews
------------------------------------------------------------------------------
create table public.visits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  method text not null check (method in ('gps', 'nfc')),
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index visits_place_idx on public.visits (place_id);
alter table public.visits enable row level security;
create policy "Visits are public" on public.visits for select to anon, authenticated using (true);
revoke insert, update, delete on public.visits from anon, authenticated;

create table public.place_reviews (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  unique (place_id, user_id)
);
alter table public.place_reviews enable row level security;
create policy "Reviews are public" on public.place_reviews for select to anon, authenticated using (true);
create policy "Visitors can review" on public.place_reviews for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.visits v where v.place_id = place_reviews.place_id and v.user_id = auth.uid()));
create policy "Users delete own reviews" on public.place_reviews for delete to authenticated using (user_id = auth.uid());
revoke update on public.place_reviews from anon, authenticated;

------------------------------------------------------------------------------
-- Feed: joined, visited a place, completed a collection, admin announcements
------------------------------------------------------------------------------
alter table public.feed_events drop constraint if exists feed_events_kind_check;
alter table public.feed_events
  add constraint feed_events_kind_check check (kind in ('joined', 'visited', 'completed', 'announcement')),
  add column place_id uuid references public.places(id) on delete cascade,
  add column collection_id text references public.collections(id) on delete cascade;

------------------------------------------------------------------------------
-- Check in: by GPS (place id + position) or by tapping the place's NFC tag
------------------------------------------------------------------------------
create or replace function public.check_in(p_place uuid default null, p_uid text default null, p_lat float8 default null, p_lng float8 default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pl public.places%rowtype;
  v_distance integer;
  v_done integer;
  v_total integer;
  v_bonus integer := 0;
begin
  if me is null then raise exception 'Sign in first'; end if;

  if p_uid is not null then
    select * into pl from public.places where nfc_uid = upper(p_uid) and is_active;
    if not found then return jsonb_build_object('status', 'unknown_tag'); end if;
  else
    select * into pl from public.places where id = p_place and is_active;
    if not found then raise exception 'Place not found'; end if;
    if p_lat is null or p_lng is null then return jsonb_build_object('status', 'location_required', 'place_id', pl.id); end if;
    v_distance := round(public.distance_m(p_lat, p_lng, pl.latitude, pl.longitude));
    if v_distance > public.cfg('checkin_radius_m') then
      return jsonb_build_object('status', 'too_far', 'place_id', pl.id, 'distance', v_distance);
    end if;
  end if;

  insert into public.visits (user_id, place_id, method)
  values (me, pl.id, case when p_uid is null then 'gps' else 'nfc' end)
  on conflict do nothing;
  if not found then return jsonb_build_object('status', 'already_visited', 'place_id', pl.id); end if;

  insert into public.point_transactions (user_id, amount, reason, ref_id) values (me, pl.points, 'visit', pl.id);
  insert into public.feed_events (actor_id, kind, place_id) values (me, 'visited', pl.id);

  select count(v.place_id), count(*) into v_done, v_total
  from public.places p left join public.visits v on v.place_id = p.id and v.user_id = me
  where p.collection_id = pl.collection_id and p.is_active;

  if v_done = v_total then
    v_bonus := public.cfg('collection_bonus');
    insert into public.point_transactions (user_id, amount, reason) values (me, v_bonus, 'collection_completed');
    insert into public.feed_events (actor_id, kind, collection_id) values (me, 'completed', pl.collection_id);
  end if;

  return jsonb_build_object('status', 'visited', 'place_id', pl.id, 'points', pl.points, 'bonus', v_bonus,
    'collection_done', v_done, 'collection_total', v_total);
end;
$$;

------------------------------------------------------------------------------
-- Leaderboard and profile stats now count visits
------------------------------------------------------------------------------
drop function if exists public.leaderboard(text, boolean);
create function public.leaderboard(p_period text default 'all', p_following boolean default false)
returns table (user_id uuid, display_name text, avatar_url text, points bigint, visits bigint)
language sql stable security definer set search_path = public
as $$
  select * from (
    select p.id, p.display_name, p.avatar_url,
      case when p_period = 'week'
        then (select coalesce(sum(amount), 0) from public.point_transactions pt
              where pt.user_id = p.id and pt.amount > 0 and pt.created_at > now() - interval '7 days')
        else p.lifetime_points::bigint end as points,
      (select count(*) from public.visits v where v.user_id = p.id) as visits
    from public.profiles p
    where not p_following or p.id = auth.uid()
      or p.id in (select followee_id from public.follows where follower_id = auth.uid())
  ) s
  order by points desc, visits desc, display_name
  limit 100
$$;

create or replace function public.profile_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'visits', (select count(*) from public.visits where user_id = p_user),
    'reviews', (select count(*) from public.place_reviews where user_id = p_user),
    'coupons', (select count(*) from public.coupon_redemptions where user_id = p_user),
    'followers', (select count(*) from public.follows where followee_id = p_user),
    'following', (select count(*) from public.follows where follower_id = p_user),
    'is_following', exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = p_user)
  )
$$;

revoke execute on function public.check_in(uuid, text, float8, float8), public.leaderboard(text, boolean), public.profile_stats(uuid)
  from public, anon;
grant execute on function public.check_in(uuid, text, float8, float8), public.leaderboard(text, boolean), public.profile_stats(uuid)
  to authenticated;

------------------------------------------------------------------------------
-- Starter content: Thessaloniki places (coordinates from OpenStreetMap)
------------------------------------------------------------------------------
insert into public.collections (id, name_en, name_el, color, sort) values
  ('waterfront', 'The Waterfront', 'Η Παραλία', '#2f7fb5', 1),
  ('byzantine', 'Byzantine Thessaloniki', 'Βυζαντινή Θεσσαλονίκη', '#a8452f', 2),
  ('roman', 'Roman Thessaloniki', 'Ρωμαϊκή Θεσσαλονίκη', '#b5832a', 3),
  ('upper_town', 'Ano Poli & the Walls', 'Άνω Πόλη & Τείχη', '#7a4fb3', 4),
  ('museums', 'Museums', 'Μουσεία', '#4a7c59', 5),
  ('markets', 'Markets & Old Town', 'Αγορές & Παλιά Πόλη', '#d4703a', 6);

insert into public.places (collection_id, name_en, name_el, description_en, description_el, latitude, longitude, points) values
  ('waterfront', 'White Tower', 'Λευκός Πύργος',
   'The symbol of the city: a 15th-century Ottoman tower on the seafront. Inside, a museum tells the story of Thessaloniki, and the top floor has views over the gulf.',
   'Το σύμβολο της πόλης: οθωμανικός πύργος του 15ου αιώνα στην παραλία. Μέσα στεγάζει έκθεση για την ιστορία της Θεσσαλονίκης και από την κορυφή η θέα στον κόλπο είναι μοναδική.',
   40.626327, 22.94838, 75),
  ('waterfront', 'Alexander the Great Statue', 'Άγαλμα Μεγάλου Αλεξάνδρου',
   'A large bronze equestrian statue of Alexander the Great on the new waterfront, a favourite meeting point and photo stop.',
   'Μεγάλο χάλκινο έφιππο άγαλμα του Μεγάλου Αλεξάνδρου στη Νέα Παραλία, αγαπημένο σημείο συνάντησης και φωτογραφίας.',
   40.624095, 22.949983, 50),
  ('waterfront', 'The Umbrellas', 'Ομπρέλες Ζογγολόπουλου',
   'George Zongolopoulos'' sculpture of floating umbrellas by the sea, one of the most photographed spots on the promenade, especially at sunset.',
   'Το γλυπτό του Γιώργου Ζογγολόπουλου με τις αιωρούμενες ομπρέλες δίπλα στη θάλασσα, από τα πιο φωτογραφημένα σημεία της παραλίας, ειδικά στο ηλιοβασίλεμα.',
   40.621865, 22.951449, 50),
  ('waterfront', 'Aristotelous Square', 'Πλατεία Αριστοτέλους',
   'The city''s grand central square, opening onto the sea. It was designed by Ernest Hébrard after the great fire of 1917.',
   'Η κεντρική πλατεία της πόλης, ανοιχτή προς τη θάλασσα. Σχεδιάστηκε από τον Ερνέστ Εμπράρ μετά τη μεγάλη πυρκαγιά του 1917.',
   40.632338, 22.940902, 50),
  ('byzantine', 'Hagia Sophia', 'Αγία Σοφία',
   'An 8th-century church famous for its dome mosaics, part of the UNESCO World Heritage listing of the city''s early Christian and Byzantine monuments.',
   'Ναός του 8ου αιώνα, γνωστός για τα ψηφιδωτά του τρούλου του, μέρος των παλαιοχριστιανικών και βυζαντινών μνημείων της πόλης που ανήκουν στην παγκόσμια κληρονομιά της UNESCO.',
   40.632814, 22.94698, 50),
  ('byzantine', 'Church of Saint Demetrius', 'Ναός Αγίου Δημητρίου',
   'The great basilica of the city''s patron saint. Don''t miss the crypt below, built over Roman baths.',
   'Η μεγάλη βασιλική του πολιούχου της πόλης. Μην παραλείψετε την κρύπτη, χτισμένη πάνω σε ρωμαϊκά λουτρά.',
   40.638756, 22.947857, 50),
  ('byzantine', 'Panagia Acheiropoietos', 'Παναγία Αχειροποίητος',
   'A 5th-century basilica, one of the oldest churches in the city still in use.',
   'Βασιλική του 5ου αιώνα, από τους αρχαιότερους ναούς της πόλης που λειτουργούν ακόμη.',
   40.634994, 22.947922, 50),
  ('byzantine', 'Panagia Chalkeon', 'Παναγία Χαλκέων',
   'An 11th-century red-brick church in the old coppersmiths'' quarter, right next to the Roman Forum.',
   'Πλινθόκτιστος ναός του 11ου αιώνα στη συνοικία των χαλκωματάδων, δίπλα στη Ρωμαϊκή Αγορά.',
   40.636806, 22.943689, 50),
  ('byzantine', 'Vlatadon Monastery', 'Μονή Βλατάδων',
   'A 14th-century monastery high in the upper town, with peacocks in the garden and one of the best views over the city.',
   'Μονή του 14ου αιώνα ψηλά στην Άνω Πόλη, με παγώνια στον κήπο και από τις ωραιότερες θέες της πόλης.',
   40.6419, 22.954635, 75),
  ('roman', 'Arch of Galerius (Kamara)', 'Αψίδα του Γαλερίου (Καμάρα)',
   'A triumphal arch from around 300 AD with detailed marble reliefs of Emperor Galerius'' victories. Locals just call it "Kamara".',
   'Θριαμβική αψίδα του 300 μ.Χ. περίπου με λεπτομερή μαρμάρινα ανάγλυφα των νικών του Γαλέριου. Οι ντόπιοι τη λένε απλώς «Καμάρα».',
   40.632199, 22.951804, 50),
  ('roman', 'Rotunda', 'Ροτόντα',
   'A massive round building from the 4th century AD, built by Galerius and later used as a church and a mosque. Its minaret still stands.',
   'Τεράστιο κυκλικό κτίριο του 4ου αιώνα μ.Χ., έργο του Γαλέριου, που αργότερα έγινε ναός και τζαμί. Ο μιναρές του σώζεται ακόμη.',
   40.633311, 22.952867, 50),
  ('roman', 'Roman Forum', 'Ρωμαϊκή Αγορά',
   'The administrative heart of Roman Thessaloniki, with a restored odeon and underground arcades.',
   'Το διοικητικό κέντρο της ρωμαϊκής Θεσσαλονίκης, με αναστηλωμένο ωδείο και υπόγειες στοές.',
   40.637705, 22.945866, 50),
  ('roman', 'Palace of Galerius', 'Ανάκτορο του Γαλερίου',
   'Excavated remains of the emperor''s palace complex at Navarinou Square, with mosaic floors visible from the walkways.',
   'Τα ερείπια του ανακτορικού συγκροτήματος του αυτοκράτορα στην πλατεία Ναυαρίνου, με ψηφιδωτά δάπεδα ορατά από τους διαδρόμους.',
   40.630225, 22.949233, 50),
  ('upper_town', 'Heptapyrgion (Yedi Kule)', 'Επταπύργιο (Γεντί Κουλέ)',
   'A Byzantine and Ottoman fortress at the top of the city that served as a prison until 1989.',
   'Βυζαντινό και οθωμανικό φρούριο στην κορυφή της πόλης, που λειτουργούσε ως φυλακή έως το 1989.',
   40.64423, 22.962019, 75),
  ('upper_town', 'Trigonion Tower', 'Πύργος του Τριγωνίου',
   'A round tower on the old city walls. Come for the sunset view over the whole city and the gulf.',
   'Κυκλικός πύργος στα τείχη της πόλης. Ελάτε για το ηλιοβασίλεμα με θέα σε όλη την πόλη και τον κόλπο.',
   40.641433, 22.959498, 75),
  ('upper_town', 'Hosios David', 'Όσιος Δαβίδ',
   'A small 5th-century church in Ano Poli hiding one of the city''s finest early Christian mosaics.',
   'Μικρός ναός του 5ου αιώνα στην Άνω Πόλη που κρύβει ένα από τα ωραιότερα παλαιοχριστιανικά ψηφιδωτά της πόλης.',
   40.641761, 22.952261, 50),
  ('museums', 'Archaeological Museum', 'Αρχαιολογικό Μουσείο',
   'Treasures of ancient Macedonia, from gold jewellery to the famous Derveni krater.',
   'Θησαυροί της αρχαίας Μακεδονίας, από χρυσά κοσμήματα μέχρι τον περίφημο κρατήρα του Δερβενίου.',
   40.625041, 22.95395, 75),
  ('museums', 'Museum of Byzantine Culture', 'Μουσείο Βυζαντινού Πολιτισμού',
   'Award-winning museum on Byzantine life, art and faith, right next to the Archaeological Museum.',
   'Βραβευμένο μουσείο για την καθημερινή ζωή, την τέχνη και την πίστη στο Βυζάντιο, δίπλα στο Αρχαιολογικό Μουσείο.',
   40.624078, 22.955007, 75),
  ('museums', 'Jewish Museum of Thessaloniki', 'Εβραϊκό Μουσείο Θεσσαλονίκης',
   'The story of the city''s Sephardic Jewish community, which shaped Thessaloniki for centuries.',
   'Η ιστορία της σεφαραδίτικης εβραϊκής κοινότητας της πόλης, που διαμόρφωσε τη Θεσσαλονίκη για αιώνες.',
   40.635258, 22.939668, 75),
  ('museums', 'Atatürk House', 'Οικία Κεμάλ Ατατούρκ',
   'The house where Mustafa Kemal Atatürk was born in 1881, now a small museum.',
   'Το σπίτι όπου γεννήθηκε ο Μουσταφά Κεμάλ Ατατούρκ το 1881, σήμερα μικρό μουσείο.',
   40.635754, 22.9543, 50),
  ('markets', 'Kapani Market', 'Αγορά Καπάνι',
   'The oldest market in the city: narrow lanes of spices, olives, fish and street food.',
   'Η παλαιότερη αγορά της πόλης: στενά δρομάκια με μπαχαρικά, ελιές, ψάρια και street food.',
   40.635929, 22.942635, 50),
  ('markets', 'Modiano Market', 'Αγορά Μοδιάνο',
   'A covered market from the 1920s, renovated into a lively hall of food stalls and cafés.',
   'Στεγασμένη αγορά της δεκαετίας του 1920, ανακαινισμένη σε ζωντανό χώρο με πάγκους φαγητού και καφέ.',
   40.634972, 22.941878, 50),
  ('markets', 'Ladadika', 'Λαδάδικα',
   'The old port warehouse district, now full of tavernas, ouzeri and nightlife.',
   'Η παλιά συνοικία των αποθηκών του λιμανιού, σήμερα γεμάτη ταβέρνες, ουζερί και νυχτερινή ζωή.',
   40.635097, 22.936938, 50),
  ('markets', 'Bey Hamam', 'Μπέη Χαμάμ',
   'The city''s oldest Ottoman bathhouse, from the 15th century, now used for exhibitions.',
   'Το παλαιότερο οθωμανικό λουτρό της πόλης, του 15ου αιώνα, που σήμερα φιλοξενεί εκθέσεις.',
   40.63574, 22.945195, 50);

------------------------------------------------------------------------------
-- Demo partners and coupons so the Rewards tab isn't empty.
-- These businesses are fictional: set is_active = false on them before launch.
------------------------------------------------------------------------------
with p as (
  insert into public.partners (name, description, address) values
    ('Thermaikos Café (demo)', 'Coffee and sea views on the promenade. Demo partner.', 'Nikis Avenue'),
    ('Bougatsa Corner (demo)', 'Fresh bougatsa every morning. Demo partner.', 'Near Aristotelous Square'),
    ('Ano Poli Taverna (demo)', 'Home cooking in the upper town. Demo partner.', 'Ano Poli'),
    ('Olive & Thyme Deli (demo)', 'Local olive oil, honey and spices to take home. Demo partner.', 'Kapani Market'),
    ('City Museums Friends (demo)', 'Free entry offers for partner museums. Demo partner.', 'Thessaloniki')
  returning id, name
)
insert into public.coupons (partner_id, title, description, terms, cost_points)
select p.id, c.title, c.description, c.terms, c.cost_points
from p join (values
  ('Thermaikos Café (demo)', 'Free freddo espresso', 'One free freddo espresso with any pastry.', 'One per visit. Show the live code to staff.', 120),
  ('Bougatsa Corner (demo)', '20% off bougatsa', '20% off any bougatsa and coffee combo.', 'Valid until 11:00. One per visit.', 100),
  ('Ano Poli Taverna (demo)', 'Free dessert', 'A free traditional dessert with any main course.', 'Dine-in only.', 200),
  ('Olive & Thyme Deli (demo)', '15% off local products', '15% off olive oil, honey and spices.', 'Minimum spend €10.', 150),
  ('City Museums Friends (demo)', 'Free museum entry', 'One free ticket to a partner museum.', 'Not valid on free-entry days.', 300)
) as c(partner, title, description, terms, cost_points) on c.partner = p.name;
