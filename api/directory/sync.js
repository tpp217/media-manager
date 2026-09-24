// メンバー名簿ディレクトリ同期。workspace-hub のロスターAPI から名簿をプルし、
// member_directory（統一形 system_key,tenant_id,member_id）へ upsert する。
// 認証: Authorization: Bearer <SSO_EXCHANGE_SECRET>（サーバー間。ロスターAPI と同じ秘密で保護）。
//   既存の auth-gate(evaluateAuth=wh_token 検証) は使わない。これはサーバー間秘密で守る別系統。
// トリガは運用者 or cron（このアプリに名簿管理UIが無いため、ボタンではなくエンドポイント方式）。
// 名簿は将来の担当アサイン等の候補リスト（ログイン未済の人も含む組織名簿）として使う。
import crypto from 'node:crypto';
import { sbFetch, eq } from '../_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST のみ' });

  const secret = (process.env.SSO_EXCHANGE_SECRET || '').trim();
  if (!secret) return res.status(500).json({ ok: false, error: 'SSO_EXCHANGE_SECRET 未設定' });

  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  const authed =
    token.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const tenantId = ((req.query && req.query.tenant_id) || '').trim();
  if (!tenantId) return res.status(400).json({ ok: false, error: 'tenant_id は必須です' });

  const systemKey = (process.env.AUTH_SYSTEM_KEY || 'media').trim();

  try {
    // --- ロスターをプル ---
    const rosterRes = await fetch(
      `https://auth.utinc.dev/api/roster?tenant_id=${encodeURIComponent(tenantId)}&system_key=${encodeURIComponent(systemKey)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!rosterRes.ok) return res.status(502).json({ ok: false, error: `roster API ${rosterRes.status}` });
    const roster = await rosterRes.json().catch(() => null);
    // 形の崩れた応答を「名簿 0 人」と解釈すると全員を無効化してしまうため、何も触らず失敗させる。
    if (!roster || !Array.isArray(roster.members)) {
      return res.status(502).json({ ok: false, error: 'roster API の応答に members がありません' });
    }
    const members = roster.members;
    const now = new Date().toISOString();

    // --- service_role(REST) で同期。先に upsert し、その後で名簿から消えた人だけ active=false にする
    //     （途中で失敗しても全員が無効化された状態を作らない）。sbFetch は非 2xx で throw する ---
    if (members.length) {
      const rows = members.map((m) => ({
        system_key: systemKey,
        tenant_id: tenantId,
        member_id: String(m.id),
        kind: m.kind ?? null,
        display_name: m.display_name ?? '',
        department: m.department ?? null,
        line_user_id: m.line_user_id ?? null,
        active: true,
        source_updated_at: m.updated_at ?? null,
        synced_at: now,
      }));
      await sbFetch('member_directory?on_conflict=system_key,tenant_id,member_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
    }

    // 今回 upsert した行は synced_at=now。それ以外（名簿から消えた人）だけを無効化する。
    // member_id の not.in 列挙だと大人数で URL 長を超えるため、synced_at で判定する。
    const stale = encodeURIComponent(`(synced_at.is.null,synced_at.lt."${now}")`);
    await sbFetch(`member_directory?system_key=${eq(systemKey)}&tenant_id=${eq(tenantId)}&active=is.true&or=${stale}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ active: false }),
    });

    return res.status(200).json({ ok: true, count: members.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
