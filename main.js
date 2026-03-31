'use strict'

const { app, BrowserWindow, shell, Tray, Menu, nativeImage, session } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

// ── Config ────────────────────────────────────────────────────────────────────
const NEXVAULT_URL  = 'https://nexvault.one/app'
const METAMASK_ID   = 'nkbihfbeogaeaoehlefnkodbefgpgknn'
const SESSION_PART  = 'persist:nexvault'   // key: this makes localStorage survive restarts

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null
let tray       = null

// ── Find MetaMask extension from Chrome / Edge installation ───────────────────
function findMetaMaskPath() {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA || ''

  const candidates = process.platform === 'win32' ? [
    path.join(local,  'Google', 'Chrome',           'User Data', 'Default', 'Extensions', METAMASK_ID),
    path.join(local,  'Google', 'Chrome Beta',      'User Data', 'Default', 'Extensions', METAMASK_ID),
    path.join(local,  'Microsoft', 'Edge',          'User Data', 'Default', 'Extensions', METAMASK_ID),
    path.join(local,  'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Extensions', METAMASK_ID)
  ] : [
    path.join(home, 'Library', 'Application Support', 'Google', 'Chrome',          'Default', 'Extensions', METAMASK_ID),
    path.join(home, 'Library', 'Application Support', 'Microsoft Edge',             'Default', 'Extensions', METAMASK_ID),
    path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'Default', 'Extensions', METAMASK_ID)
  ]

  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    const versions = fs.readdirSync(base)
      .filter(v => fs.statSync(path.join(base, v)).isDirectory())
      .sort()
    if (versions.length > 0) {
      return path.join(base, versions[versions.length - 1])
    }
  }
  return null
}

// ── Load MetaMask into the persistent session ─────────────────────────────────
async function loadMetaMask() {
  const mmPath = findMetaMaskPath()
  if (!mmPath) {
    console.warn('[NexVault] MetaMask not found in Chrome/Edge/Brave. Wallet connect will use injected provider only.')
    return
  }
  try {
    const ses = session.fromPartition(SESSION_PART)
    await ses.loadExtension(mmPath, { allowFileAccess: true })
    console.log('[NexVault] MetaMask loaded from:', mmPath)
  } catch (err) {
    console.warn('[NexVault] MetaMask load error:', err.message)
  }
}

// ── Create main window ────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1280,
    height:    840,
    minWidth:  900,
    minHeight: 600,
    title:     'NexVault',
    icon:      path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#05060a',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      // Persistent partition = localStorage / cookies survive between launches
      partition:        SESSION_PART
    }
  })

  // Load the live NexVault app
  mainWindow.loadURL(NEXVAULT_URL)

  // Open any external links (docs, explorers, etc.) in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://nexvault.one')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Intercept navigation away from nexvault.one → open in browser instead
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('https://nexvault.one') && !url.startsWith('http://localhost')) {
      e.preventDefault()
      shell.openExternal(url)
    }
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
    {
      label: 'Open NexVault',
      click: () => { mainWindow.show(); mainWindow.focus() }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit() }
    }
  ]))

  tray.on('click',        () => { mainWindow.show(); mainWindow.focus() })
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus() })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Load MetaMask before window opens so it injects on page load
  await loadMetaMask()

  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  // On macOS apps stay active until explicitly quit
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else mainWindow.show()
})

app.on('before-quit', () => {
  app.isQuitting = true
})
