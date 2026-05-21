const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const PtfManager = require('./ptf/ptf-manager');

let mainWindow = null;
let ptfManager = new PtfManager();
let _autoSaveTimer = null;

// ダブルクリック起動時のファイルパス（Windows）
let _pendingOpenPath = null;

// --- 最後に開いたファイルの永続化 ---

function getLastOpenedPath() {
  try {
    const configPath = path.join(app.getPath('userData'), 'last-opened.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const { filePath } = JSON.parse(raw);
    return typeof filePath === 'string' && fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

function saveLastOpenedPath(filePath) {
  try {
    const configPath = path.join(app.getPath('userData'), 'last-opened.json');
    fs.writeFileSync(configPath, JSON.stringify({ filePath }), 'utf-8');
  } catch {
    // 書き込み失敗は無視
  }
}

// --- ウィンドウ作成 ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    if (_pendingOpenPath) {
      // ファイル関連付けで起動したときは優先して読み込む
      const fp = _pendingOpenPath;
      _pendingOpenPath = null;
      handleOpenPath(fp);
    } else {
      // 前回開いていたファイルを自動読み込み
      const lastPath = getLastOpenedPath();
      if (lastPath) handleOpenPath(lastPath);
    }
  });

  mainWindow.on('close', async (e) => {
    if (ptfManager.isDirty()) {
      e.preventDefault();
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['保存して終了', '保存せず終了', 'キャンセル'],
        defaultId: 0,
        cancelId: 2,
        message: '保存されていない変更があります。',
      });
      if (response === 0) {
        await handleSave();
        mainWindow.destroy();
      } else if (response === 1) {
        mainWindow.destroy();
      }
    }
  });

  buildMenu();
  startAutoSave();
}

// --- 自動保存（60秒ごと、保存済みパスがある場合のみ） ---

function startAutoSave() {
  if (_autoSaveTimer) clearInterval(_autoSaveTimer);
  _autoSaveTimer = setInterval(async () => {
    if (ptfManager.isDirty() && ptfManager.currentPath) {
      try {
        await ptfManager.save(ptfManager.currentPath);
      } catch (_) {
        // 自動保存エラーは無視（次回に再試行）
      }
    }
  }, 60_000);
}

// --- メニュー ---

function buildMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [
        { label: '新規作成', accelerator: 'CmdOrCtrl+N', click: () => handleNew() },
        { label: '開く...', accelerator: 'CmdOrCtrl+O', click: () => handleOpen() },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => handleSave() },
        { label: '名前を付けて保存...', accelerator: 'CmdOrCtrl+Shift+S', click: () => handleSaveAs() },
        { type: 'separator' },
        { label: 'HTMLとして書き出し...', click: () => handleExportHtml() },
        { label: '.ptf を取り込む...', click: () => handleMergePtf() },
        { type: 'separator' },
        { role: 'quit', label: '終了' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '元に戻す', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow?.webContents.send('menu:undo') },
        { label: 'やり直す', accelerator: 'CmdOrCtrl+Y', click: () => mainWindow?.webContents.send('menu:redo') },
      ],
    },
    {
      label: '表示',
      submenu: [
        { role: 'reload', label: '再読み込み' },
        { role: 'toggleDevTools', label: '開発者ツール' },
        { type: 'separator' },
        { role: 'resetZoom', label: '表示倍率をリセット' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'フルスクリーン' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- ファイル操作 ---

async function handleNew() {
  if (ptfManager.isDirty()) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['保存', '破棄', 'キャンセル'],
      defaultId: 0,
      cancelId: 2,
      message: '保存されていない変更があります。',
    });
    if (response === 2) return;
    if (response === 0) await handleSave();
  }
  ptfManager.createNew();
  mainWindow.setTitle('技術ポートフォリオ — 新規');
  mainWindow.webContents.send('ptf:loaded', ptfManager.getDocument());
}

async function handleOpen() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Portfolio Files', extensions: ['ptf'] }],
    properties: ['openFile'],
  });
  if (canceled) return;
  await handleOpenPath(filePaths[0]);
}

async function handleOpenPath(filePath) {
  try {
    await ptfManager.load(filePath);
    mainWindow.webContents.send('ptf:loaded', ptfManager.getDocument());
    mainWindow.setTitle(`技術ポートフォリオ — ${path.basename(filePath)}`);
    saveLastOpenedPath(filePath);
  } catch (err) {
    dialog.showErrorBox('読み込みエラー', err.message);
  }
}

