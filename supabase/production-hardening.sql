-- Production hardening for live tournament sync.
-- Run in Supabase SQL Editor (or: supabase db query --linked -f supabase/production-hardening.sql)

-- 1) Publish tournament_states so operator / spectator / table / overlay stay in sync.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tournament_states'
    ) then
    alter publication supabase_realtime add table public.tournament_states;
  end if;
end $$;

-- 2) Keep cheer_comments published (idempotent with cheer-comments-setup.sql).
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
