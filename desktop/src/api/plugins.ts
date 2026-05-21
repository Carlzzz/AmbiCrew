import { api } from './client'
import type {
  MarketplaceBrowseResponse,
  PluginDetail,
  PluginListResponse,
  PluginReloadSummary,
  PluginScope,
} from '../types/plugin'

type PluginActionPayload = {
  id: string
  scope?: PluginScope
  keepData?: boolean
}

export const pluginsApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<PluginListResponse>(`/api/plugins${query}`)
  },

  detail: (id: string, cwd?: string) => {
    const query = new URLSearchParams({ id })
    if (cwd) query.set('cwd', cwd)
    return api.get<{ detail: PluginDetail }>(`/api/plugins/detail?${query.toString()}`)
  },

  enable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/enable', payload),

  disable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/disable', payload),

  update: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/update', payload),

  uninstall: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/uninstall', payload),

  reload: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.post<{ ok: true; summary: PluginReloadSummary }>(
      `/api/plugins/reload${query}`,
      undefined,
      { timeout: 120_000 },
    )
  },

  marketplace: (marketplaceName?: string) => {
    const query = marketplaceName
      ? `?marketplace=${encodeURIComponent(marketplaceName)}`
      : ''
    return api.get<MarketplaceBrowseResponse>(`/api/plugins/marketplace${query}`)
  },

  install: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/install', payload, {
      timeout: 120_000,
    }),

  refreshMarketplace: (name: string) =>
    api.post<{ ok: true; message: string }>(
      '/api/plugins/marketplace/refresh',
      { name },
      { timeout: 120_000 },
    ),
}
