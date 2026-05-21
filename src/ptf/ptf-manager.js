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

  exportHtml(outputDir) {
    if (!this._doc) throw new Error('ドキュメントが存在しません');

    const doc = this._doc;
    const pages = (doc.pages || []).slice().sort((a, b) => a.order - b.order);

    // タグ別インデックスを構築
    const tagMap = {};
    (doc.tags || []).forEach((tag) => {
      tagMap[tag] = pages.filter((p) => p.tags.includes(tag));
    });

    // 画像はoutputDir/imagesにコピー
    const imgDir = path.join(outputDir, 'images');
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    for (const [ref, { buffer, ext }] of this._imagePool._pool) {
      fs.writeFileSync(path.join(imgDir, `${ref}.${ext}`), buffer);
    }

    // ページHTMLを生成
    pages.forEach((page) => {
      const blocksHtml = (page.blocks || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((block) => {
          if (block.type === 'text') {
            return `<div class="block block-text">${block.data.content || ''}</div>`;
          } else if (block.type === 'image') {
            const ref = block.data.imageRef || '';
            const entry = ref ? this._imagePool.get(ref) : null;
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

      const html = buildPageHtml({
        title: page.title,
        tags: pageTags,
        blocks: blocksHtml,
        tocPages: pages,
        tagMap,
        docTitle: doc.meta?.title || '技術ポートフォリオ',
        currentPageId: page.id,
      });

      const filename = `${_safeFilename(page.id)}.html`;
      fs.writeFileSync(path.join(outputDir, filename), html, 'utf-8');
    });

    // インデックスページ（page[0]へリダイレクト or 一覧）
    const indexHtml = buildIndexHtml(pages, doc.meta?.title || '技術ポートフォリオ');
    fs.writeFileSync(path.join(outputDir, 'index.html'), indexHtml, 'utf-8');

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

function buildTocHtml(pages, tagMap, currentPageId) {
  let html = '';
  const tagNames = Object.keys(tagMap);

  // タグ別セクション
  if (tagNames.length > 0) {
    tagNames.forEach((tag) => {
      const tagged = tagMap[tag];
      if (tagged.length === 0) return;
      html += `<li class="toc-tag-header">${_esc(tag)}</li>`;
      tagged.forEach((p) => {
        const active = p.id === currentPageId ? ' class="toc-active"' : '';
        html += `<li><a href="${_safeFilename(p.id)}.html"${active}>${_esc(p.title)}</a></li>`;
      });
    });

    // タグなしページ
    const untagged = pages.filter((p) => p.tags.length === 0);
    if (untagged.length > 0) {
      html += `<li class="toc-tag-header">（未分類）</li>`;
      untagged.forEach((p) => {
        const active = p.id === currentPageId ? ' class="toc-active"' : '';
        html += `<li><a href="${_safeFilename(p.id)}.html"${active}>${_esc(p.title)}</a></li>`;
      });
    }
  } else {
    pages.forEach((p) => {
      const active = p.id === currentPageId ? ' class="toc-active"' : '';
      html += `<li><a href="${_safeFilename(p.id)}.html"${active}>${_esc(p.title)}</a></li>`;
    });
  }

  return html;
}

function buildPageHtml({ title, tags, blocks, tocPages, tagMap, docTitle, currentPageId }) {
  const toc = buildTocHtml(tocPages, tagMap, currentPageId);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(title)} — ${_esc(docTitle)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Meiryo','Segoe UI',sans-serif;font-size:15px;color:#333;background:#f5f5f5;display:flex;min-height:100vh}
nav{width:220px;min-width:180px;background:#2c2c2c;color:#ddd;padding:16px 0;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto}
nav h1{font-size:13px;color:#aaa;padding:0 16px 12px;border-bottom:1px solid #444;word-break:break-all}
nav ul{list-style:none;padding:8px 0}
nav ul li a{display:block;padding:6px 16px;color:#bbb;text-decoration:none;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav ul li a:hover{background:#3a3a3a;color:#fff}
nav ul li a.toc-active{background:#3a3a3a;border-left:3px solid #4a90d9;color:#fff}
.toc-tag-header{font-size:10px;color:#666;padding:10px 16px 2px;text-transform:uppercase;letter-spacing:.05em}
main{flex:1;padding:32px 24px;max-width:860px}
h2.page-title{font-size:22px;font-weight:bold;color:#222;margin-bottom:8px}
.page-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px}
.tag{background:#e8e8e8;color:#666;padding:2px 10px;border-radius:12px;font-size:12px}
.block{margin-bottom:24px}
.block-text{line-height:1.8;background:#fff;border-radius:6px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.block-image{text-align:center}
.block-image img{max-width:100%;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
.caption{margin-top:6px;font-size:12px;color:#777}
.img-placeholder{background:#f0f0f0;border:2px dashed #ccc;border-radius:4px;padding:32px;color:#aaa;font-size:13px}
</style>
</head>
<body>
<nav>
  <h1>${_esc(docTitle)}</h1>
  <ul>${toc}</ul>
</nav>
<main>
  <h2 class="page-title">${_esc(title)}</h2>
  <div class="page-tags">${tags}</div>
  ${blocks}
</main>
</body>
</html>`;
}

function buildIndexHtml(pages, docTitle) {
  const links = pages
    .map((p) => `<li><a href="${_safeFilename(p.id)}.html">${_esc(p.title)}</a></li>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=${pages.length ? _safeFilename(pages[0].id) + '.html' : ''}">
<title>${_esc(docTitle)}</title>
</head>
<body>
<ul>${links}</ul>
</body>
</html>`;
}

module.exports = PtfManager;
