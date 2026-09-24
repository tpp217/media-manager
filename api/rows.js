// 行データ（rows）API。認証必須。file_id 群での取得とバッチ挿入のみ。
// 全クエリを呼び出し元 tenant_id にスコープする（クロステナント漏洩防止・主たる防御＝アプリ層）。
import { sbFetch, eq, requireAuth } from './_lib/util.js';
import { evaluateAuth, sendBlock, resolveTenant } from './_lib/auth-gate.js';

const TABLE = 'rows';
const UUID_RE = /^[0-9a-f-]{36}$/i;
const PAGE_SIZE = 1000;
// クライアントが挿入できる列（tenant_id / id などはサーバー側で決める）。
const INSERTABLE = ['file_id', 'brand', 'category', 'agency', 'media', 'plan', 'note', 'amount', 'row_index', 'row_hash', 'colors'];

export default async function handler(req, res) {
  // 認証ゲート（workspace-hub JWT を JWKS 検証 / 既定は監視のみ・ブロックしない）。
  // AUTH_ENFORCE=on のときだけブロック。既存の LINE SSO Cookie 認証（requireAuth）とは併存。
  const auth = await evaluateAuth({
    authHeader: req.headers.authorization,
    cookieHeader: req.headers.cookie,
    method: req.method,
    path: '/api/rows',
  });
  if (!auth.allowed) return sendBlock(res, auth);

  if (!requireAuth(req, res)) return;

  // テナント解決（データ分離）。enforce フラグとは独立に常に必須。
  // 未解決（トークン無し / 検証失敗 / tenant_id クレーム欠如）は fail-closed。
  const t = await resolveTenant({
    authHeader: req.headers.authorization,
    cookieHeader: req.headers.cookie,
  });
  if (!t.ok) {
    console.warn(`[rows] tenant_unresolved reason=${t.reason}`);
    return res.status(403).json({ error: 'テナントを特定できませんでした（再ログインしてください）' });
  }
  const tid = t.tenantId;

  try {
    if (req.method === 'GET') {
      const { fileIds, order } = req.query;
      const ids = (fileIds || '').split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s));
      if (ids.length === 0) return res.status(200).json([]);
      // file_id 群に加えて tenant_id でも絞る（他テナントの file_id を渡されても漏れない）。
      // PostgREST の max_rows（既定 1000）で月データが黙って欠けないよう、空ページまで取り切る。
      // (file_id, row_index) はファイル内で一意なので、両方を順序キーに含めてページ境界を安定させる。
      const orderBy = order === 'row_index' ? 'row_index,file_id' : 'file_id,row_index';
      const base = `${TABLE}?tenant_id=${eq(tid)}&file_id=in.(${ids.join(',')})&select=*&order=${orderBy}`;
      const all = [];
      for (let offset = 0; ; ) {
        const page = (await sbFetch(`${base}&limit=${PAGE_SIZE}&offset=${offset}`)) || [];
        if (page.length === 0) break;
        all.push(...page);
        offset += page.length;
      }
      return res.status(200).json(all);
    }

    if (req.method === 'POST') {
      const batch = req.body;
      if (!Array.isArray(batch)) return res.status(400).json({ error: '配列が必要です' });
      if (batch.length > 0) {
        // file_id が自テナントの files に属することを確認（他テナントのファイルへ行を紐付けさせない）。
        const fileIds = [...new Set(batch.map((r) => (r && typeof r.file_id === 'string' ? r.file_id : '')))];
        if (fileIds.some((id) => !UUID_RE.test(id))) {
          return res.status(400).json({ error: 'file_id が不正です' });
        }
        const owned = (await sbFetch(`files?tenant_id=${eq(tid)}&id=in.(${fileIds.join(',')})&select=id`)) || [];
        if (owned.length !== fileIds.length) {
          return res.status(403).json({ error: '対象ファイルが見つかりません' });
        }
        // 列はホワイトリストのみ通し、tenant_id はサーバーで全行に強制（クライアント値は信用しない）。
        const stamped = batch.map((r) => {
          const row = { tenant_id: tid };
          for (const k of INSERTABLE) if (r[k] !== undefined) row[k] = r[k];
          return row;
        });
        await sbFetch(TABLE, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(stamped),
        });
      }
      return res.status(200).json({ ok: true, count: batch.length });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
