'use strict'

const { contextBridge } = require('electron')

// Expose minimal app info to the renderer (nexvault.one page)
contextBridge.exposeInMainWorld('__nexvaultDesktop', {
  version:  require('./package.json').version,
  platform: process.platform
})
