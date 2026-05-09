import { ipcMain, Notification, type IpcMainInvokeEvent, BrowserWindow } from 'electron'

export function registerNotificationIpc(): void {
  ipcMain.handle('notification:send', (_event: IpcMainInvokeEvent, opts: { title: string; body?: string }) => {
    if (!Notification.isSupported()) return false

    const win = BrowserWindow.getFocusedWindow()
    const notification = new Notification({
      title: opts.title,
      body: opts.body || '',
      silent: false,
    })

    notification.on('click', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })

    notification.show()
    return true
  })

  ipcMain.handle('notification:flashFrame', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && !win.isDestroyed()) {
      win.flashFrame(true)
    }
  })
}
