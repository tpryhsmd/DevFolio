# AGENTS.md — DevelopmentPortfolio

## プロジェクト概要
会社の技術情報をまとめる技術ポートフォリオアプリ。
Electron製。写真・文章を統一レイアウトで配置し、静的HTMLとして書き出す。

## 技術スタック
- Electron（メイン）
- HTML/CSS/JS（レンダラ）
- 独自拡張子によるシングルファイルデータ管理

## 主要機能
- コンテンツ配置（写真・文章、レイアウト固定）
- Undo/Redo
- バージョン履歴（複数保存・差分確認）
- 静的HTML書き出し
- 既存HTMLの読み込み・編集

## ディレクトリ構成
```
DevelopmentPortfolio/
├── AGENTS.md          # このファイル（AI向けガイド）
├── README.md          # 人間向け概要
├── .agent/            # AI運用メモ（MEMORY.md, HANDOFF.md, 経験ログ）
├── .spec/             # 設計仕様（ドメイン・API・タスク）
└── src/               # アプリ本体（実装開始時に作成）
```

## AIへの注意事項
- 既存ファイルを確認してからコーディングする
- 設計変更は .spec/ を先に更新する
- 成果物HTMLは `app-dist/`、配布物は `release/` に出力する
- 独自拡張子のフォーマットは .spec/ で定義してから実装する
