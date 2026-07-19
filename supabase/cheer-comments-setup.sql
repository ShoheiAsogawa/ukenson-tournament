-- 応援コメント（弾幕）用セットアップ
-- Supabase Dashboard > SQL Editor でこのファイルを実行してください。
-- 実行後: supabase functions deploy send-cheer-comment

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

revoke insert, update, delete on public.cheer_comments from anon, authenticated;

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
