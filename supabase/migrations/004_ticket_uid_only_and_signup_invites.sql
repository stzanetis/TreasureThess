-- Treasures are identified only by the ticket chip UID (no written NDEF tags),
-- and an invite code can be entered at sign-up (stored in user metadata).

-- Old test treasures used written text identifiers that the new scanner never reads (reversible).
update public.treasures set is_active = false where nfc_uid !~ '^[0-9A-F]{8,}$';

drop function if exists public.scan_tag(text, float8, float8, text);

create or replace function public.scan_tag(p_uid text, p_lat float8 default null, p_lng float8 default null)
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

  select * into t from public.treasures where is_active and nfc_uid = v_uid;

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

revoke execute on function public.scan_tag(text, float8, float8) from public, anon;
grant execute on function public.scan_tag(text, float8, float8) to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_inviter uuid;
  v_bonus integer := public.cfg('referral_bonus');
begin
  select id into v_inviter from public.profiles
  where referral_code = upper(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));

  insert into public.profiles (id, display_name, referred_by)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), 'Treasure Hunter'), 30), v_inviter)
  on conflict (id) do nothing;
  insert into public.point_transactions (user_id, amount, reason) values (new.id, public.cfg('signup_bonus'), 'signup_bonus');
  if v_inviter is not null then
    insert into public.point_transactions (user_id, amount, reason, ref_id) values (new.id, v_bonus, 'referral', v_inviter);
    insert into public.point_transactions (user_id, amount, reason, ref_id) values (v_inviter, v_bonus, 'referral', new.id);
  end if;
  insert into public.feed_events (actor_id, kind) values (new.id, 'joined');
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Invite codes are only entered at sign-up now.
drop function if exists public.redeem_referral(text);
