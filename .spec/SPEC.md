# SPEC.md — 技術ポートフォリオアプリ

## .ptf ファイル仕様

### ファイル構造（ZIP コンテナ）

```
portfolio.ptf  (ZIPアーカイブ)
├── document.json      # メタ情報・ページ・タグ・履歴
└── images/
    ├── <sha256>.jpg   # 画像実体（ハッシュ名で重複排除）
    └── <sha256>.png
```

### document.json スキーマ（version 1.0）

```jsonc
{
  "version": "1.0",
  "meta": {
    "title": "string",
    "company": "string",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  },
  "tags": ["string"],          // タグマスタ（単一の正本）
  "pages": [Page],
  "history": [Snapshot],
  "exportSettings": {
    "theme": "default",
    "includeToc": true
  }
}
```

#### Page

```jsonc
{
  "id": "string",              // 例: "page-1716268800000"
  "title": "string",
  "order": 0,                  // 表示順（0オリジン）。block.orderと同様に正本
  "tags": ["string"],          // tagsマスタを参照。マスタ未登録タグは不可
  "blocks": [Block]
}
```

#### Block

```jsonc
{
  "id": "string",
  "type": "text" | "image",
  "order": 0,
  "data": TextData | ImageData
}
```

#### TextData

```jsonc
{ "content": "string" }        // sanitized HTML（DOMPurify適用済み）
```

#### ImageData

```jsonc
{
  "imageRef": "string",        // sha256ハッシュ。images/<ref>.<ext>を参照
  "alt": "string",
  "caption": "string"
}
```

#### Snapshot（バージョン履歴）

```jsonc
{
  "snapshotId": "string",
  "label": "string",
  "savedAt": "ISO8601",
  "pagesSnapshot": [Page]      // pagesの深いコピー。imageRefのみ保持（画像実体なし）
}
```

---

## タグ整合性ルール

- `tags`（ルート）が唯一の正本
- ページの `tags` はマスタ参照のみ。マスタ未登録タグは付与不可
- マスタからタグ削除 → 全ページの該当タグを自動除去（伝播）
- タグリネーム → マスタ更新 + 全ページへ伝播
- 保存時に未使用タグを検出 → ユーザーに整理を促す（自動削除しない）

---

## IPC API（preload.js → main.js）

| チャネル | 方向 | 説明 |
|----------|------|------|
| `ptf:new` | invoke | 新規ドキュメント作成 |
| `ptf:open` | invoke | ファイルを開く（ダイアログ） |
| `ptf:save` | invoke | 上書き保存 |
| `ptf:saveAs` | invoke | 名前を付けて保存 |
| `ptf:getDocument` | invoke | 現在のdocumentを取得（deep copy） |
| `ptf:updateDocument` | invoke | documentを更新（dirty フラグ立て） |
| `ptf:addImage` | invoke | 画像をプールに追加 → ref返却 |
| `ptf:getImage` | invoke | refから画像バッファ取得 |
| `ptf:loaded` | on（レンダラ受信） | ファイル読み込み完了通知 |
| `menu:undo` | on | メニューからUndo |
| `menu:redo` | on | メニューからRedo |

---

## セキュリティ設定

```js
// BrowserWindow webPreferences
contextIsolation: true
nodeIntegration: false
sandbox: true
```

CSP（index.html）:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
```

---

## 画像プール仕様

- キー: sha256(buffer) の16進数文字列
- 値: `{ buffer: Buffer, ext: string }`
- 同一バイナリを複数挿入しても images/ エントリは1つのみ
- スナップショット復元後も画像は images/ に残存（GCは手動）
