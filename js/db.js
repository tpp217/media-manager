/**
 * db.js - データアクセス層（サーバー API 経由）
 *
 * 旧版はブラウザから匿名キーで Supabase を直叩きしていたが、匿名 read/write が
 * 開放状態になるため、サーバー（Vercel Functions / service_role）経由に変更。
 * 匿名キーはクライアントから撤去済み。関数シグネチャは従来どおり。
 */

'use strict';

// ── API 呼び出し共通 ─────────────────────────────────────────

// 401 → SSO 再ログインの多重リダイレクト防止（このページ読み込み内で1回だけ）。
// 並列 fetch が同時に 401 になると、1本目が印を付けて再ログインへ向かう最中に
// 2本目が「試行済み」と誤判定してランチャーへ飛ばす競合があった（時々 workspace に
// 戻される実害・closing-automation #31 と同件）。最初の1本だけがリダイレクトを担当する。
let _authRedirecting = false;

// 「再認証を試みた」印を有効とみなす時間。印はセッション内に残り続けるため、
// これより古い印は無効（＝wh_token の次の15分失効では改めて無音再ログインを試みる）。
// 本物の 401 ループ（未契約等）は数秒内に再発するため、この窓でも従来どおり止まる。
const SSO_ATTEMPT_WINDOW_MS = 60 * 1000;

