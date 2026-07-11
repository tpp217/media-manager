// 認証状態を返す。フロントの初期ゲート用。
//
// 二層で認証を見る:
//   1) 自前セッション（media_session）の有無 → ログイン済み判定（従来どおり）。
//   2) workspace-hub の wh_token cookie（あれば auth-gate で JWKS 検証）
//      → is_demo / 氏名 / テナント名 / 部署 を additive に返す（表示用）。
//
// wh_token が無い / 検証失敗でも、自前セッションが有効なら 200（identity は空のまま）。
// どちらも無ければ 401（従来どおりログインへ誘導）。
import { parseCookies, verifySession, SESSION_COOKIE } from '../_lib/util.js';
import { verifyToken } from '../_lib/auth-gate.js';
import { isStandalone } from '../_lib/app-mode.js';

export default async function handler(req, res) {
  const cookies = parseCookies(req);
  const session = verifySession(cookies[SESSION_COOKIE]);

  // 単体販売版（STANDALONE=true）: wh SSO を使わず、自前ローカルログインの media_session を正本にする。
  //   - 有効な media_session が無ければ 401（standalone:true を載せる）。
  //     フロントは standalone:true を見て /api/auth/login（SSO）ではなく /login（自前）へ誘導する。
  //   - 有効ならログイン済みとして 200。identity（テナント名/部署）は単体版では持たないため空。
  if (isStandalone()) {
    if (!session) {
      return res.status(401).json({ authenticated: false, standalone: true });
    }
    return res.status(200).json({
      authenticated: true,
      standalone: true,
      name: (session && session.name) || '',
      is_demo: false,
      tenant_name: '',
      department: '',
      department_id: '', // 単体版は wh JWT を持たないため部署識別子は空（フロントが常に読めるよう明示）。
    });
  }

  // workspace-hub JWT（wh_token cookie）があれば検証して表示用 claim を取り出す。
  // 失敗・未提供は identity 空のまま続行（自前セッションが正なら 200）。
  let identity = { is_demo: false, name: '', tenant_name: '', department: '', department_id: '' };
  const whToken = cookies['wh_token'];
  if (whToken) {
    const verified = await verifyToken(whToken);
    if (verified.ok) {
      const c = verified.claims;
      identity = {
        is_demo: c.is_demo === true,
        name: c.name || '',
        tenant_name: c.tenant_name || '',
        department: c.department || '',
        department_id: c.department_id || '',
      };
    }
  }

  // 自前セッションも wh_token も無ければ未認証。
  if (!session && !whToken) {
    return res.status(401).json({ authenticated: false });
  }

  res.status(200).json({
    authenticated: true,
    standalone: false, // プラットフォーム版（既定）。フロントが常にこのフィールドを読めるよう明示。
    // 氏名は wh の表示用 claim を優先し、無ければ自前セッションの name。
    name: identity.name || (session && session.name) || '',
    is_demo: identity.is_demo,
    tenant_name: identity.tenant_name,
    department: identity.department,
    // 部署 既定フィルタ用の識別子（UUID or "home"）。表示名 department とは別に additive で返す。
    // 現状 files/rows に部署次元が無いため既定フィルタ自体は未実装。フロントが将来使えるよう受け渡しのみ確立。
    department_id: identity.department_id,
  });
}
