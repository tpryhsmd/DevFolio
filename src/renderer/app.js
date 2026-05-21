let _doc = null;
let _currentPageId = null;
let _activeTagFilter = null;
let _sortable = null;

// --- CommandManager（Undo/Redo） ---

const UNDO_LIMIT = 50;

const _undoStack = [];
const _redoStack = [];

function pushUndo(prevDoc) {
  _undoStack.push(JSON.parse(JSON.stringify(prevDoc)));
  if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
  _redoStack.length = 0;
  updateUndoRedoBtns();
}

function undo() {
  if (!_undoStack.length) return;
  _redoStack.push(JSON.parse(JSON.stringify(_doc)));
  _doc = _undoStack.pop();
  saveDoc();
  render();
  updateUndoRedoBtns();
}

function redo() {
  if (!_redoStack.length) return;
  _undoStack.push(JSON.parse(JSON.stringify(_doc)));
  _doc = _redoStack.pop();
  saveDoc();
  render();
  updateUndoRedoBtns();
}

function updateUndoRedoBtns() {
  document.getElementById('btn-undo').disabled = _undoStack.length === 0;
  document.getElementById('btn-redo').disabled = _redoStack.length === 0;
}

// --- 起動 ---

(async () => {
  _doc = await window.api.getDocument();
  if (!_doc) {
    await window.api.newFile();
    _doc = await window.api.getDocument();
  }
  render();
})();

// --- IPCイベント ---

window.api.onPtfLoaded((doc) => {
  _doc = doc;
  _currentPageId = null;
  _activeTagFilter = null;
  _undoStack.length = 0;
  _redoStack.length = 0;
  updateUndoRedoBtns();
  render();
});

window.api.onMenuUndo(() => undo());
window.api.onMenuRedo(() => redo());

// --- ツールバーボタン ---

