let _doc = null;
let _currentPageId = null;
let _activeTagFilter = null;
let _sortable = null;

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
  render();
});

window.api.onMenuUndo(() => console.log('undo（Phase 3で実装）'));
window.api.onMenuRedo(() => console.log('redo（Phase 3で実装）'));

// --- ツールバーボタン ---

document.getElementById('btn-save').addEventListener('click', () => window.api.save());
document.getElementById('btn-new-page').addEventListener('click', addPage);
document.getElementById('btn-add-text').addEventListener('click', () => addBlock('text'));
document.getElementById('btn-add-image').addEventListener('click', pickImageAndAddBlock);

// --- ページ操作 ---

function addPage() {
  const title = prompt('ページタイトルを入力してください', '新しいページ');
  if (title === null) return;
  const trimmed = title.trim() || '新しいページ';
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
  page.blocks = page.blocks.filter((b) => b.id !== blockId);
  reorderBlocks(page);
  saveDoc();
  renderCanvas();
}

function reorderBlocks(page) {
  page.blocks.forEach((b, i) => { b.order = i; });
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
    return;
  }

  emptyState.style.display = 'none';
  blockList.style.display = 'flex';
  titleDisplay.textContent = page.title;

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
      // DOM順を正本にする
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
