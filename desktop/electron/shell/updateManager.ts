export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'failed'

export class UpdateManager {
  private status: UpdateStatus = 'idle'

  getStatus(): UpdateStatus {
    return this.status
  }

  async checkForUpdates(): Promise<void> {
    this.status = 'checking'
    // Placeholder — will wire electron-updater later
    this.status = 'idle'
  }
}
