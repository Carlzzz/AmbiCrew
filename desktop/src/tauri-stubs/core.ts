export function invoke<T = unknown>(_cmd: string, _args?: Record<string, unknown>): Promise<T> {
  return Promise.reject(new Error('Tauri not available'))
}
