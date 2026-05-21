const AdmZip = require('adm-zip');
const fs = require('fs');
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

module.exports = PtfManager;
