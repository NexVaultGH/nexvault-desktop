'use strict'

const { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')

// ── Config ────────────────────────────────────────────────────────────────────
const APP_URL = 'https://nexvault.one/app'

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null
let tray       = null

// ── IPC: Open URL in system browser ───────────────────────────────────────────
ipcMain.handle('open-in-browser', (event, url) => {
  shell.openExternal(url || APP_URL)
})

// ── Create main window ────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1320,
    height:    880,
    minWidth:  900,
    minHeight: 600,
    title:     'NexVault',
    icon:      path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#05060a',
    autoHideMenuBar: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false
    }
  })

  mainWindow.setMenuBarVisibility(false)

  // Load the live dashboard
  mainWindow.loadURL(APP_URL)

  // Allow nexvault.one navigation, block everything else
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://nexvault.one/app')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('https://nexvault.one/app')) return
    e.preventDefault()
    shell.openExternal(url)
  })

  // Minimize to tray instead of closing
  mainWindow.on('close', e => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

// ── System tray ───────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png')
  const img = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()

  tray = new Tray(img)
  tray.setToolTip('NexVault — USDX Savings Protocol')

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open NexVault', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: 'Open in Browser', click: () => { shell.openExternal(APP_URL) } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } }
  ]))

  tray.on('click',        () => { mainWindow.show(); mainWindow.focus() })
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus() })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else mainWindow.show()
})

app.on('before-quit', () => {
  app.isQuitting = true
})
