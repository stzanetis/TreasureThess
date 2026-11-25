-- TreasureThess v1: points ledger, ticket scanning, hidden treasure locations,
-- social features, partner coupons and account deletion.
-- All point changes go through point_transactions; clients can never write points directly.

------------------------------------------------------------------------------
-- Tunable numbers (edit these rows in the Supabase table editor)
------------------------------------------------------------------------------
create table if not exists public.app_config (
  key text primary key,
  value integer not null
);
alter table public.app_config enable row level security;
drop policy if exists "Config is public" on public.app_config;
create policy "Config is public" on public.app_config for select to anon, authenticated using (true);

insert into public.app_config (key, value) values
  ('signup_bonus', 150),
  ('ticket_scan', 50),
  ('ticket_daily_cap', 10),
  ('find_common', 100), ('find_rare', 200), ('find_epic', 350), ('find_legendary', 500),
  ('cost_common', 100), ('cost_rare', 250), ('cost_epic', 450), ('cost_legendary', 800),
  ('first_finder_bonus', 50),
  ('creator_royalty', 25),
  ('referral_bonus', 100),
  ('claim_radius_m', 100),
  ('area_radius_m', 60),
  ('reports_to_hide', 3)
on conflict (key) do nothing;

create or replace function public.cfg(k text) returns integer
language sql stable set search_path = public
as $$ select value from public.app_config where key = k $$;

create or replace function public.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable set search_path = public
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Random point within 60% of the search radius, so the real spot is always inside the circle.
create or replace function public.area_center(lat float8, lng float8, out a_lat float8, out a_lng float8)
language plpgsql volatile set search_path = public
as $$
declare
  d float8 := random() * 0.6 * public.cfg('area_radius_m');
  t float8 := random() * 2 * pi();
begin
  a_lat := lat + d * cos(t) / 111320;
  a_lng := lng + d * sin(t) / (111320 * cos(radians(lat)));
end;
$$;

------------------------------------------------------------------------------
-- Remove the old client-trusting points logic
------------------------------------------------------------------------------
drop trigger if exists user_treasures_sync_points on public.user_treasures;
drop function if exists public.sync_profile_points();
drop function if exists public.claim_treasure(text);
drop view if exists public.leaderboard;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

------------------------------------------------------------------------------
-- Profiles
------------------------------------------------------------------------------
alter table public.profiles
  add column if not exists bio text check (char_length(bio) <= 160),
  add column if not exists lifetime_points integer not null default 0,
  add column if not exists referral_code text unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  add column if not exists referred_by uuid references public.profiles(id) on delete set null;
update public.profiles set referral_code = upper(substr(md5(gen_random_uuid()::text), 1, 6)) where referral_code is null;
alter table public.profiles alter column referral_code set not null;

-- Users may edit only their public details, never points/role.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, bio) on public.profiles to authenticated;

------------------------------------------------------------------------------
-- Points ledger
------------------------------------------------------------------------------
create table if not exists public.point_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  reason text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists point_transactions_user_idx on public.point_transactions (user_id, created_at desc);
create index if not exists point_transactions_created_idx on public.point_transactions (created_at);
alter table public.point_transactions enable row level security;
drop policy if exists "Users see their own transactions" on public.point_transactions;
create policy "Users see their own transactions" on public.point_transactions
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.point_transactions from anon, authenticated;

create or replace function public.apply_point_transaction() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
  set points = points + new.amount,
      lifetime_points = lifetime_points + greatest(new.amount, 0),
      updated_at = now()
  where id = new.user_id;
  return new;
end;
$$;
drop trigger if exists point_transactions_apply on public.point_transactions;
create trigger point_transactions_apply after insert on public.point_transactions
  for each row execute function public.apply_point_transaction();

------------------------------------------------------------------------------
-- Treasures: exact location and tag id are private
------------------------------------------------------------------------------
alter table public.treasures
  add column if not exists area_lat float8,
  add column if not exists area_lng float8,
  add column if not exists find_count integer not null default 0;

update public.treasures t
set (area_lat, area_lng) = (select a.a_lat, a.a_lng from public.area_center(t.latitude, t.longitude) a)
where area_lat is null;
alter table public.treasures alter column area_lat set not null, alter column area_lng set not null;

-- Test treasures that were saved with the old hard-coded location (reversible).
update public.treasures set is_active = false where latitude = 40.6401 and longitude = 22.9444;

revoke select, insert, update, delete on public.treasures from anon, authenticated;
grant select (id, title, description, hint, image_url, rarity, area_lat, area_lng, is_active, created_at, creator_id, find_count)
  on public.treasures to anon, authenticated;
