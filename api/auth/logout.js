// ログアウト。セッション Cookie を失効させて入口へ戻す。
//   - media_session（自前 HMAC セッション。両モード共通）を必ず失効。
//   - wh_token（プラットフォーム版の SSO ゲート cookie）も失効（単体版では未設定なので無害）。
// 遷移先: 単体版は /login、プラットフォーム版は wh の全体ログアウト（下の logoutLocation）。
import { setCookie, SESSION_COOKIE } from '../_lib/util.js';
import { isStandalone } from '../_lib/app-mode.js';

const AUTH_ORIGIN = process.env.AUTH_EXPECTED_ISSUER || 'https://auth.utinc.dev';

// 単体版は /login。プラットフォーム版は wh の全体ログアウトへ送る（SSO 着地=/api/auth/callback）。
// wh の 24h セッションを失効させないと、SSO 入口が無音で再ログインしログアウトできない。
export function logoutLocation(req) {
  if (isStandalone()) return '/login';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/auth/callback`;
  return `${AUTH_ORIGIN}/api/auth/logout?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export default function handler(req, res) {
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
  setCookie(res, 'wh_token', '', { maxAge: 0 });
  res.writeHead(302, { Location: logoutLocation(req) });
  res.end();
}
