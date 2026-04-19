/**
 * db.js - Supabase クライアント
 *
 * アップロードされたファイルと解析済みの行データをSupabaseに保存する。
 * 同じファイル名が既に存在する場合は上書き（既存を削除して再挿入）。
 */

'use strict';

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

/**
 * ファイル名から月を抽出
 * 例: "媒体管理表2026.4.xlsx" → "2026-04"
 */
function extractMonth(filename) {
  const m = filename.match(/(\d{4})\.(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
}

/**
 * 行の全列をSHA-1でハッシュ化（前月比較用）
 */
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

/**
 * ファイル1件を保存（同名上書き）
 * @param {string} filename
 * @param {string} folderName
 * @param {Array} rows
 * @returns {Promise<{id: string, month: string, row_count: number}>}
 */
async function saveFileToDb(filename, folderName, rows) {
  const month = extractMonth(filename);
  if (!month) throw new Error(`ファイル名から月を抽出できません: ${filename}`);

  // 既存fileを削除（on delete cascade でrowsも一緒に消える）
  const { error: delErr } = await supabaseClient
    .from('files')
    .delete()
    .eq('filename', filename);
  if (delErr) throw delErr;

  // fileレコード挿入
  const { data: fileData, error: fileErr } = await supabaseClient
    .from('files')
    .insert({
      filename,
      month,
      folder_name: folderName,
      row_count: rows.length
    })
    .select()
    .single();
  if (fileErr) throw fileErr;

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
    row_hash: await computeRowHash(r)
  })));

  // 1000件ずつバッチ挿入（Supabaseの上限対策）
  const BATCH = 1000;
  for (let i = 0; i < rowRecords.length; i += BATCH) {
    const batch = rowRecords.slice(i, i + BATCH);
    const { error: rowErr } = await supabaseClient.from('rows').insert(batch);
    if (rowErr) throw rowErr;
  }

  return { id: fileData.id, month, row_count: rows.length };
}