grant update (title, description, hint, image_url, is_active) on public.treasures to authenticated;

drop policy if exists "Public can read active treasures" on public.treasures;
drop policy if exists "Creators can create treasures" on public.treasures;
drop policy if exists "Creators can delete their treasures" on public.treasures;
create policy "Public can read active treasures" on public.treasures
  for select to anon, authenticated using (is_active or creator_id = auth.uid());

-- Finds are public (profiles and feed show them) but only scan_tag can create them.
alter table public.user_treasures drop constraint if exists user_treasures_user_id_fkey;
delete from public.user_treasures where user_id is null;
alter table public.user_treasures
  alter column user_id set not null,
  add constraint user_treasures_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
drop policy if exists "Users can see their own scanned treasures" on public.user_treasures;
drop policy if exists "Users can claim treasures" on public.user_treasures;
drop policy if exists "Finds are public" on public.user_treasures;
create policy "Finds are public" on public.user_treasures for select to anon, authenticated using (true);
revoke insert, update, delete on public.user_treasures from anon, authenticated;

------------------------------------------------------------------------------
-- Metro tickets: each ticket UID pays out once, ever
------------------------------------------------------------------------------
create table if not exists public.ticket_scans (
  uid text primary key,
  user_id uuid references public.profiles(id) on delete set null,
  points integer not null,
  scanned_at timestamptz not null default now()
);
create index if not exists ticket_scans_user_idx on public.ticket_scans (user_id, scanned_at desc);
alter table public.ticket_scans enable row level security;
revoke all on public.ticket_scans from anon, authenticated;

------------------------------------------------------------------------------
-- Social
------------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
alter table public.follows enable row level security;
drop policy if exists "Follows are public" on public.follows;
drop policy if exists "Users follow as themselves" on public.follows;
drop policy if exists "Users unfollow as themselves" on public.follows;
create policy "Follows are public" on public.follows for select to anon, authenticated using (true);
create policy "Users follow as themselves" on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "Users unfollow as themselves" on public.follows for delete to authenticated using (follower_id = auth.uid());

-- One review (comment + optional rating) per finder per treasure.
create table if not exists public.treasure_comments (
  id uuid primary key default gen_random_uuid(),
  treasure_id uuid not null references public.treasures(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  rating smallint check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  unique (treasure_id, user_id)
);
alter table public.treasure_comments enable row level security;
drop policy if exists "Comments are public" on public.treasure_comments;
drop policy if exists "Finders can comment" on public.treasure_comments;
drop policy if exists "Users delete own comments" on public.treasure_comments;
create policy "Comments are public" on public.treasure_comments for select to anon, authenticated using (true);
create policy "Finders can comment" on public.treasure_comments for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.user_treasures ut where ut.user_id = auth.uid() and ut.treasure_id = treasure_comments.treasure_id));
create policy "Users delete own comments" on public.treasure_comments for delete to authenticated using (user_id = auth.uid());

create table if not exists public.treasure_reports (
  treasure_id uuid not null references public.treasures(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('missing', 'inappropriate', 'unsafe')),
  created_at timestamptz not null default now(),
  primary key (treasure_id, user_id)
);
alter table public.treasure_reports enable row level security;
drop policy if exists "Users report as themselves" on public.treasure_reports;
create policy "Users report as themselves" on public.treasure_reports for insert to authenticated with check (user_id = auth.uid());

create or replace function public.hide_reported_treasure() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.treasure_reports where treasure_id = new.treasure_id) >= public.cfg('reports_to_hide') then
    update public.treasures set is_active = false where id = new.treasure_id;
  end if;
  return new;
end;
$$;
drop trigger if exists treasure_reports_hide on public.treasure_reports;
create trigger treasure_reports_hide after insert on public.treasure_reports
  for each row execute function public.hide_reported_treasure();

-- Activity feed. Announcements are added by the admin in the Supabase table editor
-- (kind = 'announcement', title, body, actor_id left empty).
create table if not exists public.feed_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('joined', 'found', 'created', 'announcement')),
  treasure_id uuid references public.treasures(id) on delete cascade,
  title text,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists feed_events_created_idx on public.feed_events (created_at desc);
alter table public.feed_events enable row level security;
drop policy if exists "Feed is public" on public.feed_events;
create policy "Feed is public" on public.feed_events for select to anon, authenticated using (true);
revoke insert, update, delete on public.feed_events from anon, authenticated;

