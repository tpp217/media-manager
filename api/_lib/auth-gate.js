/**
 * 認証ゲート（監視モード対応）
 *
 * workspace-hub（auth.utinc.dev）が発行する JWT（RS256）を JWKS で検証する共通ヘルパ。
 * Vercel Functions（api/*.js）から import して使う。
 *
 * ── 設計の核心：既定では「監視のみ」でブロックしない ──
 *   - 既定（AUTH_ENFORCE 未設定 / "off"）では、トークンの有無・検証可否を
 *     console に記録するだけで、リクエストは常に通す（現挙動を一切変えない）。
 *   - AUTH_ENFORCE=on のときだけ、検証失敗 / トークン欠如 / 対象システム不一致を
 *     401 / 403 でブロックする。
 *
 * ── 既存の LINE SSO 認証（api/auth/* の HMAC Cookie セッション）とは併存 ──
 *   - このゲートは業務データ系エンドポイント（files.js / rows.js）の先頭に追加するだけ。
 *   - auth フローや requireAuth（Cookie セッション）には一切手を入れない。
 *
 * 環境変数:
 *   - JWKS_URL        JWKS エンドポイント（既定 https://auth.utinc.dev/.well-known/jwks.json）
 *   - AUTH_ENFORCE    "on" でブロック有効化。それ以外（未設定含む）は監視のみ
 *   - CAP_ENFORCE     "on" で capabilities（操作権限）不足を 403 でブロック。
 *                     それ以外（未設定含む）は [cap-monitor] ログのみ（監視モード）。
 *                     書き込み系（GET/HEAD/OPTIONS 以外）に「<システムキー>.write」を要求する
 *   - AUTH_SYSTEM_KEY 自アプリのシステムキー（既定 "media"）。
 *                     enforce 時、JWT の systems[] にこのキーが含まれるかを検証。
 *                     ※ workspace-hub の SYSTEM_CATALOG / system_access.system_key と
 *                       一致している必要がある。enforce を on にする前に必ず要確認。
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { isStandalone, standaloneTenantId } from './app-mode.js';
import { verifySession, SESSION_COOKIE } from './util.js';

const DEFAULT_JWKS_URL = 'https://auth.utinc.dev/.well-known/jwks.json';
// 既定の issuer。workspace-hub が発行する JWT の iss クレーム（固定値）。
// 署名検証に加え iss を照合することで、別発行元のトークンによるなりすましを二重防御する。
const DEFAULT_ISSUER = 'https://auth.utinc.dev';
// 既定のシステムキー。workspace-hub SYSTEM_CATALOG のキー（media-manager 系統 = "media"）。
// ※ system_access.system_key と一致している必要があり、enforce 前に要確認。
const DEFAULT_SYSTEM_KEY = 'media';

/** 期待する JWT 発行元（iss）。既定は workspace-hub の固定値 */
function expectedIssuer() {
  return process.env.AUTH_EXPECTED_ISSUER || DEFAULT_ISSUER;
}

/** enforce が有効か（"on" のときだけ true） */
export function isEnforcing() {
  return String(process.env.AUTH_ENFORCE || '').toLowerCase() === 'on';
}

/** 自アプリのシステムキー */
function systemKey() {
  return process.env.AUTH_SYSTEM_KEY || DEFAULT_SYSTEM_KEY;
}

/** capability enforce が有効か（CAP_ENFORCE=on のときだけ true。それ以外は監視のみ） */
function isCapEnforcing() {
  return String(process.env.CAP_ENFORCE || '').toLowerCase() === 'on';
}

/** 書き込み系メソッドか（GET/HEAD/OPTIONS 以外はすべて書き込み扱い） */
function isWriteMethod(method) {
  const m = String(method || '').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

/**
 * JWT の capabilities claim（string 配列）による操作ガード。
 *
 * - 書き込み系リクエスト（GET/HEAD/OPTIONS 以外）には「<システムキー>.write」
 *   （既定: media.write）を要求する。
 * - requiredCaps で追加の capability を要求できる（将来の特権操作用。現状は未使用）。
 * - 挙動は CAP_ENFORCE で二段階:
 *     CAP_ENFORCE=on → 不足時に 403（日本語エラー）でブロック
 *     それ以外（未設定含む）→ ブロックせず [cap-monitor] ログのみ（点灯前の影響調査用）
 * - 検証済み claims が無いリクエスト（トークン無しで監視モード素通り等）はここに来ない
 *   （誰の操作か判定できないため。evaluateAuth 側で return 済み）。
 */
function evaluateCapabilities({ claims, method = '', path = '', requiredCaps = [] } = {}) {
  const required = [];
  if (isWriteMethod(method)) required.push(`${systemKey()}.write`);
  for (const c of requiredCaps) {
    if (c && !required.includes(c)) required.push(c);
  }
  if (required.length === 0) return { allowed: true }; // 読み取り系は capability 不要

  const owned = Array.isArray(claims && claims.capabilities) ? claims.capabilities : [];
  const missing = required.filter((c) => !owned.includes(c));
  if (missing.length === 0) return { allowed: true };

  // 監視ログ（enforce の有無に関わらず必ず記録する）
  const user = (claims && (claims.line_user_id || claims.sub)) || 'unknown';
  for (const c of missing) {
    console.warn(`[cap-monitor] missing=${c} path=${path} user=${user}`);
  }
  if (isCapEnforcing()) {
    return {
      allowed: false,
      status: 403,
      body: { error: `この操作の権限（${missing[0]}）がありません。` },
    };
  }
  return { allowed: true }; // 監視モード: 記録のみで素通り
}

// JWKS は遅延生成してプロセス内でキャッシュ（jose が内部で鍵をキャッシュ／更新する）
let _jwks = null;
function getJWKS() {
  if (!_jwks) {
    const url = process.env.JWKS_URL || DEFAULT_JWKS_URL;
    _jwks = createRemoteJWKSet(new URL(url));
  }
  return _jwks;
}

/** Authorization: Bearer <token> からトークンを取り出す（無ければ null） */
/** Cookie ヘッダから wh_token を取り出す（無ければ null）。SSO callback が張る HttpOnly cookie。 */
function extractWhTokenCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'wh_token' && rest.length > 0) {
      const v = rest.join('=').trim();
      if (v.length > 0) return v;
    }
  }
  return null;
}

