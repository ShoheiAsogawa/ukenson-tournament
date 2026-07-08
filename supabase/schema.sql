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
  '{"players":[],"results":{},"entriesMeta":{"importedCount":0,"waitlistCount":0,"source":"empty","importedAt":null},"selectedMatchId":null,"mode":"operator","timer":null,"lastFxEvent":null}'
)
on conflict (id) do nothing;
