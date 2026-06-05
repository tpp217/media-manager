// 行データ（rows）API。認証必須。file_id 群での取得とバッチ挿入のみ。
import { sbFetch, requireAuth } from './_lib/util.js';

const TABLE = 'rows';
const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function handler(req, res) {
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
