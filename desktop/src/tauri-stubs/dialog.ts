export function open(_options?: Record<string, unknown>): Promise<string | null> {
  return Promise.reject(new Error('Tauri not available'))
}
