import { Menu, type MenuItemConstructorOptions } from 'electron'

export function createAppMenu(): MenuItemConstructorOptions[] {
  return [
    {
      label: 'AmbiCrew',
      submenu: [
        { role: 'about', label: '关于 AmbiCrew' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ]
}

export function setAppMenu() {
  const template = createAppMenu()
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
