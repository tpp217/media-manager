/**
 * db.js - データアクセス層（サーバー API 経由）
 *
 * 旧版はブラウザから匿名キーで Supabase を直叩きしていたが、匿名 read/write が
 * 開放状態になるため、サーバー（Vercel Functions / service_role）経由に変更。
 * 匿名キーはクライアントから撤去済み。関数シグネチャは従来どおり。
 */

'use strict';

// ── API 呼び出し共通 ─────────────────────────────────────────
async function apiFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/api/auth/line/login';
    throw new Error('未認証のためログインへリダイレクトします');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${t.slice(0, 200)}`);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

// ── クライアント側ヘルパー（DB非依存・従来どおり） ──────────

/** ファイル名から月を抽出 例: "媒体管理表2026.4.xlsx" → "2026-04" */
function extractMonth(filename) {
  const m = filename.match(/(\d{4})\.(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
}

/** 行の全列を SHA-1 でハッシュ化（前月比較用） */
async function computeRowHash(row) {
  const text = [
    row.brand, row.category, row.agency, row.media,
    row.plan, row.note, String(row.amount ?? '')
  ].join('\t');
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 月を±nシフト（年跨ぎ対応） */
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── データ操作（API 経由） ───────────────────────────────────

/**
 * ファイル1件を保存（同名上書き）
 * @returns {Promise<{id: string, month: string, row_count: number}>}
 */
async function saveFileToDb(filename, folderName, rows) {
  const month = extractMonth(filename);
  if (!month) throw new Error(`ファイル名から月を抽出できません: ${filename}`);

  // 既存fileを削除（on delete cascade でrowsも一緒に消える）
  await apiFetch(`/api/files?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' });

  // fileレコード挿入（id を受け取る）
  const fileData = await apiFetch('/api/files', {
    method: 'POST',
    body: { filename, month, folder_name: folderName, row_count: rows.length }
  });

  // rowsレコードを準備
  const rowRecords = await Promise.all(rows.map(async (r, idx) => ({
    file_id: fileData.id,
    brand: r.brand ?? '',
    category: r.category ?? '',
    agency: r.agency ?? '',
    media: r.media ?? '',
    plan: r.plan ?? '',
    note: r.note ?? '',
    amount: Number(r.amount) || 0,
    row_index: idx,
    row_hash: await computeRowHash(r),
    colors: r._colors || []
  })));

  // 1000件ずつバッチ挿入
  const BATCH = 1000;
  for (let i = 0; i < rowRecords.length; i += BATCH) {
    await apiFetch('/api/rows', { method: 'POST', body: rowRecords.slice(i, i + BATCH) });
  }

  return { id: fileData.id, month, row_count: rows.length };
}

/**
 * 保存済みの月一覧を取得（ファイル数・行数集計付き・新しい順）
 */
async function getSavedMonths() {
  const data = await apiFetch('/api/files?summary=1');
  const grouped = {};
  for (const f of (data || [])) {
    if (!grouped[f.month]) grouped[f.month] = { file_count: 0, total_rows: 0 };
    grouped[f.month].file_count++;
    grouped[f.month].total_rows += (f.row_count || 0);
  }
  return Object.entries(grouped)
    .map(([month, stat]) => ({ month, ...stat }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * 前月の全行データを取得（差分ハイライト＋ツールチップ用）
 */
async function getPrevMonthRows(currentMonth) {
  const prevMonth = shiftMonth(currentMonth, -1);
  const files = await apiFetch(`/api/files?month=${encodeURIComponent(prevMonth)}`);
  if (!files || files.length === 0) return { prevMonth, rows: [] };
  const fileIds = files.map(f => f.id).join(',');
  const rows = await apiFetch(`/api/rows?fileIds=${encodeURIComponent(fileIds)}`);
  return { prevMonth, rows: rows || [] };
}

/**
 * 指定月のファイル＋行データを全取得
 */
async function loadMonthData(month) {
  const files = await apiFetch(`/api/files?month=${encodeURIComponent(month)}`);
  if (!files || files.length === 0) return { files: [], rows: [] };
  const fileIds = files.map(f => f.id).join(',');
  const rows = await apiFetch(`/api/rows?fileIds=${encodeURIComponent(fileIds)}&order=row_index`);
  return { files, rows: rows || [] };
}
