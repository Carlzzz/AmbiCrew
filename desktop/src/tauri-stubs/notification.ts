export function isPermissionGranted(): Promise<boolean> {
  return Promise.resolve(false)
}
export function requestPermission(): Promise<NotificationPermission> {
  return Promise.resolve('denied')
}
export function sendNotification(_opts: { title: string; body?: string }): void {}
export type Permission = 'granted' | 'denied' | 'default'