------------------------------------------------------------------------------
-- Partners and coupons (managed by the admin in the Supabase table editor)
------------------------------------------------------------------------------
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  logo_url text,
  website text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  title text not null,
  description text,
  terms text,
  cost_points integer not null check (cost_points > 0),
  stock integer check (stock >= 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  valid_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);
alter table public.partners enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
drop policy if exists "Active partners are public" on public.partners;
drop policy if exists "Active coupons are public" on public.coupons;
drop policy if exists "Users see their own redemptions" on public.coupon_redemptions;
create policy "Active partners are public" on public.partners for select to anon, authenticated using (is_active);
create policy "Active coupons are public" on public.coupons for select to anon, authenticated using (is_active);
create policy "Users see their own redemptions" on public.coupon_redemptions for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.partners, public.coupons, public.coupon_redemptions from anon, authenticated;

-- Filled by the partner form on treasurethess.app; read them in the table editor.
create table if not exists public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (char_length(business_name) between 2 and 120),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  category text check (char_length(category) <= 60),
  message text check (char_length(message) <= 2000),
  status text not null default 'new',
  created_at timestamptz not null default now()
);
alter table public.partner_applications enable row level security;
drop policy if exists "Anyone can apply" on public.partner_applications;
create policy "Anyone can apply" on public.partner_applications for insert to anon, authenticated with check (status = 'new');
revoke select, update, delete on public.partner_applications from anon, authenticated;

------------------------------------------------------------------------------
-- Sign-up: profile, welcome bonus, feed entry
------------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), 'Treasure Hunter'), 30))
  on conflict (id) do nothing;
  insert into public.point_transactions (user_id, amount, reason) values (new.id, public.cfg('signup_bonus'), 'signup_bonus');
  insert into public.feed_events (actor_id, kind) values (new.id, 'joined');
  return new;
end;
$$;

------------------------------------------------------------------------------
-- Rebuild balances from the ledger (existing finds + welcome bonus for existing users)
------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.point_transactions) then
    update public.profiles set points = 0, lifetime_points = 0;
    insert into public.point_transactions (user_id, amount, reason, ref_id, created_at)
      select user_id, points_awarded, 'treasure_found', treasure_id, scanned_at from public.user_treasures;
    insert into public.point_transactions (user_id, amount, reason)
      select id, public.cfg('signup_bonus'), 'signup_bonus' from public.profiles;
    update public.treasures t set find_count = (select count(*) from public.user_treasures ut where ut.treasure_id = t.id);
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Game RPCs
------------------------------------------------------------------------------
create or replace function public.normalize_uid(raw text) returns text
language sql immutable set search_path = public
as $$ select upper(regexp_replace(coalesce(raw, ''), '[^0-9A-Fa-f]', '', 'g')) $$;

