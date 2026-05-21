const CURRENT_VERSION = '1.0';

function createEmptyDocument() {
  const now = new Date().toISOString();
  return {
    version: CURRENT_VERSION,
    meta: {
      title: '新しいポートフォリオ',
      company: '',
      createdAt: now,
      updatedAt: now,
    },
    tags: [],
    pages: [],
    history: [],
    exportSettings: { theme: 'default', includeToc: true },
  };
}

function migrate(doc) {
  // 将来のバージョンアップ時にここで移行処理を追加する
  if (doc.version === CURRENT_VERSION) return doc;
  throw new Error(`未対応のファイルバージョン: ${doc.version}`);
}

function validate(doc) {
  if (!doc.version) throw new Error('versionフィールドがありません');
  if (!Array.isArray(doc.pages)) throw new Error('pagesフィールドが不正です');
  if (!Array.isArray(doc.tags)) throw new Error('tagsフィールドが不正です');
}

module.exports = { createEmptyDocument, migrate, validate, CURRENT_VERSION };