async function handleSave() {
  if (!ptfManager.currentPath) return handleSaveAs();
  try {
    await ptfManager.save(ptfManager.currentPath);
  } catch (err) {
    dialog.showErrorBox('保存エラー', err.message);
  }
}

async function handleSaveAs() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Portfolio Files', extensions: ['ptf'] }],
    defaultPath: 'portfolio.ptf',
  });
  if (canceled) return;
  try {
    await ptfManager.save(filePath);
    mainWindow.setTitle(`技術ポートフォリオ — ${path.basename(filePath)}`);
    saveLastOpenedPath(filePath);
  } catch (err) {
    dialog.showErrorBox('保存エラー', err.message);
  }
}

async function handleExportHtml(pageIds) {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'HTML書き出し先フォルダを選択',
    buttonLabel: 'このフォルダに書き出す',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths?.[0]) return;
  try {
    const result = ptfManager.exportHtml(filePaths[0], pageIds);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['フォルダを開く', '閉じる'],
      defaultId: 0,
      message: `書き出し完了`,
      detail: `${result.pageCount}ページを書き出しました。\n${result.outputDir}`,
    });
    if (response === 0) shell.openPath(result.outputDir);
  } catch (err) {
    dialog.showErrorBox('書き出しエラー', err.message);
  }
}

async function handleMergePtf() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '取り込む .ptf ファイルを選択',
    filters: [{ name: 'Portfolio Files', extensions: ['ptf'] }],
    properties: ['openFile'],
  });
  if (canceled) return;
  try {
    const result = await ptfManager.mergeFromPtf(filePaths[0]);
    mainWindow.webContents.send('ptf:loaded', ptfManager.getDocument());
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: '取り込み完了',
      detail: `${result.addedPages}ページを追加しました。`,
    });
  } catch (err) {
    dialog.showErrorBox('取り込みエラー', err.message);
  }
}

// --- app ライフサイクル ---

// Windowsのファイル関連付け：起動引数からパスを取得
const openArg = process.argv.find((a) => a.endsWith('.ptf') && !a.startsWith('-'));
if (openArg) _pendingOpenPath = openArg;

app.whenReady().then(() => {
  ipcMain.handle('ptf:new', () => handleNew());
  ipcMain.handle('ptf:open', () => handleOpen());
  ipcMain.handle('ptf:save', () => handleSave());
  ipcMain.handle('ptf:saveAs', () => handleSaveAs());

  ipcMain.handle('ptf:getDocument', () => ptfManager.getDocument());

  ipcMain.handle('ptf:updateDocument', (_, doc) => {
    ptfManager.updateDocument(doc);
  });

  ipcMain.handle('ptf:addImage', async (_, arrayBuffer, ext) => {
    return ptfManager.addImage(Buffer.from(arrayBuffer), ext);
  });

  ipcMain.handle('ptf:getImage', (_, ref) => {
    const buf = ptfManager.getImage(ref);
    return buf ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null;
  });

  ipcMain.handle('ptf:saveSnapshot', (_, label) => {
    ptfManager.saveSnapshot(label);
  });

  ipcMain.handle('ptf:restoreSnapshot', (_, snapshotId) => {
    ptfManager.restoreSnapshot(snapshotId);
    return ptfManager.getDocument();
  });

  ipcMain.handle('ptf:deleteSnapshot', (_, snapshotId) => {
    ptfManager.deleteSnapshot(snapshotId);
  });

  // Phase 4のIPC（メニューからも呼べるようUIからも残す）
  ipcMain.handle('ptf:exportHtml', (_, pageIds) => handleExportHtml(pageIds));
  ipcMain.handle('ptf:mergeFromPtf', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '取り込む .ptf ファイルを選択',
      filters: [{ name: 'Portfolio Files', extensions: ['ptf'] }],
      properties: ['openFile'],
    });
    if (canceled) return null;
    try {
      const result = await ptfManager.mergeFromPtf(filePaths[0]);
      return { ...result, doc: ptfManager.getDocument() };
    } catch (err) {
      dialog.showErrorBox('取り込みエラー', err.message);
      return null;
    }
  });

  createWindow();
});

// macOS: open-file イベント（ファイル関連付けダブルクリック）
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (mainWindow) {
    handleOpenPath(filePath);
  } else {
    _pendingOpenPath = filePath;
  }
});

app.on('window-all-closed', () => {
  if (_autoSaveTimer) clearInterval(_autoSaveTimer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
