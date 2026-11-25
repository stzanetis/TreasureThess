-- TreasureThess feature migration
-- Run after supabase/schema.sql in the Supabase SQL editor.

reset role;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Treasure Hunter',
  avatar_url text,
  role text not null default 'player' check (role in ('player', 'creator', 'admin')),
  points integer not null default 0 check (points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.treasures
  add column if not exists creator_id uuid references public.profiles(id) on delete set null;

alter table public.user_treasures
  add column if not exists points_awarded integer not null default 100 check (points_awarded >= 0);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'Treasure Hunter')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data ->> 'display_name', split_part(email, '@', 1), 'Treasure Hunter')
from auth.users
on conflict (id) do nothing;

create or replace function public.sync_profile_points()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.profiles
    set points = (select coalesce(sum(points_awarded), 0) from public.user_treasures where user_id = old.user_id), updated_at = now()
    where id = old.user_id;
    return old;
  end if;

  update public.profiles
  set points = (select coalesce(sum(points_awarded), 0) from public.user_treasures where user_id = new.user_id), updated_at = now()
  where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists user_treasures_sync_points on public.user_treasures;
create trigger user_treasures_sync_points
after insert or update or delete on public.user_treasures
for each row execute function public.sync_profile_points();

create or replace function public.claim_treasure(identifier text)
returns table (treasure_id uuid, treasure_title text, points integer)
language plpgsql
security definer set search_path = public
as $$
declare
  current_treasure public.treasures%rowtype;
  awarded_points integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into current_treasure
  from public.treasures
  where nfc_uid = identifier and is_active = true;

  if current_treasure.id is null then
    raise exception 'Unknown treasure';
  end if;

  if exists (
    select 1
    from public.user_treasures as found_treasure
    where found_treasure.user_id = auth.uid()
      and found_treasure.treasure_id = current_treasure.id
  ) then
    raise exception 'Already found';
  end if;

  awarded_points := case current_treasure.rarity
    when 'common' then 100
    when 'rare' then 200
    when 'epic' then 350
    when 'legendary' then 500
  end;

  insert into public.user_treasures (user_id, treasure_id, points_awarded)
  values (auth.uid(), current_treasure.id, awarded_points)
  on conflict (user_id, treasure_id) do nothing;

  return query
  select current_treasure.id, current_treasure.title, awarded_points;
end;
$$;

grant execute on function public.claim_treasure(text) to authenticated;

alter table public.profiles enable row level security;
drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
on public.profiles for select to anon, authenticated using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- Replace the original broad treasure policy with creator-scoped writes.
drop policy if exists "Authenticated users can manage treasures" on public.treasures;
drop policy if exists "Creators can create treasures" on public.treasures;
create policy "Creators can create treasures"
on public.treasures for insert to authenticated
with check (creator_id = auth.uid());

drop policy if exists "Creators can update their treasures" on public.treasures;
create policy "Creators can update their treasures"
on public.treasures for update to authenticated
using (creator_id = auth.uid()) with check (creator_id = auth.uid());

drop policy if exists "Creators can delete their treasures" on public.treasures;
create policy "Creators can delete their treasures"
on public.treasures for delete to authenticated
using (creator_id = auth.uid());

-- Allow authenticated users to upload images under their own user-id folder.
insert into storage.buckets (id, name, public)
values ('treasure-images', 'treasure-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Users can upload treasure images" on storage.objects;
create policy "Users can upload treasure images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'treasure-images'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "Anyone can read treasure images" on storage.objects;
create policy "Anyone can read treasure images"
on storage.objects for select to anon, authenticated
using (bucket_id = 'treasure-images');

drop policy if exists "Users can update treasure images" on storage.objects;
create policy "Users can update treasure images"
on storage.objects for update to authenticated
using (
  bucket_id = 'treasure-images'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "Users can delete treasure images" on storage.objects;
create policy "Users can delete treasure images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'treasure-images'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- Richer starter content. Replace these URLs with uploaded storage URLs when desired.
update public.treasures set
  description = 'A sea-facing cache beside Thessaloniki''s landmark tower. Find the marker where the waterfront opens toward the Thermaic Gulf.',
  hint = 'Follow the promenade toward the city''s most famous white tower.',
  image_url = 'https://images.unsplash.com/photo-1603565816030-6b389eeb23cb?auto=format&fit=crop&w=900&q=80'
where nfc_uid = 'nfc-white-tower-001';

update public.treasures set
  description = 'A lantern-lit clue tucked among Ladadika''s old stone lanes, where the evening streets carry the city''s loudest stories.',
  hint = 'Look for the warmest light on a lane just beyond the busy restaurants.',
  image_url = 'https://images.unsplash.com/photo-1518005020951-e8f2?auto=format&fit=crop&w=900&q=80'
where nfc_uid = 'nfc-ladadika-002';

update public.treasures set
  description = 'An ancient relic near the Rotunda, hidden in the pause between the monument''s massive walls and the surrounding streets.',
  hint = 'Circle the monument until the footsteps around you begin to slow.',
  image_url = 'https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=900&q=80'
where nfc_uid = 'nfc-rotunda-003';

-- Leaderboard query used by the app.
create or replace view public.leaderboard as
select id, display_name, avatar_url, points,
       (select count(*) from public.user_treasures ut where ut.user_id = p.id) as treasures_found
from public.profiles p
order by points desc, treasures_found desc, display_name asc;

grant select on public.leaderboard to anon, authenticated;
