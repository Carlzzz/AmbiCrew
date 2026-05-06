import { app } from 'electron'

let mainWindow: Electron.BrowserWindow | null = null

export function setupSingleInstance(getWindow: () => Electron.BrowserWindow | null) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    mainWindow = getWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
