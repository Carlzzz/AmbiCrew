// desktop/src/api/centralOAuth.ts

import { api, getBaseUrl } from './client'

export type CentralOAuthStatus = {
  loggedIn: boolean
  displayName?: string
}

function currentServerPort(): number {
  const port = new URL(getBaseUrl()).port
  const parsed = Number.parseInt(port, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Cannot determine server port from baseUrl: ${getBaseUrl()}`)
  }
  return parsed
}

export const centralOAuthApi = {
  start() {
    return api.post<{ authorizeUrl: string }>(
      '/api/central-oauth/start',
      { serverPort: currentServerPort() },
    )
  },

  status() {
    return api.get<CentralOAuthStatus>('/api/central-oauth')
  },

  logout() {
    return api.delete<{ ok: true }>('/api/central-oauth')
  },
}
