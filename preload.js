'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__nexvaultDesktop', {
  isElectron: true,
  version: require('./package.json').version,
  platform: process.platform,
  openInBrowser: (url) => ipcRenderer.invoke('open-in-browser', url)
})