document.getElementById('btn-save').addEventListener('click', () => window.api.save());
document.getElementById('btn-new-page').addEventListener('click', addPage);
document.getElementById('btn-add-text').addEventListener('click', () => addBlock('text'));
document.getElementById('btn-add-image').addEventListener('click', pickImageAndAddBlock);
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);
document.getElementById('btn-history').addEventListener('click', openHistoryModal);
document.getElementById('btn-export-html').addEventListener('click', exportHtml);
document.getElementById('btn-merge-ptf').addEventListener('click', mergeFromPtf);
document.getElementById('history-modal-close').addEventListener('click', closeHistoryModal);
document.getElementById('history-modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeHistoryModal(); });
document.getElementById('btn-save-snapshot').addEventListener('click', saveSnapshot);
document.getElementById('snapshot-label-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveSnapshot(); });
document.getElementById('btn-manage-tags').addEventListener('click', openTagModal);
document.getElementById('modal-close').addEventListener('click', closeTagModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTagModal(); });
document.getElementById('btn-add-tag').addEventListener('click', addTagFromInput);
document.getElementById('new-tag-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTagFromInput(); });

// --- ページ操作 ---

function addPage() {
  const title = prompt('ページタイトルを入力してください', '新しいページ');
  if (title === null) return;
  const trimmed = title.trim() || '新しいページ';
  pushUndo(_doc);
  const page = {
    id: `page-${Date.now()}`,
    title: trimmed,
    order: _doc.pages.length,
    tags: [],
    blocks: [],
  };
  _doc.pages.push(page);
  _currentPageId = page.id;
  saveDoc();
  render();
}

function deletePage(pageId) {
  if (!confirm('このページを削除しますか？')) return;
  pushUndo(_doc);
  _doc.pages = _doc.pages.filter((p) => p.id !== pageId);
  if (_currentPageId === pageId) _currentPageId = _doc.pages[0]?.id || null;
  saveDoc();
  render();
}

function renamePage(pageId) {
  const page = _doc.pages.find((p) => p.id === pageId);
  if (!page) return;
  const newTitle = prompt('ページ名を変更', page.title);
  if (newTitle === null) return;
  pushUndo(_doc);
  page.title = newTitle.trim() || page.title;
  saveDoc();
  renderSidebar();
  const titleDisplay = document.getElementById('page-title-display');
  if (titleDisplay && _currentPageId === pageId) titleDisplay.textContent = page.title;
}

function selectPage(pageId) {
  _currentPageId = pageId;
  renderCanvas();
  renderSidebar();
}

// --- ブロック操作 ---

function addBlock(type) {
  const page = currentPage();
  if (!page) return alert('ページを選択してください');
  pushUndo(_doc);
  const block = {
    id: `block-${Date.now()}`,
    type,
    order: page.blocks.length,
    data: type === 'text'
      ? { content: '<p>テキストを入力してください</p>' }
      : { imageRef: '', alt: '', caption: '' },
  };
  page.blocks.push(block);
  saveDoc();
  renderCanvas();
}

async function pickImageAndAddBlock() {
  const page = currentPage();
  if (!page) return alert('ページを選択してください');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const buf = await file.arrayBuffer();
    const ref = await window.api.addImage(buf, ext);
    const block = {
      id: `block-${Date.now()}`,
      type: 'image',
      order: page.blocks.length,
      data: { imageRef: ref, alt: file.name, caption: '' },
    };
    page.blocks.push(block);
    saveDoc();
    renderCanvas();
  };
  input.click();
}

function deleteBlock(blockId) {
  const page = currentPage();
  if (!page) return;
  pushUndo(_doc);
  page.blocks = page.blocks.filter((b) => b.id !== blockId);
  reorderBlocks(page);
  saveDoc();
  renderCanvas();
}

function reorderBlocks(page) {
  page.blocks.forEach((b, i) => { b.order = i; });
}

// --- バージョン履歴 ---

function openHistoryModal() {
  renderSnapshotList();
  document.getElementById('history-modal-overlay').style.display = 'flex';
}

function closeHistoryModal() {
  document.getElementById('history-modal-overlay').style.display = 'none';
  document.getElementById('snapshot-label-input').value = '';
}

async function saveSnapshot() {
  const input = document.getElementById('snapshot-label-input');
  const label = input.value.trim() || new Date().toLocaleString('ja-JP');
  await window.api.saveSnapshot(label);
  input.value = '';
  // ドキュメントを再取得（historyが更新された）
  _doc = await window.api.getDocument();
  renderSnapshotList();
}

function renderSnapshotList() {
  const container = document.getElementById('snapshot-list');
  container.innerHTML = '';
  const history = _doc?.history || [];
  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'snapshot-empty';
    empty.textContent = 'スナップショットがありません';
    container.appendChild(empty);
    return;
  }
  history.forEach((snap) => {
    const row = document.createElement('div');
    row.className = 'snapshot-row';

    const info = document.createElement('div');
    info.className = 'snapshot-info';

    const label = document.createElement('span');
    label.className = 'snapshot-label';
    label.textContent = snap.label;

    const date = document.createElement('span');
    date.className = 'snapshot-date';
    date.textContent = new Date(snap.savedAt).toLocaleString('ja-JP');

    const pages = document.createElement('span');
    pages.className = 'snapshot-pages';
    pages.textContent = `${snap.pagesSnapshot.length}ページ`;

    info.appendChild(label);
    info.appendChild(date);
    info.appendChild(pages);

    const btns = document.createElement('div');
    btns.className = 'snapshot-btns';

    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = '復元';
    restoreBtn.className = 'snapshot-restore-btn';
    restoreBtn.onclick = async () => {
      if (!confirm(`「${snap.label}」の状態に復元しますか？\n現在の編集内容は失われます。`)) return;
      const restoredDoc = await window.api.restoreSnapshot(snap.snapshotId);
      _doc = restoredDoc;
      // 復元時はundo/redoスタックをクリア
      _undoStack.length = 0;
      _redoStack.length = 0;
      updateUndoRedoBtns();
      _currentPageId = _doc.pages[0]?.id || null;
      closeHistoryModal();
      render();
    };

    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.className = 'snapshot-del-btn';
    delBtn.onclick = async () => {
      if (!confirm(`スナップショット「${snap.label}」を削除しますか？`)) return;
      await window.api.deleteSnapshot(snap.snapshotId);
      _doc = await window.api.getDocument();
      renderSnapshotList();
    };

    btns.appendChild(restoreBtn);
    btns.appendChild(delBtn);
    row.appendChild(info);
    row.appendChild(btns);
    container.appendChild(row);
  });
}

// --- タグ管理 ---

function openTagModal() {
  renderTagMasterList();
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('new-tag-input').focus();
}

function closeTagModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('new-tag-input').value = '';
}

function addTagFromInput() {
  const input = document.getElementById('new-tag-input');
  const name = input.value.trim();
  if (!name) return;
  if (_doc.tags.includes(name)) {
    input.select();
    return;
  }
  pushUndo(_doc);
  _doc.tags.push(name);
  input.value = '';
  saveDoc();
  renderTagMasterList();
  renderTagList();
}

function renameTag(oldName) {
  const newName = prompt('タグ名を変更', oldName);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;
  if (_doc.tags.includes(trimmed)) return alert('同名のタグが既に存在します');
  pushUndo(_doc);
  const idx = _doc.tags.indexOf(oldName);
  _doc.tags[idx] = trimmed;
  // 全ページへ伝播
  _doc.pages.forEach((p) => {
    const ti = p.tags.indexOf(oldName);
    if (ti !== -1) p.tags[ti] = trimmed;
  });
  if (_activeTagFilter === oldName) _activeTagFilter = trimmed;
  saveDoc();
  renderTagMasterList();
  renderTagList();
  renderPageList();
  renderPageHeader();
}

