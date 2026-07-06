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
create policy "tournament states can be updated by anon demo clients"
on public.tournament_states
for all
to anon
using (true)
with check (true);

insert into public.tournament_states (id, payload)
values ('ukenson-2026-renseihai', '{"players":[],"results":{},"selectedMatchId":"w1","mode":"operator"}')
on conflict (id) do nothing;
