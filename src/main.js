const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const PtfManager = require('./ptf/ptf-manager');

let mainWindow = null;
let ptfManager = new PtfManager();

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
}

function buildMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [
        { label: '新規作成', accelerator: 'CmdOrCtrl+N', click: () => handleNew() },
        { label: '開く...', accelerator: 'CmdOrCtrl+O', click: () => handleOpen() },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => handleSave() },
        { label: '名前を付けて保存...', accelerator: 'CmdOrCtrl+Shift+S', click: () => handleSaveAs() },
        { type: 'separator' },
        { role: 'quit', label: '終了' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '元に戻す', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow.webContents.send('menu:undo') },
        { label: 'やり直す', accelerator: 'CmdOrCtrl+Y', click: () => mainWindow.webContents.send('menu:redo') },
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
  mainWindow.webContents.send('ptf:loaded', ptfManager.getDocument());
}

async function handleOpen() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Portfolio Files', extensions: ['ptf'] }],
    properties: ['openFile'],
  });
  if (canceled) return;
  try {
    await ptfManager.load(filePaths[0]);
    mainWindow.webContents.send('ptf:loaded', ptfManager.getDocument());
    mainWindow.setTitle(`技術ポートフォリオ — ${path.basename(filePaths[0])}`);
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
  } catch (err) {
    dialog.showErrorBox('保存エラー', err.message);
  }
}

// --- app ライフサイクル ---

app.whenReady().then(() => {
  // IPC ハンドラはメインプロセス起動後に登録する
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

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
