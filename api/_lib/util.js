// 共通ヘルパー（サーバー専用 / 依存なし）。
// - Supabase へは service_role キーで REST を直叩き（RLS バイパスはサーバー限定）。
// - セッションは SESSION_SECRET による HMAC 署名トークンを HttpOnly Cookie で保持。
// - クライアント（ブラウザ）には service_role / anon キーを一切渡さない。

import crypto from 'node:crypto';

export const SESSION_COOKIE = 'media_session';
const SESSION_TTL_SEC = 60 * 60 * 12; // 12時間

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が未設定です`);
  return v;
}

// ── Supabase REST（service_role） ─────────────────────────────
// path 例: "contractor_snapshots?store_name=eq.A&select=*"
export async function sbFetch(path, init = {}) {
  const url = `${env('SUPABASE_URL')}/rest/v1/${path}`;
  const key = env('SUPABASE_SERVICE_KEY');
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  // DELETE / 一部 POST は本文なし
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// sbFetch と同じだが、件数（Content-Range の "/総数"）も返す。総数が読めないときは total=null。
// 呼び出し側で init.headers.Prefer に 'count=exact' を付けること。
export async function sbFetchWithCount(path, init = {}) {
  const url = `${env('SUPABASE_URL')}/rest/v1/${path}`;
  const key = env('SUPABASE_SERVICE_KEY');
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
  return { data: text ? JSON.parse(text) : null, total: m ? Number(m[1]) : null };
}

// PostgREST の max_rows（既定 1000）で黙って欠けないよう、条件に合う行をすべて取る。
// 1 ページ目で総数を受け取り、残りのページは parallel 本ずつ同時に取る（1 ページずつ順番に待つと、行数が多いほど遅くなる）。
// base には order を含め、ページ境界が安定する並び順にしておくこと。
export async function fetchAllPages(base, pageSize = 1000, parallel = 4) {
  const first = await sbFetchWithCount(`${base}&limit=${pageSize}&offset=0`, { headers: { Prefer: 'count=exact' } });
  const all = first.data || [];
  // 実際に返ってきた 1 ページの件数（サーバー側の max_rows が pageSize より小さい場合に合わせる）
  const step = all.length;
  if (step === 0) return all;
  if (first.total != null && first.total > step) {
    const offsets = [];
    for (let o = step; o < first.total; o += step) offsets.push(o);
    for (let i = 0; i < offsets.length; i += parallel) {
      const pages = await Promise.all(
        offsets.slice(i, i + parallel).map((o) => sbFetch(`${base}&limit=${step}&offset=${o}`))
      );
      for (const page of pages) if (page) all.push(...page);
    }
  }
  // 総数が読めなかった・取得中に行が増えた場合に備え、空ページまで順番に取り切る（従来の動き）。
  for (let offset = all.length; ; ) {
    const page = (await sbFetch(`${base}&limit=${pageSize}&offset=${offset}`)) || [];
    if (page.length === 0) break;
    all.push(...page);
    offset += page.length;
  }
  return all;
}

// PostgREST のフィルタ値を安全にエンコードする。
export const eq = (v) => `eq.${encodeURIComponent(v)}`;

// ── セッション（HMAC 署名トークン） ──────────────────────────
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const b64uJson = (obj) => b64u(JSON.stringify(obj));

function sign(data) {
  return crypto.createHmac('sha256', env('SESSION_SECRET')).update(data).digest('base64url');
}

export function issueSession(payload) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
  const p = b64uJson(body);
  return `${p}.${sign(p)}`;
}

export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [p, sig] = token.split('.');
  // 定数時間比較
  const expected = sign(p);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

// ── Cookie ───────────────────────────────────────────────────
export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

export function setCookie(res, name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'Secure',
    'SameSite=Lax',
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

// ── 認証ガード ───────────────────────────────────────────────
// 認証済みならセッション本体を返す。未認証なら 401 を返して null。
export function requireAuth(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = verifySession(token);
  if (!session) {
    res.status(401).json({ error: 'unauthenticated' });
    return null;
  }
  return session;
}

// ── リクエスト元オリジン（LINE redirect_uri 組み立て用） ─────
export function originOf(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
