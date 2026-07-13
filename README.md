# 連青杯 Eスポーツチャンピオンシップ Tournament System

React + Vite + Supabase で動く、スマブラ個人戦向けの Wエリミネーション大会システムです。

## Features

- 最大128人個人戦の Wエリミネーション表
- 勝者側、敗者側、グランドファイナル、リセットファイナル対応
- 運営モードで勝者・スコア・選手名を記録
- Googleフォーム回答スプレッドシートのCSV/TSV取込
- 参加者の対戦枠シャッフル
- 観客ビューで次の試合と進行状況を大きく表示
- 観客・選手のスマホから応援コメントを送信し、観客ビューに弾幕として流す（NGワード・レート制限・運営の停止スイッチ付き）
- Supabase Realtime 対応
- Supabase 未設定時は `localStorage` でローカルデモ動作
- Vercel デプロイ対応

## Local Development

```bash
npm install
npm run dev
```

## Google Form Entry Import

Googleフォームの回答先スプレッドシートから、当日の参加者を一括登録できます。

1. Googleフォームの回答スプレッドシートを開きます。
2. `ファイル > ダウンロード > カンマ区切り形式(.csv)` でCSVを保存します。
3. アプリの `運営モード > 申込シート取込 > CSVを選択` からCSVを選びます。
4. 先着128名が本戦枠に入り、129人目以降は待機人数として表示されます。
5. `対戦をシャッフル` を押すと、本戦枠の当たりをランダムに組み直します。

CSVを保存しない場合は、スプレッドシートの回答範囲をコピーして貼り付け、`貼り付け取込` でも反映できます。

名前列は `プレイヤーネーム`、`選手名`、`名前`、`氏名`、`ハンドルネーム`、`ニックネーム` などから自動検出します。

## Supabase Setup

1. Supabase で新規プロジェクトを作成します。
2. `supabase/schema.sql` を SQL Editor で実行します。
3. `.env.example` を `.env.local` にコピーし、URL と anon key を入れます。
4. `npm run dev` を再起動します。

> 現在の SQL は anon 読み取りのみを許可します。運営画面からの保存は Supabase Edge Function 経由で行います。

## Vercel

Vercel の Project Settings > Environment Variables に以下を設定します。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_TOURNAMENT_ID`

Build command は `npm run build`、Output directory は `dist` です。

## Production operation notes

For real events, do not allow anonymous browser clients to write directly to
`public.tournament_states`.

1. Run `supabase/schema.sql` in Supabase SQL Editor.
2. Deploy the Edge Functions:

```bash
supabase functions deploy verify-admin-pin
supabase functions deploy save-tournament-state
```

3. Set the Edge Function secret:

```bash
supabase secrets set ADMIN_PIN=your-production-pin
```

4. In Vercel, set only public client values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_TOURNAMENT_ID`

Do not set `VITE_ADMIN_PIN` in production. If `VITE_ADMIN_PIN` is omitted,
the admin login PIN is verified by the Supabase Edge Function instead of being
embedded into the browser bundle. After login, the client stores a short-lived
session token (not the raw PIN) and uses it for subsequent saves.

`VITE_SUPABASE_DIRECT_WRITE=true` is only for local/demo fallback. Leave it
unset in production.

Redeploy Edge Functions after pulling auth changes:

```bash
supabase functions deploy verify-admin-pin
supabase functions deploy save-tournament-state
supabase functions deploy record-table-result
supabase functions deploy add-player-good
supabase functions deploy get-player-good-ranking
supabase functions deploy send-cheer-comment
```

Table QR pages (`?view=table&table=N`) can record the active match on that table
without an admin PIN. They call `record-table-result`, which only accepts the
current match assigned to that table.

The ranking good system uses `public.player_goods`, `add-player-good`, and
`get-player-good-ranking`. Re-run `supabase/schema.sql` before deploying the
functions so the private table and atomic increment function are available.

## Cheer comments (danmaku)

The spectator page (`?view=spectator`) shows a floating message icon at the
bottom right; the player page (`?view=player`) shows it at the top right of
the bracket tab. Comments are sent through the `send-cheer-comment` Edge
Function (NG-word filter, 20-char limit, per-device rate limit) into
`public.cheer_comments`, and every open spectator view receives them live via
Supabase Realtime and flows them across the screen.

Setup:

1. Re-run `supabase/schema.sql` (creates `public.cheer_comments` and adds it to
   the `supabase_realtime` publication).
2. `supabase functions deploy send-cheer-comment`

Operations can pause/resume comments from 運営モード > 設定 > 応援コメント.
Comments older than 2 hours are pruned automatically. Without Supabase the
feature still works across tabs on one device via `BroadcastChannel` (demo
mode).
