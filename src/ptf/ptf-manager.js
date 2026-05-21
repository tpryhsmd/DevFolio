const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const { createEmptyDocument, migrate, validate } = require('./schema');
const ImagePool = require('./image-pool');

class PtfManager {
  constructor() {
    this.currentPath = null;
    this._doc = null;
    this._imagePool = new ImagePool();
    this._dirty = false;
  }

  // --- 状態アクセス ---

  isDirty() { return this._dirty; }

  getDocument() {
    return JSON.parse(JSON.stringify(this._doc)); // deep copy
  }

  updateDocument(doc) {
    validate(doc);
    this._doc = doc;
    this._dirty = true;
  }

  // --- 画像操作 ---

  addImage(buffer, ext) {
    const ref = this._imagePool.add(buffer, ext);
    this._dirty = true;
    return ref;
  }

  getImage(ref) {
    const entry = this._imagePool.get(ref);
    if (!entry) return null;
    return entry.buffer;
  }

  // --- ファイル操作 ---

  createNew() {
    this.currentPath = null;
    this._doc = createEmptyDocument();
    this._imagePool = new ImagePool();
    this._dirty = false;
  }

  async load(filePath) {
    const data = fs.readFileSync(filePath);
    const zip = new AdmZip(data);

    const docEntry = zip.getEntry('document.json');
    if (!docEntry) throw new Error('document.json が見つかりません');

    const raw = JSON.parse(docEntry.getData().toString('utf-8'));
    const doc = migrate(raw);
    validate(doc);

    this._imagePool = new ImagePool();
    this._imagePool.loadFromZip(zip);

    this._doc = doc;
    this.currentPath = filePath;
    this._dirty = false;
  }

  // --- スナップショット ---

  saveSnapshot(label) {
    if (!this._doc) return;
    const snapshot = {
      snapshotId: `snap-${Date.now()}`,
      label: label || new Date().toLocaleString('ja-JP'),
      savedAt: new Date().toISOString(),
      pagesSnapshot: JSON.parse(JSON.stringify(this._doc.pages)),
    };
    this._doc.history = this._doc.history || [];
    this._doc.history.unshift(snapshot);
    // 最大20件
    if (this._doc.history.length > 20) this._doc.history.length = 20;
    this._dirty = true;
  }

  restoreSnapshot(snapshotId) {
    if (!this._doc) return;
    const snap = (this._doc.history || []).find((s) => s.snapshotId === snapshotId);
    if (!snap) throw new Error('スナップショットが見つかりません');
    this._doc.pages = JSON.parse(JSON.stringify(snap.pagesSnapshot));
    this._dirty = true;
  }

  deleteSnapshot(snapshotId) {
    if (!this._doc) return;
    this._doc.history = (this._doc.history || []).filter((s) => s.snapshotId !== snapshotId);
    this._dirty = true;
  }

  // --- HTML書き出し ---

  exportHtml(filePath, pageIds) {
    if (!this._doc) throw new Error('ドキュメントが存在しません');

    const doc = this._doc;
    const allPages = (doc.pages || []).slice().sort((a, b) => a.order - b.order);

    // pageIds が指定された場合はフィルタリング（順序維持）
    const pages = pageIds && pageIds.length > 0
      ? allPages.filter((p) => pageIds.includes(p.id))
      : allPages;

    if (pages.length === 0) throw new Error('書き出すページがありません');

    // タグ別インデックスを構築（対象ページのみ）
    const tagMap = {};
    (doc.tags || []).forEach((tag) => {
      const tagged = pages.filter((p) => p.tags.includes(tag));
      if (tagged.length > 0) tagMap[tag] = tagged;
    });

    const outputDir = path.dirname(filePath);

    // 使用画像のみimagesディレクトリにコピー
    const usedRefs = new Set();
    pages.forEach((page) => {
      (page.blocks || []).forEach((block) => {
        if (block.type === 'image' && block.data.imageRef) {
          usedRefs.add(block.data.imageRef);
        }
      });
    });

    if (usedRefs.size > 0) {
      const imgDir = path.join(outputDir, 'images');
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
      for (const ref of usedRefs) {
        const entry = this._imagePool.get(ref);
        if (entry) {
          fs.writeFileSync(path.join(imgDir, `${ref}.${entry.ext}`), entry.buffer);
        }
      }
    }

    // 全ページを1つのHTMLにまとめて出力
    const docTitle = doc.meta?.title || '技術ポートフォリオ';
    const html = buildSingleHtml({ pages, tagMap, docTitle, imagePool: this._imagePool });
    fs.writeFileSync(filePath, html, 'utf-8');

    return { pageCount: pages.length, outputDir };
  }

