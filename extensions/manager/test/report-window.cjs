const { app, BrowserWindow } = require('electron')

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' || !process.env.ORCA_MANAGER_TEST_PROFILE) {
  throw new Error('Report checks require background launch and an isolated profile.')
}
app.setPath('userData', process.env.ORCA_MANAGER_TEST_PROFILE)
if (process.platform === 'darwin') {
  app.setActivationPolicy('accessory')
}
app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 850,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      paintWhenInitiallyHidden: true
    }
  })
  window.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
