export function open(_path: string, _options?: { cwd?: string }): Promise<void> {
  return Promise.reject(new Error('Tauri not available'))
}
