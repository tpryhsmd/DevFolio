const crypto = require('crypto');

class ImagePool {
  constructor() {
    // ref (sha256) -> Buffer
    this._pool = new Map();
  }

  // バッファから画像を追加。重複は排除してrefを返す
  add(buffer, ext) {
    const ref = crypto.createHash('sha256').update(buffer).digest('hex');
    if (!this._pool.has(ref)) {
      this._pool.set(ref, { buffer, ext: ext.toLowerCase().replace(/^\./, '') });
    }
    return ref;
  }

  get(ref) {
    return this._pool.get(ref) || null;
  }

  has(ref) {
    return this._pool.has(ref);
  }

  // ZIP内のimages/から全画像をロード
  loadFromZip(zip) {
    this._pool.clear();
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (!entry.entryName.startsWith('images/') || entry.isDirectory) continue;
      const name = entry.entryName.replace('images/', '');
      const dotIdx = name.lastIndexOf('.');
      if (dotIdx === -1) continue;
      const ref = name.slice(0, dotIdx);
      const ext = name.slice(dotIdx + 1);
      this._pool.set(ref, { buffer: entry.getData(), ext });
    }
  }

  // 現在プールにある画像をZIPに書き込む
  writeToZip(zip) {
    for (const [ref, { buffer, ext }] of this._pool) {
      zip.addFile(`images/${ref}.${ext}`, buffer);
    }
  }

  // 使用中のrefセットと照合して未使用画像を返す（GC候補）
  getUnused(usedRefs) {
    const unused = [];
    for (const ref of this._pool.keys()) {
      if (!usedRefs.has(ref)) unused.push(ref);
    }
    return unused;
  }
}

module.exports = ImagePool;
