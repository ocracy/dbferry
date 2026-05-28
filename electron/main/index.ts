import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { getDb, closeDb } from './storage/sqlite'
import { registerProjectIpc } from './ipc/projects'
import { registerConnectionIpc } from './ipc/connection'
import { registerSyncIpc } from './ipc/sync'
import { registerHistoryIpc } from './ipc/history'
import { registerUpdateIpc } from './ipc/update'
import { loadAllSchedules, unscheduleAll } from './scheduler/cron'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1115',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  getDb()
  registerProjectIpc()
  registerConnectionIpc()
  registerSyncIpc(() => mainWindow)
  registerHistoryIpc()
  registerUpdateIpc()
  createWindow()
  loadAllSchedules()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  unscheduleAll()
  closeDb()
})
