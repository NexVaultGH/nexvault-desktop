'use strict'

const { contextBridge } = require('electron')

// Expose desktop app info to the renderer
contextBridge.exposeInMainWorld('__nexvaultDesktop', {
  version:  require('./package.json').version,
  platform: process.platform,
  isDesktopApp: true
})
