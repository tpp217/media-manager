/**
 * アプリ動作モード判定（共通ヘルパ / サーバー専用・依存なし）。
 *
 * media-manager は 2 つの販売形態を 1 本の env フラグ `STANDALONE` で住み分ける:
 *   - プラットフォーム版（既定・`STANDALONE` 未設定）
 *       workspace-hub（auth.utinc.dev）の SSO ログイン＋ロスター配布で動く（現行どおり）。
 *   - 単体版（`STANDALONE=true`）
 *       単一顧客向けに自前で完結する。wh SSO へは飛ばさず、テナントは固定値に揃える。
 *
 * ★最重要原則：完全後方互換
 *   `STANDALONE` 未設定＝現状のプラットフォーム挙動を一切変えない。
 *   単体版の分岐は「ON のときだけ」効く。判定は「ON（1/true/on/yes）以外はすべて false」。
 *
 * 静的サイト＋Vercel Functions 構成のため、クライアント（index.html / js）は
 * 値を直接読めない。クライアントは `/api/app-mode`（このフラグを返す軽量 JSON）を
 * 参照する。サーバー側（Functions）はこのヘルパを正本として使う。
 */

/** 真偽フラグの正規化。"1"/"true"/"on"/"yes"（大小無視）だけ true、それ以外は false。 */
export function truthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

/** 単体版か（env STANDALONE が ON のときだけ true・既定 false＝プラットフォーム版） */
export function isStandalone() {
  return truthy(process.env.STANDALONE);
}

/** 単体版の固定テナント ID（未設定なら null）。resolveTenant が単体版で返す値。 */
export function standaloneTenantId() {
  const v = process.env.STANDALONE_TENANT_ID;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}
