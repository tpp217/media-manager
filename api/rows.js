// 行データ（rows）API。認証必須。file_id 群での取得とバッチ挿入のみ。
import { sbFetch, requireAuth } from './_lib/util.js';
import { evaluateAuth, sendBlock } from './_lib/auth-gate.js';

const TABLE = 'rows';
const UUID_RE = /^[0-9a-f-]{36}$/i;

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
  try {
    if (req.method === 'GET') {
      const { fileIds, order } = req.query;
      const ids = (fileIds || '').split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s));
      if (ids.length === 0) return res.status(200).json([]);
      let path = `${TABLE}?file_id=in.(${ids.join(',')})&select=*`;
      if (order === 'row_index') path += '&order=row_index';
      const rows = await sbFetch(path);
      return res.status(200).json(rows || []);
    }

    if (req.method === 'POST') {
      const batch = req.body;
      if (!Array.isArray(batch)) return res.status(400).json({ error: '配列が必要です' });
      if (batch.length > 0) {
        await sbFetch(TABLE, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(batch),
        });
      }
      return res.status(200).json({ ok: true, count: batch.length });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