function deleteTag(name) {
  if (!confirm(`タグ「${name}」を削除しますか？\n全ページから除去されます。`)) return;
  pushUndo(_doc);
  _doc.tags = _doc.tags.filter((t) => t !== name);
  // 全ページへ伝播
  _doc.pages.forEach((p) => {
    p.tags = p.tags.filter((t) => t !== name);
  });
  if (_activeTagFilter === name) _activeTagFilter = null;
  saveDoc();
  renderTagMasterList();
  renderTagList();
  renderPageList();
  renderPageHeader();
}

function renderTagMasterList() {
  const container = document.getElementById('tag-master-list');
  container.innerHTML = '';
  if (_doc.tags.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tag-master-empty';
    empty.textContent = 'タグがありません';
    container.appendChild(empty);
    return;
  }
  _doc.tags.forEach((tag) => {
    const row = document.createElement('div');
    row.className = 'tag-master-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tag-master-name';
    nameSpan.textContent = tag;

    const usageCount = _doc.pages.filter((p) => p.tags.includes(tag)).length;
    const count = document.createElement('span');
    count.className = 'tag-master-count';
    count.textContent = `${usageCount}ページ`;

    const btns = document.createElement('div');
    btns.className = 'tag-master-btns';

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏';
    renameBtn.title = 'リネーム';
    renameBtn.onclick = () => renameTag(tag);

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = '削除';
    delBtn.className = 'tag-delete-btn';
    delBtn.onclick = () => deleteTag(tag);

    btns.appendChild(renameBtn);
    btns.appendChild(delBtn);
    row.appendChild(nameSpan);
    row.appendChild(count);
    row.appendChild(btns);
    container.appendChild(row);
  });
}

// --- ページタグ付与 ---

function togglePageTag(pageId, tag) {
  const page = _doc.pages.find((p) => p.id === pageId);
  if (!page) return;
  pushUndo(_doc);
  const idx = page.tags.indexOf(tag);
  if (idx === -1) {
    page.tags.push(tag);
  } else {
    page.tags.splice(idx, 1);
  }
  saveDoc();
  renderPageHeader();
  renderPageList();
}

function renderPageHeader() {
  const header = document.getElementById('page-header');
  const area = document.getElementById('page-tags-area');
  const page = currentPage();

  if (!page) {
    header.style.display = 'none';
    return;
  }
  header.style.display = 'block';
  area.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'page-tags-label';
  label.textContent = 'タグ：';
  area.appendChild(label);

  (_doc.tags || []).forEach((tag) => {
    const chip = document.createElement('span');
    const active = page.tags.includes(tag);
    chip.className = 'page-tag-chip' + (active ? ' active' : '');
    chip.textContent = tag;
    chip.title = active ? 'クリックで除去' : 'クリックで付与';
    chip.onclick = () => togglePageTag(page.id, tag);
    area.appendChild(chip);
  });

  if (_doc.tags.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'page-tags-hint';
    hint.textContent = '（⚙ タグ管理でタグを追加してください）';
    area.appendChild(hint);
  }
}

// --- 画像表示 ---

const _imgCache = new Map();

async function resolveImageSrc(ref) {
  if (_imgCache.has(ref)) return _imgCache.get(ref);
  const buf = await window.api.getImage(ref);
  if (!buf) return '';
  const arr = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  const src = `data:image/jpeg;base64,${btoa(binary)}`;
  _imgCache.set(ref, src);
  return src;
}

// --- HTML書き出し ---

async function exportHtml() {
  if (!_doc || _doc.pages.length === 0) {
    return alert('書き出すページがありません。');
  }
  const result = await window.api.exportHtml();
  if (result) {
    alert(`書き出し完了：${result.pageCount}ページ\n保存先：${result.outputDir}`);
  }
}

// --- .ptf マージ取り込み ---

async function mergeFromPtf() {
  const result = await window.api.mergeFromPtf();
  if (!result) return;
  pushUndo(_doc);
  _doc = result.doc;
  saveDoc();
  render();
  alert(`取り込み完了：${result.addedPages}ページを追加しました。`);
}

// --- 保存 ---

function saveDoc() {
  window.api.updateDocument(_doc);
}

// --- ヘルパー ---

function currentPage() {
  return _doc?.pages.find((p) => p.id === _currentPageId) || null;
}

function filteredPages() {
  if (!_activeTagFilter) return _doc?.pages || [];
  return (_doc?.pages || []).filter((p) => p.tags.includes(_activeTagFilter));
}

// --- レンダリング ---

function render() {
  renderSidebar();
  renderCanvas();
}

function renderSidebar() {
  renderTagList();
  renderPageList();
}

