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

create table if not exists public.cheer_comments (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournament_states(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 40),
  created_at timestamptz not null default now()
);

create index if not exists cheer_comments_tournament_created_idx
  on public.cheer_comments (tournament_id, created_at desc);

alter table public.cheer_comments enable row level security;

drop policy if exists "cheer comments are readable" on public.cheer_comments;
create policy "cheer comments are readable"
on public.cheer_comments
for select
to anon
using (true);

-- Writes go through the send-cheer-comment Edge Function (service role only).
revoke insert, update, delete on public.cheer_comments from anon, authenticated;

-- Spectator danmaku overlays subscribe to INSERT events via Supabase Realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'cheer_comments'
    ) then
    alter publication supabase_realtime add table public.cheer_comments;
  end if;
end $$;
