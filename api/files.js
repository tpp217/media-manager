// 媒体ファイル（files）API。認証必須。月・ファイル名の限定操作のみ。
import { sbFetch, eq, requireAuth } from './_lib/util.js';

const TABLE = 'files';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { month, summary } = req.query;
      if (summary) {
        const rows = await sbFetch(`${TABLE}?select=month,row_count`);
        return res.status(200).json(rows || []);
      }
      if (month) {
        const rows = await sbFetch(`${TABLE}?month=${eq(month)}&select=*&order=uploaded_at`);
        return res.status(200).json(rows || []);
      }
      return res.status(400).json({ error: 'month または summary が必要です' });
    }

    if (req.method === 'POST') {
      const { filename, month, folder_name, row_count } = req.body || {};
      if (!filename || !month) return res.status(400).json({ error: 'filename / month が必要です' });
      const inserted = await sbFetch(TABLE, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ filename, month, folder_name: folder_name ?? '', row_count: row_count ?? 0 }),
      });
      return res.status(200).json((inserted && inserted[0]) || null);
    }

    if (req.method === 'DELETE') {
      const { filename } = req.query;
      if (!filename) return res.status(400).json({ error: 'filename が必要です' });
      // files 削除で rows は on delete cascade により連動削除
      await sbFetch(`${TABLE}?filename=${eq(filename)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
