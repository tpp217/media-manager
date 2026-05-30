# MEDIA-MGR（media-manager）

媒体管理表統合システム v2.0。複数の媒体管理表 Excel を統合し、代理店別タブ確認・代理店別 Excel 出力を行う。サイバーパンク Yellow テーマ（ゴールド `#ffd700` / アンバー `#ff8c00`）。

## 構成

```
media-manager/
├── index.html       # メイン HTML
├── css/style.css    # サイバーパンク Yellow テーマ
├── js/app.js        # 全ロジック（読み込み・統合・タブ・出力）
├── favicon.svg
└── vercel.json
```

ビルドステップなし。Vercel 静的配信。

## 主要機能

- **フォルダドロップ**: フォルダごとドロップで中の Excel を一括読み込み
- **Excel 統合**: 複数ファイルを 1 データセットに統合
- **代理店タブ**: 出現順に自動生成、タブ切り替えで絞り込み
- **検索・ソート**: リアルタイム検索、列ヘッダーでソート
- **出力**: 統合 Excel（全データ + 代理店別シート）/ 代理店別個別出力
- **書式保持**: ヘッダー色・罫線・金額フォーマット・行固定・フィルター
- **原本色反映**: 読み込んだ Excel の背景色をそのまま出力に反映

## 技術スタック

- 純粋な HTML / CSS / JavaScript（フレームワーク不使用）
- Excel: SheetJS（XLSX）
- フォント: Orbitron + Share Tech Mono（Google Fonts）

## 注意事項

- **Supabase は使っていない**: 完全クライアントサイド処理（ファイルはブラウザ内のみ）
- **`sales-insight` の Supabase プロジェクトは media-manager プロジェクト相乗り**: media-manager 自体は DB を使わないが、Supabase プロジェクト名として共有されている。混同しない
- **原本色反映**: SheetJS で読んだ cell スタイルを保ったまま書き戻す処理がコアバリュー。`app.js` のスタイル保持ロジックを壊さない
- **デザイン**: サイバーパンク Yellow は他システムと違うので、operation-hub の design-spec には準拠**しない**例外プロジェクト

## デプロイ

- 本番: `https://media.utinc.dev`
- main マージで Vercel 自動デプロイ
- 旧 GitHub Pages: `https://tpp217.github.io/media-manager/`（保守用）

Git / Vercel 運用はグローバル `~/.claude/CLAUDE.md` に準拠。
