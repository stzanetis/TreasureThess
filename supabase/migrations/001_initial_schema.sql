create extension if not exists "pgcrypto";

do $$
begin
  create type public.treasure_rarity as enum ('common', 'rare', 'epic', 'legendary');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.treasures (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  hint text,
  image_url text,
  rarity public.treasure_rarity not null default 'common',
  latitude double precision not null,
  longitude double precision not null,
  nfc_uid text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists treasures_set_updated_at on public.treasures;

create trigger treasures_set_updated_at
before update on public.treasures
for each row
execute function public.set_updated_at();

alter table public.treasures enable row level security;

drop policy if exists "Public can read active treasures" on public.treasures;
create policy "Public can read active treasures"
on public.treasures
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Authenticated users can manage treasures" on public.treasures;
create policy "Authenticated users can manage treasures"
on public.treasures
for all
to authenticated
using (true)
with check (true);

insert into public.treasures (title, description, hint, image_url, rarity, latitude, longitude, nfc_uid, is_active)
values
  ('White Tower Cache', 'A hidden treasure near the waterfront.', 'Look close to the city''s most famous monument.', 'https://placehold.co/400x300/0f766e/ffffff?text=White+Tower', 'rare', 40.6264, 22.9484, 'nfc-white-tower-001', true),
  ('Ladadika Lantern', 'A clue hidden in the old nightlife district.', 'Find the lane with the warmest lights after sunset.', 'https://placehold.co/400x300/d4a72c/07111f?text=Ladadika', 'common', 40.6331, 22.9373, 'nfc-ladadika-002', true),
  ('Rotunda Relic', 'An ancient stop on the treasure trail.', 'Circle the monument and scan where the footsteps slow.', 'https://placehold.co/400x300/07111f/f5efe3?text=Rotunda', 'epic', 40.6329, 22.9510, 'nfc-rotunda-003', true)
on conflict (nfc_uid) do nothing;

create table if not exists public.user_treasures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  treasure_id uuid references public.treasures(id) on delete cascade not null,
  scanned_at timestamptz not null default now(),
  unique(user_id, treasure_id)
);

alter table public.user_treasures enable row level security;

drop policy if exists "Users can see their own scanned treasures" on public.user_treasures;
create policy "Users can see their own scanned treasures"
on public.user_treasures
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can claim treasures" on public.user_treasures;
create policy "Users can claim treasures"
on public.user_treasures
for insert
to authenticated
with check (user_id = auth.uid());