  // --- .ptf マージ取り込み ---

  async mergeFromPtf(filePath) {
    if (!this._doc) throw new Error('ドキュメントが存在しません');

    const data = fs.readFileSync(filePath);
    const zip = new AdmZip(data);

    const docEntry = zip.getEntry('document.json');
    if (!docEntry) throw new Error('document.json が見つかりません');

    const raw = JSON.parse(docEntry.getData().toString('utf-8'));
    const srcDoc = migrate(raw);

    const srcPool = new ImagePool();
    srcPool.loadFromZip(zip);

    // 画像プールをハッシュでマージ（同一refは上書きしない）
    for (const [ref, entry] of srcPool._pool) {
      if (!this._imagePool.has(ref)) {
        this._imagePool._pool.set(ref, entry);
      }
    }

    // タグをマスタへマージ（未登録のみ追加）
    const existingTags = new Set(this._doc.tags || []);
    (srcDoc.tags || []).forEach((tag) => {
      if (!existingTags.has(tag)) {
        this._doc.tags.push(tag);
        existingTags.add(tag);
      }
    });

    // ページIDの衝突を回避して追加
    const existingIds = new Set(this._doc.pages.map((p) => p.id));
    const baseOrder = this._doc.pages.length;

    const addedPages = [];
    (srcDoc.pages || []).forEach((page) => {
      let newId = page.id;
      if (existingIds.has(newId)) {
        newId = `${page.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }
      existingIds.add(newId);

      const newPage = {
        ...page,
        id: newId,
        order: baseOrder + page.order,
      };
      this._doc.pages.push(newPage);
      addedPages.push(newPage);
    });

    this._dirty = true;
    return { addedPages: addedPages.length, addedTags: srcDoc.tags?.length || 0 };
  }

  async save(filePath) {
    if (!this._doc) throw new Error('ドキュメントが存在しません');

    const doc = JSON.parse(JSON.stringify(this._doc));
    doc.meta.updatedAt = new Date().toISOString();

    const zip = new AdmZip();
    zip.addFile('document.json', Buffer.from(JSON.stringify(doc, null, 2), 'utf-8'));
    this._imagePool.writeToZip(zip);

    fs.writeFileSync(filePath, zip.toBuffer());
    this.currentPath = filePath;
    this._dirty = false;
  }
}

// --- HTMLビルダーヘルパー ---

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _safeFilename(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildSingleHtml({ pages, tagMap, docTitle, imagePool }) {
  // サイドナビ（アンカーリンク）
  const tagNames = Object.keys(tagMap);
  let tocHtml = '';
  if (tagNames.length > 0) {
    tagNames.forEach((tag) => {
      const tagged = tagMap[tag];
      tocHtml += `<li class="toc-tag-header">${_esc(tag)}</li>`;
      tagged.forEach((p) => {
        tocHtml += `<li><a href="#${_esc(p.id)}">${_esc(p.title)}</a></li>`;
      });
    });
    const untagged = pages.filter((p) => p.tags.length === 0);
    if (untagged.length > 0) {
      tocHtml += `<li class="toc-tag-header">（未分類）</li>`;
      untagged.forEach((p) => {
        tocHtml += `<li><a href="#${_esc(p.id)}">${_esc(p.title)}</a></li>`;
      });
    }
  } else {
    pages.forEach((p) => {
      tocHtml += `<li><a href="#${_esc(p.id)}">${_esc(p.title)}</a></li>`;
    });
  }

  // 各ページのコンテンツセクション
  const sectionsHtml = pages.map((page) => {
    const blocksHtml = (page.blocks || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((block) => {
        if (block.type === 'text') {
          return `<div class="block block-text">${block.data.content || ''}</div>`;
        } else if (block.type === 'image') {
          const ref = block.data.imageRef || '';
          const entry = ref ? imagePool.get(ref) : null;
          const imgTag = entry
            ? `<img src="images/${ref}.${entry.ext}" alt="${_esc(block.data.alt || '')}">`
            : '<div class="img-placeholder">（画像なし）</div>';
          const caption = block.data.caption
            ? `<p class="caption">${_esc(block.data.caption)}</p>`
            : '';
          return `<div class="block block-image">${imgTag}${caption}</div>`;
        }
        return '';
      })
      .join('\n');

    const pageTags = (page.tags || [])
      .map((t) => `<span class="tag">${_esc(t)}</span>`)
      .join('');

    return `<section class="page-section" id="${_esc(page.id)}">
  <h2 class="page-title">${_esc(page.title)}</h2>
  <div class="page-tags">${pageTags}</div>
  ${blocksHtml}
</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(docTitle)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+JP:wght@400;500;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg-base:#0d1117;--bg-surface:#161b22;--bg-elevated:#1c2128;--bg-card:#21262d;
  --border-subtle:#30363d;--border-default:#444c56;
  --text-primary:#e6edf3;--text-secondary:#8b949e;--text-muted:#484f58;
  --accent:#58a6ff;--accent-muted:#1f3a5f;
  --font-ui:'JetBrains Mono','Cascadia Code','Consolas',monospace;
  --font-jp:'Noto Sans JP','Yu Gothic UI','Meiryo',system-ui,sans-serif;
}
body{font-family:var(--font-jp);font-size:15px;color:var(--text-primary);background:var(--bg-surface);display:flex;min-height:100vh}
nav{width:220px;min-width:180px;background:var(--bg-elevated);color:var(--text-primary);padding:16px 0;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;border-right:1px solid var(--border-subtle)}
nav h1{font-size:13px;font-family:var(--font-ui);color:var(--text-secondary);padding:0 16px 12px;border-bottom:1px solid var(--border-subtle);word-break:break-all}
nav ul{list-style:none;padding:8px 0}
nav ul li a{display:block;padding:6px 16px;color:var(--text-secondary);text-decoration:none;font-size:13px;font-family:var(--font-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:3px solid transparent;transition:background .12s,color .12s}
nav ul li a:hover{background:var(--bg-card);color:var(--text-primary);border-left-color:var(--accent)}
.toc-tag-header{font-size:10px;color:var(--text-muted);font-family:var(--font-ui);padding:10px 16px 2px;letter-spacing:.05em}
.content{flex:1;padding:32px 24px;max-width:860px}
.page-section{margin-bottom:48px;padding-bottom:40px;border-bottom:1px solid var(--border-subtle)}
.page-section:last-child{border-bottom:none}
h2.page-title{font-size:22px;font-weight:700;color:var(--text-primary);font-family:var(--font-jp);margin-bottom:8px}
.page-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px}
.tag{background:var(--accent-muted);color:var(--accent);padding:2px 10px;border-radius:12px;font-size:12px;border:1px solid var(--accent)}
.block{margin-bottom:24px}
.block-text{line-height:1.8;color:var(--text-primary);background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:6px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.block-image{text-align:center}
.block-image img{max-width:100%;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.4)}
.caption{margin-top:6px;font-size:12px;color:var(--text-secondary)}
.img-placeholder{background:var(--bg-elevated);border:2px dashed var(--border-default);border-radius:6px;padding:32px;color:var(--text-muted);font-size:13px;text-align:center}
</style>
</head>
<body>
<nav>
  <h1>${_esc(docTitle)}</h1>
  <ul>${tocHtml}</ul>
</nav>
<div class="content">
${sectionsHtml}
</div>
</body>
</html>`;
}

module.exports = PtfManager;
