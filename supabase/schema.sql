create table if not exists public.tournament_states (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tournament_states enable row level security;

drop policy if exists "tournament states are readable" on public.tournament_states;
create policy "tournament states are readable"
on public.tournament_states
for select
to anon
using (true);

drop policy if exists "tournament states can be updated by anon demo clients" on public.tournament_states;
drop policy if exists "tournament states can be updated by anon clients" on public.tournament_states;

-- Production writes are handled by the save-tournament-state Edge Function
-- with the service role key. Anonymous browser clients must stay read-only.

insert into public.tournament_states (id, payload)
values (
  'ukenson-2026-renseihai',
  '{"players":[],"results":{},"entriesMeta":{"importedCount":0,"waitlistCount":0,"source":"empty","importedAt":null},"tableCount":8,"tableAssignments":{},"selectedMatchId":null,"mode":"operator","timer":null,"lastFxEvent":null}'
)
on conflict (id) do nothing;

create table if not exists public.player_goods (
  tournament_id text not null references public.tournament_states(id) on delete cascade,
  player_id text not null,
  good_count bigint not null default 0 check (good_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

alter table public.player_goods enable row level security;

drop policy if exists "player goods are readable" on public.player_goods;
revoke select, insert, update, delete on public.player_goods from anon, authenticated;

create or replace function public.increment_player_good(
  p_tournament_id text,
  p_player_id text,
  p_amount integer
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count bigint;
begin
  if p_tournament_id is null or p_player_id is null or p_amount < 1 or p_amount > 25 then
    raise exception 'invalid good increment';
  end if;

  -- Serialize increments with a tournament reset: taps already in flight are
  -- cleared by the reset, while taps after the reset become the new total.
  perform 1
  from public.tournament_states
  where id = p_tournament_id
  for share;
  if not found then
    raise exception 'unknown tournament';
  end if;

  insert into public.player_goods (tournament_id, player_id, good_count, updated_at)
  values (p_tournament_id, p_player_id, p_amount, now())
  on conflict (tournament_id, player_id)
  do update set
    good_count = public.player_goods.good_count + excluded.good_count,
    updated_at = now()
  returning good_count into next_count;

  return next_count;
end;
$$;

revoke all on function public.increment_player_good(text, text, integer) from public, anon, authenticated;
grant execute on function public.increment_player_good(text, text, integer) to service_role;

create or replace function public.save_tournament_state_and_reset_goods(
  p_tournament_id text,
  p_payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns table(updated_at timestamptz, conflict boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_updated_at timestamptz;
  next_updated_at timestamptz := now();
begin
  if p_tournament_id is null or p_tournament_id = '' or p_payload is null then
    raise exception 'invalid tournament reset';
  end if;

  select tournament_states.updated_at
  into current_updated_at
  from public.tournament_states
  where tournament_states.id = p_tournament_id
  for update;

  if p_expected_updated_at is not null and current_updated_at is not null and current_updated_at <> p_expected_updated_at then
    return query select current_updated_at, true;
    return;
  end if;

  insert into public.tournament_states (id, payload, updated_at)
  values (p_tournament_id, p_payload, next_updated_at)
  on conflict (id) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at;

  delete from public.player_goods where tournament_id = p_tournament_id;

  return query select next_updated_at, false;
end;
$$;

revoke all on function public.save_tournament_state_and_reset_goods(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_tournament_state_and_reset_goods(text, jsonb, timestamptz) to service_role;