function extractBearer(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Cookie ヘッダ文字列から任意の cookie 値を取り出す（無ければ null）。URL デコード込み。 */
function extractCookie(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      if (v.length > 0) { try { return decodeURIComponent(v); } catch { return v; } }
    }
  }
  return null;
}

/**
 * JWT を検証してクレームを取り出す。
 * 成功: { ok:true, claims:{ tenant_id, level, capabilities, systems, sub } }
 * 失敗: { ok:false, reason }
 */
export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, getJWKS(), { issuer: expectedIssuer() });
    return {
      ok: true,
      claims: {
        tenant_id:    payload.tenant_id ?? null,
        level:        payload.level ?? null,
        capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
        systems:      Array.isArray(payload.systems) ? payload.systems : [],
        sub:          payload.sub ?? null,
        line_user_id: payload.line_user_id ?? null,
        // 表示用 additive claim（workspace-hub が付与）。下流は読むだけ。
        //   is_demo:     デモ/テスト用テナント（auth_core.tenants.is_demo）なら true。
        //                フロントのモック/サンプル表示の出し分けヒント（認可境界ではない）。
        //   name:        本人氏名 / tenant_name: テナント名 / department: 主所属の部署名。
        is_demo:      typeof payload.is_demo === 'boolean' ? payload.is_demo : false,
        name:         typeof payload.name === 'string' ? payload.name : null,
        tenant_name:  typeof payload.tenant_name === 'string' ? payload.tenant_name : null,
        department:   typeof payload.department === 'string' ? payload.department : null,
      },
    };
  } catch (e) {
    return { ok: false, reason: e && e.code ? e.code : (e && e.message) || 'verify_failed' };
  }
}

/**
 * リクエストを評価し、必要なら 401/403 を返す。
 *
 * @param {object} args
 * @param {string} args.authHeader  Authorization ヘッダ値
 * @param {string} args.method      HTTP メソッド（ログ用＋capability の write 判定に使用）
 * @param {string} args.path        パス（ログ用）
 * @param {string[]} [args.requiredCaps] 追加で要求する capability（将来の特権操作用）
 * @returns {Promise<{ allowed:boolean, status?:number, body?:object, claims?:object }>}
 *   - allowed:true  → 通す（監視モードでは常にこちら。enforce 時も検証成功ならこちら）
 *   - allowed:false → 呼び出し側で status/body を返してブロック（AUTH_ENFORCE=on または
 *                     CAP_ENFORCE=on で capability 不足のときのみ発生）
 */
