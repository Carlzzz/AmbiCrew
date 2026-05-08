export function listen<T = unknown>(_event: string, _handler: (event: { payload: T }) => void): Promise<() => void> {
  return Promise.reject(new Error('Tauri not available'))
}