-- One entry point for every NFC scan: claims a treasure or pays out a new ticket.
create or replace function public.scan_tag(p_uid text, p_lat float8 default null, p_lng float8 default null, p_ndef_id text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_uid text := public.normalize_uid(p_uid);
  t public.treasures%rowtype;
  v_dist float8;
  v_points integer;
  v_bonus integer := 0;
  v_owner uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if length(v_uid) < 8 then raise exception 'Could not read this tag, try again'; end if;

  select * into t from public.treasures
  where is_active and (nfc_uid = v_uid or (p_ndef_id is not null and nfc_uid = p_ndef_id))
  limit 1;

  if found then
    if t.creator_id = me then
      return jsonb_build_object('status', 'own_treasure', 'treasure_id', t.id, 'title', t.title);
    end if;
    if exists (select 1 from public.user_treasures where user_id = me and treasure_id = t.id) then
      return jsonb_build_object('status', 'already_found', 'treasure_id', t.id, 'title', t.title);
    end if;
    if p_lat is null or p_lng is null then
      return jsonb_build_object('status', 'location_required');
    end if;
    v_dist := public.distance_m(p_lat, p_lng, t.latitude, t.longitude);
    if v_dist > public.cfg('claim_radius_m') then
      return jsonb_build_object('status', 'too_far', 'treasure_id', t.id, 'title', t.title, 'distance', round(v_dist));
    end if;

    v_points := public.cfg('find_' || t.rarity::text);
    if t.find_count = 0 then v_bonus := public.cfg('first_finder_bonus'); end if;

    insert into public.user_treasures (user_id, treasure_id, points_awarded) values (me, t.id, v_points + v_bonus);
    update public.treasures set find_count = find_count + 1 where id = t.id;
    insert into public.point_transactions (user_id, amount, reason, ref_id) values (me, v_points, 'treasure_found', t.id);
    if v_bonus > 0 then
      insert into public.point_transactions (user_id, amount, reason, ref_id) values (me, v_bonus, 'first_finder', t.id);
    end if;
    if t.creator_id is not null then
      insert into public.point_transactions (user_id, amount, reason, ref_id) values (t.creator_id, public.cfg('creator_royalty'), 'creator_royalty', t.id);
    end if;
    insert into public.feed_events (actor_id, kind, treasure_id) values (me, 'found', t.id);

    return jsonb_build_object('status', 'treasure_found', 'treasure_id', t.id, 'title', t.title,
      'description', t.description, 'image_url', t.image_url, 'rarity', t.rarity,
      'points', v_points + v_bonus, 'first_finder', v_bonus > 0);
  end if;

  select user_id into v_owner from public.ticket_scans where uid = v_uid;
  if found then
    return jsonb_build_object('status', 'ticket_used', 'uid', v_uid, 'by_you', v_owner = me);
  end if;
  if (select count(*) from public.ticket_scans where user_id = me and scanned_at > now() - interval '1 day') >= public.cfg('ticket_daily_cap') then
    return jsonb_build_object('status', 'daily_cap', 'uid', v_uid);
  end if;

  v_points := public.cfg('ticket_scan');
  insert into public.ticket_scans (uid, user_id, points) values (v_uid, me, v_points);
  insert into public.point_transactions (user_id, amount, reason) values (me, v_points, 'ticket_scan');
  return jsonb_build_object('status', 'ticket_scanned', 'uid', v_uid, 'points', v_points);
end;
$$;

create or replace function public.create_treasure(
  p_uid text, p_title text, p_description text, p_hint text, p_image_url text,
  p_rarity public.treasure_rarity, p_lat float8, p_lng float8
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_uid text := public.normalize_uid(p_uid);
  v_cost integer := public.cfg('cost_' || p_rarity::text);
  v_id uuid;
  a record;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if length(v_uid) < 8 then raise exception 'Scan the ticket you are hiding first'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 60 then raise exception 'Title must be 3 to 60 characters'; end if;
  if char_length(coalesce(p_description, '')) > 500 or char_length(coalesce(p_hint, '')) > 200 then raise exception 'Description or hint is too long'; end if;
  if p_lat is null or p_lng is null then raise exception 'Location is required'; end if;
  if exists (select 1 from public.treasures where nfc_uid = v_uid) then raise exception 'This ticket is already a treasure'; end if;
  if (select points from public.profiles where id = me) < v_cost then
    raise exception 'You need % points for a % treasure', v_cost, p_rarity;
  end if;

  select * into a from public.area_center(p_lat, p_lng);
  insert into public.treasures (title, description, hint, image_url, rarity, latitude, longitude, area_lat, area_lng, nfc_uid, creator_id)
  values (trim(p_title), nullif(trim(p_description), ''), nullif(trim(p_hint), ''), p_image_url, p_rarity, p_lat, p_lng, a.a_lat, a.a_lng, v_uid, me)
  returning id into v_id;

  insert into public.point_transactions (user_id, amount, reason, ref_id) values (me, -v_cost, 'treasure_created', v_id);
  insert into public.feed_events (actor_id, kind, treasure_id) values (me, 'created', v_id);
  return v_id;
end;
$$;

-- Hot/cold hint without revealing the exact distance.
create or replace function public.treasure_proximity(p_treasure uuid, p_lat float8, p_lng float8) returns text
language sql stable security definer set search_path = public
as $$
  select case
    when d < 15 then 'here'
    when d < 40 then 'hot'
    when d < 100 then 'warm'
    when d < 300 then 'cool'
    else 'cold' end
  from (select public.distance_m(p_lat, p_lng, latitude, longitude) d from public.treasures where id = p_treasure and is_active) x
$$;

create or replace function public.leaderboard(p_period text default 'all', p_following boolean default false)
returns table (user_id uuid, display_name text, avatar_url text, points bigint, finds bigint)
language sql stable security definer set search_path = public
as $$
  select * from (
    select p.id, p.display_name, p.avatar_url,
      case when p_period = 'week'
        then (select coalesce(sum(amount), 0) from public.point_transactions pt
              where pt.user_id = p.id and pt.amount > 0 and pt.created_at > now() - interval '7 days')
        else p.lifetime_points::bigint end as points,
      (select count(*) from public.user_treasures ut where ut.user_id = p.id) as finds
    from public.profiles p
    where not p_following or p.id = auth.uid()
      or p.id in (select followee_id from public.follows where follower_id = auth.uid())
  ) s
  order by points desc, finds desc, display_name
  limit 100
$$;

create or replace function public.profile_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'finds', (select count(*) from public.user_treasures where user_id = p_user),
    'hidden', (select count(*) from public.treasures where creator_id = p_user),
    'tickets', (select count(*) from public.ticket_scans where user_id = p_user),
    'followers', (select count(*) from public.follows where followee_id = p_user),
    'following', (select count(*) from public.follows where follower_id = p_user),
    'rare_finds', (select count(*) from public.user_treasures ut join public.treasures t on t.id = ut.treasure_id
                   where ut.user_id = p_user and t.rarity <> 'common'),
    'first_finds', (select count(*) from public.point_transactions where user_id = p_user and reason = 'first_finder'),
    'is_following', exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = p_user)
  )
