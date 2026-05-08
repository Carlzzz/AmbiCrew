export function getVersion(): Promise<string> {
  return Promise.reject(new Error('Tauri not available'))
}
