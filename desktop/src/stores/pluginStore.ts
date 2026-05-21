import { create } from 'zustand'
import { pluginsApi } from '../api/plugins'
import type {
  MarketplacePlugin,
  PluginDetail,
  PluginListResponse,
  PluginReloadSummary,
  PluginScope,
  PluginSummary,
} from '../types/plugin'

type PluginStore = {
  plugins: PluginSummary[]
  marketplaces: PluginListResponse['marketplaces']
  summary: PluginListResponse['summary'] | null
  selectedPlugin: PluginDetail | null
  lastReloadSummary: PluginReloadSummary | null
  isLoading: boolean
  isDetailLoading: boolean
  isApplying: boolean
  error: string | null
  marketplacePlugins: MarketplacePlugin[]
  marketplaceNames: { name: string; pluginCount: number }[]
  isMarketplaceLoading: boolean
  isInstalling: Record<string, boolean>
  fetchPlugins: (cwd?: string) => Promise<void>
  fetchPluginDetail: (id: string, cwd?: string) => Promise<void>
  reloadPlugins: (cwd?: string) => Promise<PluginReloadSummary>
  enablePlugin: (id: string, scope?: PluginScope, cwd?: string) => Promise<string>
  disablePlugin: (id: string, scope?: PluginScope, cwd?: string) => Promise<string>
  updatePlugin: (id: string, scope?: PluginScope, cwd?: string) => Promise<string>
  uninstallPlugin: (id: string, scope?: PluginScope, keepData?: boolean, cwd?: string) => Promise<string>
  installPlugin: (id: string, scope?: PluginScope, cwd?: string) => Promise<string>
  fetchMarketplacePlugins: (marketplaceName?: string) => Promise<void>
  refreshMarketplace: (name: string) => Promise<void>
  clearSelection: () => void
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [],
  marketplaces: [],
  summary: null,
  selectedPlugin: null,
  lastReloadSummary: null,
  isLoading: false,
  isDetailLoading: false,
  isApplying: false,
  error: null,
  marketplacePlugins: [],
  marketplaceNames: [],
  isMarketplaceLoading: false,
  isInstalling: {},

  fetchPlugins: async (cwd) => {
    set({ isLoading: true, error: null })
    try {
      const data = await pluginsApi.list(cwd)
      set({
        plugins: data.plugins,
        marketplaces: data.marketplaces,
        summary: data.summary,
        isLoading: false,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  fetchPluginDetail: async (id, cwd) => {
    set({ isDetailLoading: true, error: null })
    try {
      const { detail } = await pluginsApi.detail(id, cwd)
      set({ selectedPlugin: detail, isDetailLoading: false })
    } catch (err) {
      set({
        isDetailLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  reloadPlugins: async (cwd) => {
    set({ isApplying: true, error: null })
    try {
      const { summary } = await pluginsApi.reload(cwd)
      await get().fetchPlugins(cwd)
      const selected = get().selectedPlugin
      if (selected) {
        await get().fetchPluginDetail(selected.id, cwd)
      }
      set({ isApplying: false, lastReloadSummary: summary })
      return summary
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ isApplying: false, error: message })
      throw err
    }
  },

  enablePlugin: async (id, scope, cwd) => {
    return runAction(
      () => pluginsApi.enable({ id, scope }),
      set,
      get,
      cwd,
    )
  },

  disablePlugin: async (id, scope, cwd) => {
    return runAction(
      () => pluginsApi.disable({ id, scope }),
      set,
      get,
      cwd,
    )
  },

  updatePlugin: async (id, scope, cwd) => {
    return runAction(
      () => pluginsApi.update({ id, scope }),
      set,
      get,
      cwd,
    )
  },

  uninstallPlugin: async (id, scope, keepData = false, cwd) => {
    return runAction(
      () => pluginsApi.uninstall({ id, scope, keepData }),
      set,
      get,
      cwd,
      true,
    )
  },

  installPlugin: async (id, scope, cwd) => {
    set({ isInstalling: { ...get().isInstalling, [id]: true }, error: null })
    try {
      const { message } = await pluginsApi.install({ id, scope })
      await get().fetchPlugins(cwd)
      await get().fetchMarketplacePlugins()
      set({ isInstalling: { ...get().isInstalling, [id]: false } })
      return message
    } catch (err) {
      set({
        isInstalling: { ...get().isInstalling, [id]: false },
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  fetchMarketplacePlugins: async (marketplaceName) => {
    set({ isMarketplaceLoading: true, error: null })
    try {
      const data = await pluginsApi.marketplace(marketplaceName)
      set({
        marketplacePlugins: data.plugins,
        marketplaceNames: data.marketplaces,
        isMarketplaceLoading: false,
      })
    } catch (err) {
      set({
        isMarketplaceLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  refreshMarketplace: async (name) => {
    set({ isMarketplaceLoading: true, error: null })
    try {
      await pluginsApi.refreshMarketplace(name)
      await get().fetchMarketplacePlugins()
    } catch (err) {
      set({
        isMarketplaceLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  clearSelection: () => set({ selectedPlugin: null }),
}))

async function runAction(
  action: () => Promise<{ ok: true; message: string }>,
  set: (updater: Partial<PluginStore>) => void,
  get: () => PluginStore,
  cwd?: string,
  clearSelection = false,
): Promise<string> {
  set({ isApplying: true, error: null })
  try {
    const { message } = await action()
    await get().fetchPlugins(cwd)
    const selected = get().selectedPlugin
    if (clearSelection) {
      set({ selectedPlugin: null })
    } else if (selected) {
      await get().fetchPluginDetail(selected.id, cwd)
    }
    set({ isApplying: false })
    return message
  } catch (err) {
    set({
      isApplying: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