export async function evaluateAuth({ authHeader, cookieHeader, method = '', path = '', requiredCaps = [] } = {}) {
  // 単体版（STANDALONE）: wh SSO/JWT が存在しない運用のため、wh JWT 監視/enforce ゲートは使わず、
  // 自前のローカルログインで発行した media_session（HMAC cookie）を必須にしてアクセスを塞ぐ。
  //   - media_session が有効 → 通す（allowed:true）。
  //   - 無い / 失効 / 改竄 → 401 でブロック（フロントは 401 を見て /login へ誘導）。
  // 認可（本人確認）はローカルログイン（/api/auth/standalone-login）、テナント分離は
  // resolveTenant の固定テナント（STANDALONE_TENANT_ID）に委ねる。
  // ※プラットフォーム版（STANDALONE 未設定）はこの分岐に入らず従来どおり＝挙動不変。
  if (isStandalone()) {
    const tag = `[auth-gate][STANDALONE] ${method} ${path}`;
    const session = verifySession(extractCookie(cookieHeader, SESSION_COOKIE));
    if (!session) {
      console.warn(`${tag} no_local_session`);
      return { allowed: false, status: 401, body: { error: 'ログインが必要です' } };
    }
    return { allowed: true };
  }

  const enforce = isEnforcing();
  // ヘッダ優先・無ければ SSO ログイン済みブラウザの wh_token cookie（フロント変更不要で認証が通る）。
  const token = extractBearer(authHeader) ?? extractWhTokenCookie(cookieHeader);
  const tag = `[auth-gate]${enforce ? '[ENFORCE]' : '[monitor]'} ${method} ${path}`;

  // トークン無し
  if (!token) {
    console.warn(`${tag} no_bearer_token`);
    if (enforce) {
      return { allowed: false, status: 401, body: { error: '認証が必要です（Bearer トークン未提供）' } };
    }
    return { allowed: true }; // 監視モード: 素通り
  }

  // 検証
  const result = await verifyToken(token);
  if (!result.ok) {
    console.warn(`${tag} verify_failed reason=${result.reason}`);
    if (enforce) {
      return { allowed: false, status: 401, body: { error: 'トークンの検証に失敗しました' } };
    }
    return { allowed: true }; // 監視モード: 素通り
  }

  const { claims } = result;

  // systems[] に自アプリが含まれるか（enforce 時のみ判定）
  const key = systemKey();
  const hasSystem = claims.systems.includes(key);
  if (!hasSystem) {
    console.warn(`${tag} system_not_authorized key=${key} tenant=${claims.tenant_id} systems=${JSON.stringify(claims.systems)}`);
    if (enforce) {
      return { allowed: false, status: 403, body: { error: 'このシステムへのアクセス権がありません' }, claims };
    }
    // 監視モード: 記録だけして素通り（capabilities の監視判定は下で続行する）
  } else {
    console.info(`${tag} ok tenant=${claims.tenant_id} level=${claims.level}`);
  }

  // ── capability（操作権限）ゲート ─────────────────────────────
  // 検証済み claims がある場合のみ判定する。トークン無し／検証失敗の素通り（監視モード）は
  // 上で return 済みのためここには来ない（誰の操作か判定できず、既存の監視ログに任せる）。
  const cap = evaluateCapabilities({ claims, method, path, requiredCaps });
  if (!cap.allowed) return { ...cap, claims };

  return { allowed: true, claims };
}

/**
 * Vercel / Node の res に対してブロック応答を書く小ヘルパ。
 * （allowed:false のときだけ呼ぶ想定）
 */
export function sendBlock(res, evalResult) {
  res.status(evalResult.status || 401).json(evalResult.body || { error: 'unauthorized' });
}

/**
 * 呼び出し元のテナント ID を解決する（データ分離＝テナントスコープ用）。
 *
 * ── enforce フラグとは独立に常に動く ──
 *   evaluateAuth（監視/enforce ゲート）はログインの可否を制御するが、こちらは
 *   「業務データをどのテナントに絞るか」を決める別の関心事。AUTH_ENFORCE が off でも
 *   テナント分離は常に必要なので、ここでは enforce 判定を行わず、wh JWT の tenant_id を読む。
 *
 * トークンは Authorization: Bearer を優先し、無ければ SSO ログイン済みブラウザの
 * wh_token cookie を使う（フロント変更不要）。検証に通ったトークンの tenant_id のみ採用する。
 *
 * @param {object} args
 * @param {string} [args.authHeader]   Authorization ヘッダ値
 * @param {string} [args.cookieHeader] Cookie ヘッダ値
 * @returns {Promise<{ ok:true, tenantId:string, claims:object } | { ok:false, reason:string }>}
 *   - ok:true  → tenantId（空でない文字列）を業務クエリのスコープに使う
 *   - ok:false → 呼び出し側は fail-closed（テナント未解決のデータ要求は拒否）
 */
export async function resolveTenant({ authHeader, cookieHeader } = {}) {
  // 単体版（STANDALONE）: 単一顧客＝1 テナント。wh JWT が無いため tenant_id claim は
  // 取れない。代わりに env STANDALONE_TENANT_ID の固定値をテナントスコープに使う。
  // 未設定なら fail-closed（テナント未解決のデータ要求は拒否＝漏洩防止）。
  // プラットフォーム版（既定・STANDALONE 未設定）はこの分岐に入らず従来どおり JWT を読む。
  if (isStandalone()) {
    const tid = standaloneTenantId();
    if (!tid) return { ok: false, reason: 'no_standalone_tenant_id' };
    return { ok: true, tenantId: tid, claims: { tenant_id: tid, standalone: true } };
  }

  const token = extractBearer(authHeader) ?? extractWhTokenCookie(cookieHeader);
  if (!token) return { ok: false, reason: 'no_token' };

  const verified = await verifyToken(token);
  if (!verified.ok) return { ok: false, reason: verified.reason || 'verify_failed' };

  const tenantId = verified.claims.tenant_id;
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    return { ok: false, reason: 'no_tenant_claim' };
  }
  return { ok: true, tenantId, claims: verified.claims };
}
