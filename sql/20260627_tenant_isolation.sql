-- ============================================================================
-- media-manager テナントデータ分離マイグレーション
-- ----------------------------------------------------------------------------
-- 対象 DB : media 系統 Supabase（bjxclepuflcjxbjdqbaa）/ public スキーマ
-- 対象表  : public.files / public.rows（media-manager の業務データ）
--           ※ member_directory・tmpl_*（template-library）・si_*（sales-insight）
--             は media-manager の管轄外のため本マイグレーションは触れない。
--
-- 目的    : 媒体管理データを呼び出し元 tenant_id にスコープする（クロステナント漏洩防止）。
--           主たる防御はアプリ層（service_role 接続のため）。本マイグレーションは
--           ① backfill ② 索引 ③ RLS による多層防御（DB レベルの最後の砦）を担う。
--
-- 既存データ: 全行が utinc テナント（993aba82-bfa2-4fc8-ada9-928e2875120f）。
--             additive のみ・破壊なし（列追加 + backfill + 索引 + RLS）。
--
-- 適用    : 本番（media bjxcl）への適用は親が確認後に手動で行う。本 PR では未適用。
-- ============================================================================

begin;

-- ── utinc テナント ID（既存データの所有者）─────────────────────────────────
-- 既存の全行はこのテナントに属する。NULL のまま残すと RLS で不可視になるため backfill する。
do $$
declare
  utinc_tenant constant text := '993aba82-bfa2-4fc8-ada9-928e2875120f';
begin
  -- ── 1) tenant_id 列の追加（additive・冪等）──────────────────────────────
  alter table public.files add column if not exists tenant_id text;
  alter table public.rows  add column if not exists tenant_id text;

  -- ── 2) 既存行の backfill（NULL の行を utinc に紐付け）──────────────────────
  update public.files set tenant_id = utinc_tenant where tenant_id is null;
  update public.rows  set tenant_id = utinc_tenant where tenant_id is null;
end $$;

-- ── 3) 索引（tenant スコープの検索を高速化）────────────────────────────────
create index if not exists idx_files_tenant_id on public.files (tenant_id);
create index if not exists idx_rows_tenant_id  on public.rows  (tenant_id);
-- rows は file_id + tenant_id の複合で引かれるため複合索引も用意。
create index if not exists idx_rows_tenant_file on public.rows (tenant_id, file_id);

-- ── 4) RLS（多層防御）──────────────────────────────────────────────────────
-- service_role 接続（サーバー側 sbFetch）は RLS をバイパスするため、ここは
-- 「アプリ層のフィルタが万一漏れた場合」「将来 authenticated ロールで叩いた場合」に
-- 効く最後の砦。ポリシーは JWT の tenant_id クレームと行の tenant_id 一致を要求する。
alter table public.files enable row level security;
alter table public.rows  enable row level security;

-- 既存ポリシーがあれば作り直し（冪等）。
drop policy if exists tenant_isolation_files on public.files;
drop policy if exists tenant_isolation_rows  on public.rows;

-- files: 自テナント行のみ全操作可（authenticated ロール）。
create policy tenant_isolation_files on public.files
  for all
  to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id'));

-- rows: 同上。
create policy tenant_isolation_rows on public.rows
  for all
  to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id'));

commit;
