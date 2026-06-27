# MEDIA-MGR v2.0 — 媒体管理表統合システム

サイバーパンク Yellow テーマの業務効率化Webアプリ。
複数の媒体管理表Excelを統合し、代理店別タブ確認・代理店別Excel出力を行います。

## 🚀 機能

| 機能 | 詳細 |
|------|------|
| **フォルダドロップ** | フォルダごとドロップで中のExcelを一括読み込み |
| **Excel統合** | 複数ファイルを1データセットに統合 |
| **代理店タブ** | 出現順に自動生成・タブ切り替えで絞り込み |
| **検索・ソート** | リアルタイム検索・列ヘッダークリックでソート |
| **出力前プレビュー** | ダウンロード前にモーダルで内容確認 |
| **統合Excel出力** | 全データ＋代理店別シート入り |
| **代理店別個別出力** | 選択した代理店ごとにファイル生成 |
| **Excel書式** | ヘッダー色・罫線・金額フォーマット・行固定・フィルター |
| **原本色反映** | 読み込んだExcelの背景色をそのまま出力に反映 |
| **前月比較** | 統合データを Supabase に保存し、前月分との差分をハイライト・ツールチップ表示 |

## 📁 ファイル構成

```
media-manager/
├── index.html        # メインHTML
├── css/
│   └── style.css     # サイバーパンクYellowテーマCSS
├── js/
│   ├── config.js     # Supabase 接続情報（URL / anon キー）
│   ├── db.js         # Supabase クライアント（files / rows 保存・前月比較）
│   └── app.js        # アプリケーションロジック
└── README.md
```

> 統合した行データは Supabase（`files` / `rows` テーブル）に保存され、前月分との差分比較に利用されます。Excel の読み込み・統合・出力自体はブラウザ内で完結します。

## 🔀 動作モード（プラットフォーム版 / 単体販売版）

このアプリは 1 本の env フラグ `STANDALONE` で 2 つの販売形態を住み分けます。

| 観点 | プラットフォーム版（既定・`STANDALONE` 未設定） | 単体版（`STANDALONE=true`） |
|---|---|---|
| ログイン | workspace-hub の SSO（LINE 統一・既存） | アプリ自前ログイン（`/login`・Supabase Auth の email/password） |
| テナント | wh JWT の `tenant_id` claim | `STANDALONE_TENANT_ID` に固定（単一顧客＝1 テナント） |
| 認証ゲート | 監視/enforce（`AUTH_ENFORCE`） | 自前 `media_session` を必須化（無ければ 401→`/login`） |
| 媒体データ | 各テナントの自前データ | 単一顧客＝自前で完結（専用の登録 UI は不要） |

### ★最重要：完全後方互換
`STANDALONE` 未設定＝**現状のプラットフォーム挙動を一切変えません**。単体版の分岐はフラグ ON のときだけ効きます（ON 判定は `1`/`true`/`on`/`yes`・それ以外はすべて false）。

### 関連 env
- `STANDALONE` … 単体版にするフラグ。
- `STANDALONE_TENANT_ID` … 単体版で全データを紐づける固定テナント ID（`STANDALONE=true` のとき必須）。
- `SUPABASE_ANON_KEY`（無ければ `SUPABASE_PUBLISHABLE_KEY`）… 単体版ログインで使う公開可キー。`/login` がブラウザで `signInWithPassword` し、サーバーは `/auth/v1/user` で token を検証する。

### 単体版ログインの仕組み（自前ローカルログイン）
単体版は wh SSO を使わず、アプリ自前の `media_session` でアクセスを制御します。

1. 未ログインで `/` を開くと `/login`（`login.html`）へ誘導。
2. `/login` が `/api/auth/standalone-login`（GET）で公開設定（`SUPABASE_URL` ＋ anon キー）を取得し、supabase-js で email/password の `signInWithPassword` を実行。
3. 取得した `access_token` を `/api/auth/standalone-login`（POST）へ送ると、サーバーが Supabase の `/auth/v1/user` で token を検証し、成功時に既存基盤（`issueSession`）で `media_session` cookie を発行。
4. 以後、業務 API（`files` / `rows`）の認証ゲート（`evaluateAuth` の STANDALONE 分岐）が `media_session` を必須化（無ければ 401）。テナントは `STANDALONE_TENANT_ID` 固定。

> パスワードはサーバーを通りません（本人確認は Supabase に委譲）。サーバーが扱うのは Supabase 発行の `access_token` のみで、anon / publishable キーは公開可キーです（service_role はクライアントに渡しません）。

#### 初期ユーザーの作成
単体版ユーザーは **Supabase ダッシュボード**で作成します（このアプリにユーザー登録 UI はありません）。
対象 Supabase プロジェクトの **Authentication > Users > Add user** で email / password を登録すれば、その資格情報で `/login` からログインできます。

実装の正本は `api/_lib/app-mode.js`（サーバー判定）／`api/app-mode.js`（クライアント取得用 JSON）です。

### ★後方互換の根拠
単体版の分岐はすべて `isStandalone()`（`STANDALONE` が ON のときだけ true）のガード下にあります。`STANDALONE` 未設定では `standalone-login` は **404**、`evaluateAuth` / `me` / `logout` の STANDALONE 分岐には入らず、wh SSO 経路（`api/auth/login` → `callback`）・wh JWT 検証は一切変わりません（additive な変更のみ）。

## 🖥️ 使い方

1. **index.htmlをブラウザで開く**（ネット接続でフォントが読み込まれます）
2. **STEP 01**: 「媒体管理表2026.4」などのフォルダをドロップ → 「統合実行」
3. **STEP 02**: 代理店タブで絞り込み・検索・ソートして内容確認
4. **STEP 03**: 統合ファイルまたは代理店別でExcelをダウンロード

## 🎨 デザイン

- テーマカラー：ゴールド `#ffd700` / アンバー `#ff8c00`
- 純黒背景・グリッドライン・スキャンライン・HUDコーナーマーカー
- Orbitron + Share Tech Mono フォント

## 🔗 GitHub Pages

`https://tpp217.github.io/media-manager/`