function renderTagList() {
  const container = document.getElementById('tag-list');
  container.innerHTML = '';
  (_doc?.tags || []).forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip' + (tag === _activeTagFilter ? ' active' : '');
    chip.textContent = tag;
    chip.onclick = () => {
      _activeTagFilter = tag === _activeTagFilter ? null : tag;
      renderSidebar();
    };
    container.appendChild(chip);
  });
}

function renderPageList() {
  const ul = document.getElementById('page-list');
  ul.innerHTML = '';
  const pages = filteredPages().slice().sort((a, b) => a.order - b.order);
  pages.forEach((page) => {
    const li = document.createElement('li');
    li.className = 'page-item' + (page.id === _currentPageId ? ' active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'page-name';
    nameSpan.textContent = page.title || '（無題）';
    nameSpan.title = page.title;
    nameSpan.onclick = () => selectPage(page.id);

    const actions = document.createElement('div');
    actions.className = 'page-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'page-action-btn';
    renameBtn.title = 'ページ名を変更';
    renameBtn.textContent = '✏';
    renameBtn.onclick = (e) => { e.stopPropagation(); renamePage(page.id); };

    const delBtn = document.createElement('button');
    delBtn.className = 'page-action-btn page-delete-btn';
    delBtn.title = 'ページを削除';
    delBtn.textContent = '✕';
    delBtn.onclick = (e) => { e.stopPropagation(); deletePage(page.id); };

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    li.appendChild(nameSpan);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

function renderCanvas() {
  const emptyState = document.getElementById('empty-state');
  const blockList = document.getElementById('block-list');
  const titleDisplay = document.getElementById('page-title-display');
  const page = currentPage();

  // SortableJS インスタンスを破棄
  if (_sortable) { _sortable.destroy(); _sortable = null; }

  if (!page) {
    emptyState.style.display = 'flex';
    blockList.style.display = 'none';
    titleDisplay.textContent = '';
    renderPageHeader();
    return;
  }

  emptyState.style.display = 'none';
  blockList.style.display = 'flex';
  titleDisplay.textContent = page.title;
  renderPageHeader();

  blockList.innerHTML = '';
  const blocks = page.blocks.slice().sort((a, b) => a.order - b.order);
  blocks.forEach((block) => {
    const li = createBlockElement(block, page);
    blockList.appendChild(li);
  });

  // SortableJS 初期化
  _sortable = new Sortable(blockList, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: (evt) => {
      if (evt.oldIndex === evt.newIndex) return;
      pushUndo(_doc);
      const ids = [...blockList.children].map((el) => el.dataset.blockId);
      ids.forEach((id, i) => {
        const b = page.blocks.find((b) => b.id === id);
        if (b) b.order = i;
      });
      saveDoc();
    },
  });
}

function createBlockElement(block, page) {
  const li = document.createElement('li');
  li.className = 'block-item';
  li.dataset.blockId = block.id;

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  li.appendChild(handle);

  const controls = document.createElement('div');
  controls.className = 'block-controls';
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-delete';
  delBtn.textContent = '削除';
  delBtn.onclick = () => deleteBlock(block.id);
  controls.appendChild(delBtn);
  li.appendChild(controls);

  if (block.type === 'text') {
    const content = document.createElement('div');
    content.className = 'text-block-content';
    content.contentEditable = 'true';
    // DOMPurifyでサニタイズしてからinnerHTML設定
    content.innerHTML = DOMPurify.sanitize(block.data.content || '');
    content.onblur = () => {
      block.data.content = DOMPurify.sanitize(content.innerHTML);
      saveDoc();
    };
    li.appendChild(content);
  } else if (block.type === 'image') {
    const wrapper = document.createElement('div');
    wrapper.className = 'image-block-content';

    if (block.data.imageRef) {
      const img = document.createElement('img');
      img.alt = block.data.alt || '';
      resolveImageSrc(block.data.imageRef).then((src) => { img.src = src; });
      wrapper.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'image-placeholder';
      placeholder.textContent = '画像なし';
      wrapper.appendChild(placeholder);
    }

    const altInput = document.createElement('input');
    altInput.className = 'image-alt-input';
    altInput.type = 'text';
    altInput.placeholder = 'Alt テキスト（任意）';
    altInput.value = block.data.alt || '';
    altInput.onblur = () => { block.data.alt = altInput.value; saveDoc(); };

    const caption = document.createElement('div');
    caption.className = 'image-caption';
    caption.contentEditable = 'true';
    caption.textContent = block.data.caption || '';
    caption.setAttribute('data-placeholder', 'キャプションを入力（任意）');
    caption.onblur = () => { block.data.caption = caption.textContent; saveDoc(); };

    wrapper.appendChild(altInput);
    wrapper.appendChild(caption);
    li.appendChild(wrapper);
  }

  return li;
}
