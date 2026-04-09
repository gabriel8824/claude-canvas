const { app, BrowserWindow, shell, Menu, nativeTheme, dialog } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const os   = require('os');

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVER_PORT = 3001;
const DEV_MODE    = !app.isPackaged;

let mainWindow  = null;
let serverProc  = null;

// ─── macOS native menu ────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    {
      label: 'Claude Canvas',
      submenu: [
        { label: 'About Claude Canvas', role: 'about' },
        { type: 'separator' },
        { label: 'Hide',   role: 'hide'   },
        { label: 'Hide Others', role: 'hideOthers' },
        { type: 'separator' },
        { label: 'Quit', role: 'quit', accelerator: 'Cmd+Q' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo',  role: 'undo',  accelerator: 'Cmd+Z' },
        { label: 'Redo',  role: 'redo',  accelerator: 'Shift+Cmd+Z' },
        { type: 'separator' },
        { label: 'Cut',   role: 'cut',   accelerator: 'Cmd+X' },
        { label: 'Copy',  role: 'copy',  accelerator: 'Cmd+C' },
        { label: 'Paste', role: 'paste', accelerator: 'Cmd+V' },
        { label: 'Select All', role: 'selectAll', accelerator: 'Cmd+A' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', role: 'reload', accelerator: 'Cmd+R' },
        { label: 'Force Reload', role: 'forceReload', accelerator: 'Shift+Cmd+R' },
        { type: 'separator' },
        { label: 'Actual Size', role: 'resetZoom', accelerator: 'Cmd+0' },
        { label: 'Zoom In',     role: 'zoomIn',    accelerator: 'Cmd+=' },
        { label: 'Zoom Out',    role: 'zoomOut',   accelerator: 'Cmd+-' },
        { type: 'separator' },
        { label: 'Toggle Full Screen', role: 'togglefullscreen', accelerator: 'Ctrl+Cmd+F' },
        ...(DEV_MODE ? [
          { type: 'separator' },
          { label: 'Developer Tools', role: 'toggleDevTools', accelerator: 'Alt+Cmd+I' },
        ] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', role: 'minimize', accelerator: 'Cmd+M' },
        { label: 'Zoom',     role: 'zoom' },
        { type: 'separator' },
        { label: 'Bring All to Front', role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Server management ────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve) => {
    let serverEntry, cwd;

    if (DEV_MODE) {
      // Dev: run ts-node-dev server
      cwd        = path.join(__dirname, '..', 'server');
      serverProc = spawn('npm', ['run', 'dev'], {
        cwd, stdio: 'pipe', shell: true,
        env: { ...process.env },
      });
    } else {
      // Production: run compiled server JS
      cwd = path.join(process.resourcesPath, 'server');
      serverProc = spawn(process.execPath, [path.join(cwd, 'dist', 'index.js')], {
        cwd, stdio: 'pipe',
        env: {
          ...process.env,
          ELECTRON_RESOURCES: process.resourcesPath,
          NODE_PATH: path.join(cwd, 'node_modules'),
        },
      });
    }

    serverProc.stdout?.on('data', d => {
      const t = d.toString();
      process.stdout.write('[server] ' + t);
    });
    serverProc.stderr?.on('data', d => {
      process.stderr.write('[server] ' + d.toString());
    });
    serverProc.on('error', err => console.error('Server error:', err));

    // Poll until server is up
    const poll = setInterval(() => {
      const req = http.get(`http://localhost:${SERVER_PORT}/api/state`, res => {
        if (res.statusCode === 200) {
          clearInterval(poll);
          resolve();
        }
      });
      req.on('error', () => {}); // not ready yet
      req.setTimeout(800, () => req.destroy());
    }, 400);
  });
}

function stopServer() {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1440,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',     // macOS traffic-light buttons inset
    trafficLightPosition: { x: 14, y: 14 },
    vibrancy: 'under-window',         // macOS translucency
    visualEffectState: 'active',
    backgroundColor: '#050810',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,             // allow localhost iframe loading
    },
    icon: path.join(__dirname, 'icon.png'),
  });

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

  console.log('Starting backend server…');
  await startServer();
  console.log('Server ready, opening window…');

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
