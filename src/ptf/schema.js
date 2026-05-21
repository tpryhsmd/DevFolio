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

// バージョンごとの移行ステップを順番に適用する。
// 新バージョン追加時は MIGRATIONS に追加するだけでよい。
const MIGRATIONS = [
  // 例: { from: '1.0', to: '1.1', fn: (doc) => { doc.newField = default; return doc; } }
];

function migrate(doc) {
  if (!doc.version) throw new Error('versionフィールドがありません');

  let current = doc;
  for (const step of MIGRATIONS) {
    if (current.version === step.from) {
      current = step.fn(JSON.parse(JSON.stringify(current)));
      current.version = step.to;
    }
  }

  if (current.version !== CURRENT_VERSION) {
    throw new Error(`未対応のファイルバージョン: ${current.version}（現在の対応バージョン: ${CURRENT_VERSION}）`);
  }

  return current;
}

function validate(doc) {
  if (!doc.version) throw new Error('versionフィールドがありません');
  if (!Array.isArray(doc.pages)) throw new Error('pagesフィールドが不正です');
  if (!Array.isArray(doc.tags)) throw new Error('tagsフィールドが不正です');
  if (!doc.meta || typeof doc.meta !== 'object') throw new Error('metaフィールドが不正です');

  // ページの最低限の整合性
  for (const page of doc.pages) {
    if (!page.id || typeof page.id !== 'string') throw new Error(`ページIDが不正です: ${JSON.stringify(page.id)}`);
    if (!Array.isArray(page.blocks)) throw new Error(`page "${page.id}" のblocksが不正です`);
    if (!Array.isArray(page.tags)) throw new Error(`page "${page.id}" のtagsが不正です`);
  }
}

module.exports = { createEmptyDocument, migrate, validate, CURRENT_VERSION };
