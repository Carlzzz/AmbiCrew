import { app } from 'electron'

export function setupSingleInstance(
  getWindow: () => Electron.BrowserWindow | null,
  onSecondInstance?: (argv: string[]) => void,
): boolean {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    return false
  }

  app.on('second-instance', (_event, argv) => {
    const mainWindow = getWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    if (onSecondInstance) {
      onSecondInstance(argv)
    }
  })

  return true
}
