'use strict'

const { app, BrowserWindow, shell, Tray, Menu, nativeImage, session } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

// ── Config ────────────────────────────────────────────────────────────────────
const METAMASK_ID   = 'nkbihfbeogaeaoehlefnkodbefgpgknn'
const SESSION_PART  = 'persist:nexvault'

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null
let tray       = null

// ── Find MetaMask extension from Chrome / Edge / Brave ────────────────────────
function findMetaMaskPath() {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA || ''

  const candidates = process.platform === 'win32' ? [
    path.join(local, 'Google', 'Chrome',               'User Data', 'Default', 'Extensions', METAMASK_ID),
    path.join(local, 'Google', 'Chrome Beta',           'User Data', 'Default', 'Extensions', METAMASK_ID),
    path.join(local, 'Microsoft', 'Edge',               'User Data', 'Default', 'Extensions', METAMASK_ID),
    path.join(local, 'BraveSoftware', 'Brave-Browser',  'User Data', 'Default', 'Extensions', METAMASK_ID)
  ] : process.platform === 'darwin' ? [
    path.join(home, 'Library', 'Application Support', 'Google', 'Chrome',              'Default', 'Extensions', METAMASK_ID),
    path.join(home, 'Library', 'Application Support', 'Microsoft Edge',                 'Default', 'Extensions', METAMASK_ID),
    path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'Default', 'Extensions', METAMASK_ID)
  ] : [
    path.join(home, '.config', 'google-chrome',   'Default', 'Extensions', METAMASK_ID),
    path.join(home, '.config', 'microsoft-edge',  'Default', 'Extensions', METAMASK_ID),
    path.join(home, '.config', 'BraveSoftware',   'Brave-Browser', 'Default', 'Extensions', METAMASK_ID)
  ]

  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    try {
      const versions = fs.readdirSync(base)
        .filter(v => { try { return fs.statSync(path.join(base, v)).isDirectory() } catch { return false } })
        .sort()
      if (versions.length > 0) {
        const extPath = path.join(base, versions[versions.length - 1])
        console.log('[NexVault] Found MetaMask at:', extPath)
        return extPath
      }
    } catch (e) {
      continue
    }
  }
  return null
}

// ── Load MetaMask into persistent session ─────────────────────────────────────
async function loadMetaMask() {
  const mmPath = findMetaMaskPath()
  if (!mmPath) {
    console.warn('[NexVault] MetaMask not found. Users need MetaMask installed in Chrome, Edge, or Brave.')
    return false
  }
  try {
    const ses = session.fromPartition(SESSION_PART)
    await ses.loadExtension(mmPath, { allowFileAccess: true })
    console.log('[NexVault] MetaMask loaded successfully')
    return true
  } catch (err) {
    console.warn('[NexVault] MetaMask load error:', err.message)
    return false
  }
}

// ── Create main window ────────────────────────────────────────────────────────
function createWindow(metamaskLoaded) {
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
      nodeIntegration:  false,
      partition:        SESSION_PART,
      // Required for MetaMask extension to inject window.ethereum
      webSecurity:      true,
      sandbox:          false
    }
  })

  // Hide the menu bar entirely
  mainWindow.setMenuBarVisibility(false)

  // Load the LOCAL dashboard file — no website, just the app
  mainWindow.loadFile(path.join(__dirname, 'app.html'))

  // Open external links (docs, explorers, whitepaper) in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow MetaMask popups (extension pages)
    if (url.startsWith('chrome-extension://')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Intercept navigation — keep user inside the app
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const parsed = new URL(url)
    // Allow file:// (local) and chrome-extension:// (MetaMask)
    if (parsed.protocol === 'file:' || parsed.protocol === 'chrome-extension:') return
    // Everything else opens in system browser
    e.preventDefault()
    shell.openExternal(url)
  })

  // Inject MetaMask status into the page after load
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      window.__nexvaultDesktop = {
        version: '${require('./package.json').version}',
        platform: '${process.platform}',
        metamaskLoaded: ${metamaskLoaded}
      };
      // If MetaMask didn't inject, show a helpful message
      if (!window.ethereum && !${metamaskLoaded}) {
        console.log('[NexVault Desktop] MetaMask not available. Install MetaMask in Chrome, Edge, or Brave to connect your wallet.');
      }
    `).catch(() => {})
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
  const metamaskLoaded = await loadMetaMask()
  createWindow(metamaskLoaded)
  createTray()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(false)
  else mainWindow.show()
})

app.on('before-quit', () => {
  app.isQuitting = true
})
