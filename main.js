'use strict'

const { app, BrowserWindow, shell, Tray, Menu, nativeImage, session } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

// ── Enable Chrome extension support in Electron ──────────────────────────────
// These flags MUST be set before app.ready
app.commandLine.appendSwitch('enable-features', 'ExtensionsToolbarMenu')

// ── Config ────────────────────────────────────────────────────────────────────
const METAMASK_ID   = 'nkbihfbeogaeaoehlefnkodbefgpgknn'
const APP_URL       = 'https://nexvault.one/app'

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null
let tray       = null
let metamaskLoaded = false

// ── Find MetaMask extension from Chrome / Edge / Brave ────────────────────────
function findMetaMaskPath() {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA || ''

  // Build candidate paths for all browsers on all platforms
  const browsers = process.platform === 'win32' ? [
    path.join(local, 'Google', 'Chrome',               'User Data'),
    path.join(local, 'Google', 'Chrome Beta',           'User Data'),
    path.join(local, 'Microsoft', 'Edge',               'User Data'),
    path.join(local, 'BraveSoftware', 'Brave-Browser',  'User Data')
  ] : process.platform === 'darwin' ? [
    path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
    path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
    path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
  ] : [
    path.join(home, '.config', 'google-chrome'),
    path.join(home, '.config', 'microsoft-edge'),
    path.join(home, '.config', 'BraveSoftware', 'Brave-Browser')
  ]

  // Check Default profile and Profile 1-5 for each browser
  const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4', 'Profile 5']

  for (const browserBase of browsers) {
    for (const profile of profiles) {
      const extBase = path.join(browserBase, profile, 'Extensions', METAMASK_ID)
      if (!fs.existsSync(extBase)) continue
      try {
        const versions = fs.readdirSync(extBase)
          .filter(v => { try { return fs.statSync(path.join(extBase, v)).isDirectory() } catch { return false } })
          .sort()
        if (versions.length > 0) {
          const extPath = path.join(extBase, versions[versions.length - 1])
          console.log('[NexVault] Found MetaMask at:', extPath)
          return extPath
        }
      } catch (e) { continue }
    }
  }
  return null
}

// ── Load MetaMask into DEFAULT session ────────────────────────────────────────
// Using defaultSession (not a partition) is critical for extension injection
async function loadMetaMask() {
  const mmPath = findMetaMaskPath()
  if (!mmPath) {
    console.warn('[NexVault] MetaMask not found in any browser.')
    return false
  }
  try {
    // Load into the DEFAULT session — extensions inject window.ethereum
    // only when loaded into the session the BrowserWindow uses
    await session.defaultSession.loadExtension(mmPath, { allowFileAccess: true })
    console.log('[NexVault] MetaMask loaded into default session')
    return true
  } catch (err) {
    console.warn('[NexVault] MetaMask load error:', err.message)
    // Try with explicit partition as fallback
    try {
      const ses = session.fromPartition('persist:nexvault')
      await ses.loadExtension(mmPath, { allowFileAccess: true })
      console.log('[NexVault] MetaMask loaded into persist:nexvault session')
      return true
    } catch (err2) {
      console.warn('[NexVault] MetaMask fallback load also failed:', err2.message)
      return false
    }
  }
}

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
      nodeIntegration:  false,
      // NO partition — use default session so MetaMask extension injects properly
      webSecurity:      true,
      sandbox:          false
    }
  })

  mainWindow.setMenuBarVisibility(false)

  // Load the live dashboard
  mainWindow.loadURL(APP_URL)

  // After page loads, check MetaMask and inject fallback if needed
  mainWindow.webContents.on('did-finish-load', () => {
    // Give MetaMask 2 seconds to inject window.ethereum
    setTimeout(() => {
      mainWindow.webContents.executeJavaScript(`
        (function() {
          window.__nexvaultDesktop = {
            version: '${require('./package.json').version}',
            platform: '${process.platform}',
            metamaskLoaded: ${metamaskLoaded}
          };

          // Check if MetaMask injected
          if (window.ethereum) {
            console.log('[NexVault Desktop] MetaMask detected via window.ethereum');
          } else {
            console.log('[NexVault Desktop] MetaMask NOT detected — adding browser fallback');

            // Override connectWallet to open system browser
            if (typeof window.connectWallet === 'function') {
              const originalConnect = window.connectWallet;
              window.connectWallet = async function() {
                // First try the normal way
                const provider = typeof waitForMetaMask === 'function' ? await waitForMetaMask() : null;
                if (provider) {
                  return originalConnect();
                }
                // MetaMask not found — offer to open in browser
                const btn = document.getElementById('wallet-btn');
                if (btn) {
                  btn.innerHTML = '<span style="font-size:13px">\\u25C8</span> <span>OPEN IN BROWSER</span>';
                  btn.onclick = function() {
                    // Send message to Electron to open in system browser
                    window.open('${APP_URL}', '_blank');
                  };
                }
                // Show notification
                if (typeof showNotif === 'function') {
                  showNotif('Opening in browser where MetaMask is installed...', 'ok');
                }
              };
            }
          }
        })();
      `).catch(() => {})
    }, 2000)
  })

  // Allow MetaMask extension popups and nexvault.one
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('chrome-extension://')) return { action: 'allow' }
    if (url.startsWith('https://nexvault.one')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Navigation control — stay on dashboard
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('https://nexvault.one/app')) return
    if (url.startsWith('chrome-extension://')) return
    e.preventDefault()
    shell.openExternal(url)
  })

  // Minimize to tray
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
app.whenReady().then(async () => {
  metamaskLoaded = await loadMetaMask()
  createWindow()
  createTray()

  // If MetaMask failed to load, log instructions
  if (!metamaskLoaded) {
    console.log('[NexVault] TIP: Install MetaMask in Chrome/Edge/Brave, then restart NexVault.')
    console.log('[NexVault] Or use the "Open in Browser" option from the system tray.')
  }
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