async function apiFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // 未認証（wh_token 失効・未ログイン等）→ SSO 再ログインへ誘導。
    // ループ防止: 直近（SSO_ATTEMPT_WINDOW_MS 内）で一度再認証を試みていれば再リダイレクトしない。
    // （media 未契約の operator 等は callback が cookie を張れず 401 が続くため、
    //   ガード無しだと 401→login→callback→401… の無限リダイレクトになる）。
    // 認証済みの応答が一度でも得られた時点で印を解除する（下記）。
    if (_authRedirecting) {
      throw new Error('再ログイン処理中です');
    }
    let attemptedAt = 0;
    try { attemptedAt = Number(sessionStorage.getItem('wh_sso_attempt')) || 0; } catch {}
    const attempted = attemptedAt > 0 && Date.now() - attemptedAt < SSO_ATTEMPT_WINDOW_MS;
    if (attempted) {
      // SSO 再ログインを試みても 401 のまま（未ログイン / 媒体管理の契約が無い等）。
      // 行き止まりにせず、案内を出してランチャーへ誘導する（AUTH_ENFORCE 点灯対応）。
      _authRedirecting = true;
      showAuthNotice('ログインが必要です。ランチャーへ移動します…');
      setTimeout(() => { window.location.href = 'https://auth.utinc.dev/launcher'; }, 1500);
      throw new Error('ログインが必要です。ランチャーへ移動します。');
    }
    try { sessionStorage.setItem('wh_sso_attempt', String(Date.now())); } catch {}
    _authRedirecting = true;
    window.location.href = '/api/auth/login';
    throw new Error('未認証のためログインへリダイレクトします');
  }
  if (res.status === 403) {
    // 権限不足（capabilities 不足・システム未契約等）。ランチャーへは飛ばさず
    // （無限リダイレクト防止）、サーバーが返す日本語エラーをそのまま画面に表示する。
    let msg = 'この操作を行う権限がありません。';
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch {}
    showAuthNotice(msg);
    throw new Error(msg);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${t.slice(0, 200)}`);
  }
  // 認証済みで応答が得られた → 再認証の試行印を解除（次回の失効時に再ログインを許可）。
  try { sessionStorage.removeItem('wh_sso_attempt'); } catch {}
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

// ── 認証・権限の画面通知 ─────────────────────────────────────
// 401/403 時に画面上部へ短い案内バナーを出す（alert より邪魔にならない固定表示）。
function showAuthNotice(message) {
  try {
    let el = document.getElementById('auth-notice-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'auth-notice-banner';
      el.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 16px;' +
        'background:#111;color:#fff;font-size:14px;text-align:center;' +
        'border-bottom:1px solid #555;';
      document.body.appendChild(el);
    }
    el.textContent = message;
  } catch { /* 通知が出せなくても本処理は止めない */ }
}

// ── クライアント側ヘルパー（DB非依存・従来どおり） ──────────

/** ファイル名から月を抽出 例: "媒体管理表2026.4.xlsx" → "2026-04" */
function extractMonth(filename) {
  const m = filename.match(/(\d{4})\.(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
}

/**
 * 表記ゆれの正規化（全角英数・記号 → 半角（「～」は除く） / 半角カナ → 全角 / 全角スペース → 半角、前後空白除去・連続空白を1つに）
 * 例: "ＭＥＯ" → "MEO"、"ﾊｯｸﾍﾞﾘｰ" → "ハックベリー"
 * NFKC を全文にかけると "①"→"1" や "㈱"→"(株)" まで変わるため、全角英数記号・半角カナ・全角スペースだけに限定する。
 */
function normalizeText(v) {
  return String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\uFF01-\uFF5D\uFF61-\uFF9F\u3000]+/g, s => s.normalize('NFKC'))
    .normalize('NFC')                 // "カ" + 濁点 のような分かれた文字を1文字にまとめる
    .replace(/[^\S\n]+/g, ' ')        // セル内改行は残し、それ以外の連続空白を1つに
    .replace(/ *\n */g, '\n')
    .trim();
}

/** 行の文字列列をまとめて正規化（金額・色などはそのまま） */
function normalizeRow(r) {
  return {
    ...r,
    brand: normalizeText(r.brand),
    category: normalizeText(r.category),
    agency: normalizeText(r.agency),
    media: normalizeText(r.media),
    plan: normalizeText(r.plan),
    note: normalizeText(r.note),
  };
}

/** 突合用の比較値（正規化＋英字の大文字小文字を区別しない） */
function matchText(v) {
  return normalizeText(v).replace(/\s+/g, ' ').toLowerCase();
}

/** 金額セルの文字列を数値に（"１，０００円" → 1000、"▲1,000" / "△1,000" → -1000） */
function parseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = normalizeText(v);
  const negative = /^[▲△]/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[^\d.-]/g, '');
  const n = parseFloat(s) || 0;
  return negative ? -Math.abs(n) : n;
}

/** 行の全列を SHA-1 でハッシュ化（DB 保存用。表記ゆれは正規化してから計算） */
async function computeRowHash(row) {
  const text = [
    row.brand, row.category, row.agency, row.media,
    row.plan, row.note
  ].map(normalizeText).concat(String(Number(row.amount) || 0)).join('\t');
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

  // 先に新しい file を作り、行を全部入れ終えてから同名の古い file を消す。
  // （旧: 先に古い方を消していたため、途中で失敗すると前回のデータまで消えていた）
  const fileData = await apiFetch('/api/files', {
    method: 'POST',
    body: { filename, month, folder_name: folderName, row_count: rows.length }
  });
  if (!fileData || !fileData.id) throw new Error(`ファイル登録に失敗しました: ${filename}`);

  // rowsレコードを準備
  const rowRecords = await Promise.all(rows.map(normalizeRow).map(async (r, idx) => ({
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

  // 1000件ずつバッチ挿入。失敗したら作りかけの新しい file を消して、古いデータを残す
  const BATCH = 1000;
  try {
    for (let i = 0; i < rowRecords.length; i += BATCH) {
      await apiFetch('/api/rows', { method: 'POST', body: rowRecords.slice(i, i + BATCH) });
    }
  } catch (err) {
    await apiFetch(`/api/files?id=${encodeURIComponent(fileData.id)}`, { method: 'DELETE' }).catch(() => {});
    throw err;
  }

  // 新しい方が揃ったので、同名の古い file を削除（on delete cascade で rows も一緒に消える）
  try {
    await apiFetch(
      `/api/files?filename=${encodeURIComponent(filename)}&exceptId=${encodeURIComponent(fileData.id)}`,
      { method: 'DELETE' }
    );
  } catch (err) {
    throw new Error(`新しいデータは保存しましたが、前回分の削除に失敗しました。もう一度アップロードしてください（${err.message}）`);
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
  // どのファイル（店舗）の行かを付けておく（一部の店舗だけ入れ直したときの比較用）
  const nameById = new Map(files.map(f => [f.id, f.filename]));
  return { prevMonth, rows: (rows || []).map(r => ({ ...r, _file: nameById.get(r.file_id) || '' })) };
}

/**
 * ファイル名から月の部分を除いた「店舗の目印」
 * 例: "【町田】媒体管理表2026.11.xlsx" → "【町田】媒体管理表.xlsx"（10月分と同じ目印になる）
 */
function fileStoreKey(filename) {
  return matchText(String(filename || '').replace(/\d{4}\.\d{1,2}/, ''));
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

/**
 * 指定月に保存済みのファイル名一覧（今回のアップロードに含まれない古いファイルの検出用）
 */
async function getMonthFilenames(month) {
  const files = await apiFetch(`/api/files?month=${encodeURIComponent(month)}`);
  return (files || []).map(f => f.filename);
}
