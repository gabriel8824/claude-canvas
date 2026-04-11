const { app, BrowserWindow, shell, Menu, nativeTheme, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVER_PORT = 3001;
const DEV_MODE    = !app.isPackaged;

let mainWindow    = null;
let loadingWindow = null;
let serverProc    = null;

// ─── macOS native menu ────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const mod   = isMac ? 'Cmd' : 'Ctrl';

  const template = [
    // macOS app menu
    ...(isMac ? [{
      label: 'Claude Canvas',
      submenu: [
        { label: 'About Claude Canvas', role: 'about' },
        { type: 'separator' },
        { label: 'Hide',        role: 'hide' },
        { label: 'Hide Others', role: 'hideOthers' },
        { type: 'separator' },
        { label: 'Quit', role: 'quit', accelerator: `${mod}+Q` },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo',       role: 'undo',      accelerator: `${mod}+Z` },
        { label: 'Redo',       role: 'redo',       accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y' },
        { type: 'separator' },
        { label: 'Cut',        role: 'cut',        accelerator: `${mod}+X` },
        { label: 'Copy',       role: 'copy',       accelerator: `${mod}+C` },
        { label: 'Paste',      role: 'paste',      accelerator: `${mod}+V` },
        { label: 'Select All', role: 'selectAll',  accelerator: `${mod}+A` },
        ...(!isMac ? [
          { type: 'separator' },
          { label: 'Quit', role: 'quit', accelerator: 'Ctrl+Q' },
        ] : []),
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload',       role: 'reload',      accelerator: `${mod}+R` },
        { label: 'Force Reload', role: 'forceReload', accelerator: `Shift+${mod}+R` },
        { type: 'separator' },
        { label: 'Actual Size', role: 'resetZoom', accelerator: `${mod}+0` },
        { label: 'Zoom In',     role: 'zoomIn',    accelerator: `${mod}+=` },
        { label: 'Zoom Out',    role: 'zoomOut',   accelerator: `${mod}+-` },
        { type: 'separator' },
        { label: 'Toggle Full Screen', role: 'togglefullscreen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11' },
        ...(DEV_MODE ? [
          { type: 'separator' },
          { label: 'Developer Tools', role: 'toggleDevTools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I' },
        ] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', role: 'minimize', accelerator: `${mod}+M` },
        { label: 'Zoom',     role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { label: 'Bring All to Front', role: 'front' },
        ] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Server management ────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve) => {
    if (DEV_MODE) {
      // Dev: spawn ts-node-dev como processo separado
      const cwd = path.join(__dirname, '..', 'server');
      serverProc = spawn('npm', ['run', 'dev'], {
        cwd, stdio: 'pipe', shell: true,
        env: { ...process.env },
      });
      serverProc.stdout?.on('data', d => process.stdout.write('[server] ' + d.toString()));
      serverProc.stderr?.on('data', d => process.stderr.write('[server] ' + d.toString()));
      serverProc.on('error', err => console.error('Server error:', err));
    } else {
      // Produção: carrega o servidor diretamente no processo do Electron via require().
      // Os módulos nativos (better-sqlite3, node-pty) são recompilados para o ABI
      // do Electron durante o build (electron:rebuild), portanto não há dependência
      // do Node.js do sistema — o app é completamente autocontido.
      try {
        require(path.join(process.resourcesPath, 'server', 'dist', 'bundle.js'));
      } catch (err) {
        console.error('Failed to load server module:', err);
        dialog.showErrorBox(
          'Claude Canvas — Erro ao iniciar',
          `O servidor não pôde ser carregado:\n\n${err.message}`
        );
        app.quit();
        return;
      }
    }

    // Aguarda o servidor responder (funciona tanto no modo spawn quanto in-process)
    const poll = setInterval(() => {
      const req = http.get(`http://localhost:${SERVER_PORT}/api/state`, res => {
        if (res.statusCode === 200) {
          clearInterval(poll);
          clearTimeout(startTimeout);
          resolve();
        }
      });
      req.on('error', () => {});
      req.setTimeout(800, () => req.destroy());
    }, 400);

    const startTimeout = setTimeout(() => {
      clearInterval(poll);
      dialog.showErrorBox(
        'Claude Canvas — Erro ao iniciar',
        'O servidor não respondeu em 30 segundos.\n\nVerifique os logs do aplicativo e tente novamente.'
      );
      app.quit();
    }, 30000);
  });
}

function stopServer() {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}

// ─── Loading window ───────────────────────────────────────────────────────────

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width:  340,
    height: 260,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  loadingWindow.loadFile(path.join(__dirname, 'loading.html'));
  loadingWindow.once('ready-to-show', () => loadingWindow?.show());
  loadingWindow.on('closed', () => { loadingWindow = null; });
}

function closeLoadingWindow() {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.close();
    loadingWindow = null;
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const isMac = process.platform === 'darwin';

  const windowConfig = {
    width:  1440,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
    icon: path.join(__dirname, 'icon.png'),
  };

  if (isMac) {
    Object.assign(windowConfig, {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
    });
  }

  mainWindow = new BrowserWindow(windowConfig);

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${SERVER_PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

nativeTheme.themeSource = 'dark';

app.on('ready', async () => {
  buildMenu();

  // macOS: set dock badge / icon
  if (process.platform === 'darwin') {
    app.dock?.setIcon(path.join(__dirname, 'icon.png'));
  }

  createLoadingWindow();

  console.log('Starting backend server…');
  await startServer();
  console.log('Server ready, opening window…');

  closeLoadingWindow();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { stopServer(); app.quit(); }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', () => stopServer());

// ─── Security ─────────────────────────────────────────────────────────────────

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${SERVER_PORT}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
});