$$;

create or replace function public.redeem_referral(p_code text) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_inviter uuid;
  v_bonus integer := public.cfg('referral_bonus');
begin
  if me is null then raise exception 'Sign in first'; end if;
  if (select referred_by from public.profiles where id = me) is not null then raise exception 'You already used an invite code'; end if;
  select id into v_inviter from public.profiles where referral_code = upper(trim(p_code));
  if v_inviter is null then raise exception 'Invite code not found'; end if;
  if v_inviter = me then raise exception 'You cannot use your own code'; end if;

  update public.profiles set referred_by = v_inviter where id = me;
  insert into public.point_transactions (user_id, amount, reason, ref_id) values (me, v_bonus, 'referral', v_inviter);
  insert into public.point_transactions (user_id, amount, reason, ref_id) values (v_inviter, v_bonus, 'referral', me);
  return v_bonus;
end;
$$;

create or replace function public.redeem_coupon(p_coupon uuid) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.coupons%rowtype;
  v_id uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into c from public.coupons where id = p_coupon and is_active for update;
  if not found or (c.valid_until is not null and c.valid_until < now()) then raise exception 'This coupon is no longer available'; end if;
  if c.stock is not null and (select count(*) from public.coupon_redemptions where coupon_id = c.id) >= c.stock then
    raise exception 'This coupon is sold out';
  end if;
  if (select count(*) from public.coupon_redemptions where coupon_id = c.id and user_id = me) >= c.per_user_limit then
    raise exception 'You already redeemed this coupon';
  end if;
  if (select points from public.profiles where id = me) < c.cost_points then
    raise exception 'You need % points for this coupon', c.cost_points;
  end if;

  insert into public.coupon_redemptions (coupon_id, user_id, code)
  values (c.id, me, upper(substr(md5(gen_random_uuid()::text), 1, 8)))
  returning id into v_id;
  insert into public.point_transactions (user_id, amount, reason, ref_id) values (me, -c.cost_points, 'coupon_redeemed', v_id);
  return v_id;
end;
$$;

-- Starts the 10-minute window shown to shop staff.
create or replace function public.activate_coupon(p_redemption uuid) returns timestamptz
language sql security definer set search_path = public
as $$
  update public.coupon_redemptions
  set activated_at = coalesce(activated_at, now())
  where id = p_redemption and user_id = auth.uid()
  returning activated_at
$$;

create or replace function public.delete_my_account() returns void
language sql security definer set search_path = public, auth
as $$ delete from auth.users where id = auth.uid() $$;

------------------------------------------------------------------------------
-- Function permissions: only the RPCs the app calls are exposed
------------------------------------------------------------------------------
revoke execute on function
  public.cfg(text), public.distance_m(float8, float8, float8, float8), public.area_center(float8, float8),
  public.normalize_uid(text), public.apply_point_transaction(), public.hide_reported_treasure(),
  public.handle_new_user(), public.set_updated_at(),
  public.scan_tag(text, float8, float8, text),
  public.create_treasure(text, text, text, text, text, public.treasure_rarity, float8, float8),
  public.treasure_proximity(uuid, float8, float8), public.leaderboard(text, boolean), public.profile_stats(uuid),
  public.redeem_referral(text), public.redeem_coupon(uuid), public.activate_coupon(uuid), public.delete_my_account()
from public, anon, authenticated;

grant execute on function
  public.scan_tag(text, float8, float8, text),
  public.create_treasure(text, text, text, text, text, public.treasure_rarity, float8, float8),
  public.treasure_proximity(uuid, float8, float8), public.leaderboard(text, boolean), public.profile_stats(uuid),
  public.redeem_referral(text), public.redeem_coupon(uuid), public.activate_coupon(uuid), public.delete_my_account()
to authenticated;

------------------------------------------------------------------------------
-- Storage: images only, max 5 MB, no public listing
------------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'treasure-images';
drop policy if exists "Anyone can read treasure images" on storage.objects;
