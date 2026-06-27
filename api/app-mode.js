// GET /api/app-mode
//
// クライアント（静的 index.html / js）向けに動作モードを返す軽量 JSON。
// 静的サイト＋Vercel Functions 構成のため、ブラウザは env を直接読めない。
// フロントはこのエンドポイントを 1 回叩いて単体版/プラットフォーム版を判定し、
// ログイン導線（SSO へ飛ばすか）やアイコンの遷移先を切り替える。
//
// 返すのは非機密の構成フラグのみ（秘密値は一切含めない）。
//   { standalone: boolean }
//
// 後方互換: STANDALONE 未設定なら standalone:false（＝プラットフォーム版・現挙動）。
import { isStandalone } from './_lib/app-mode.js';

export default function handler(req, res) {
  res.status(200).json({ standalone: isStandalone() });
}
