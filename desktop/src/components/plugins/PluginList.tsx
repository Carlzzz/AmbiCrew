import { useEffect, useMemo, useState } from 'react'
import { usePluginStore } from '../../stores/pluginStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../shared/Button'
import type { PluginScope, PluginSummary } from '../../types/plugin'

type PluginBucket = 'attention' | 'enabled' | 'disabled'

export function PluginList() {
  const {
    plugins,
    marketplaces,
    summary,
    lastReloadSummary,
    isLoading,
    isApplying,
    error,
    fetchPlugins,
    fetchPluginDetail,
    reloadPlugins,
    marketplacePlugins,
    marketplaceNames,
    isMarketplaceLoading,
    isInstalling,
    fetchMarketplacePlugins,
    refreshMarketplace,
    installPlugin,
  } = usePluginStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addToast = useUIStore((s) => s.addToast)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const [showBrowse, setShowBrowse] = useState(false)
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>('')

  useEffect(() => {
    void fetchPlugins(currentWorkDir)
  }, [fetchPlugins, currentWorkDir])

  const grouped = useMemo(() => {
    const buckets: Record<PluginBucket, PluginSummary[]> = {
      attention: [],
      enabled: [],
      disabled: [],
    }

    for (const plugin of plugins) {
      if (plugin.hasErrors) {
        buckets.attention.push(plugin)
      } else if (plugin.enabled) {
        buckets.enabled.push(plugin)
      } else {
        buckets.disabled.push(plugin)
      }
    }

    return buckets
  }, [plugins])

  const handleReload = async () => {
    try {
      const reloadSummary = await reloadPlugins(currentWorkDir)
      addToast({
        type: reloadSummary.errors > 0 ? 'warning' : 'success',
        message: t('settings.plugins.reloadToast', {
          enabled: String(reloadSummary.enabled),
          skills: String(reloadSummary.skills),
          errors: String(reloadSummary.errors),
        }),
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div className="flex flex-col gap-6 min-w-0">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          className="min-h-9 w-full sm:w-auto"
          onClick={() => {
            const next = !showBrowse
            setShowBrowse(next)
            if (next && marketplacePlugins.length === 0) {
              void fetchMarketplacePlugins()
            }
          }}
        >
          <span className="material-symbols-outlined text-[16px]">storefront</span>
          {t('settings.plugins.browseMarketplace')}
        </Button>
      </div>

      {showBrowse && (
        <MarketplaceBrowser
          marketplacePlugins={marketplacePlugins}
          marketplaceNames={marketplaceNames}
          isLoading={isMarketplaceLoading}
          isInstalling={isInstalling}
          selectedMarketplace={selectedMarketplace}
          onSelectMarketplace={(name) => {
            setSelectedMarketplace(name)
            void fetchMarketplacePlugins(name || undefined)
          }}
          onRefresh={(name) => void refreshMarketplace(name)}
          onInstall={(pluginId, scope) => {
            void installPlugin(pluginId, scope, currentWorkDir)
              .then((message) => addToast({ type: 'success', message }))
              .catch((err) => addToast({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
          }}
          t={t}
        />
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="text-sm text-[var(--color-error)] py-4">{error}</div>
      ) : (
      <>
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
        <div className="grid gap-4 px-5 py-5 min-w-0 2xl:grid-cols-[minmax(0,1.45fr)_minmax(420px,0.95fr)] 2xl:items-end">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
              {t('settings.plugins.browserEyebrow')}
            </div>
            <div className="flex items-center gap-3 mb-2">
              <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">
                extension
              </span>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('settings.plugins.browserTitle')}
              </h3>
            </div>
            <p className="text-sm leading-6 text-[var(--color-text-secondary)] max-w-3xl">
              {t('settings.plugins.browserDescription')}
            </p>
            {lastReloadSummary && (
              <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
                {t('settings.plugins.lastReload', {
                  enabled: String(lastReloadSummary.enabled),
                  skills: String(lastReloadSummary.skills),
                  errors: String(lastReloadSummary.errors),
                })}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
              <SummaryCard
                label={t('settings.plugins.summary.total')}
                value={String(summary?.total ?? plugins.length)}
                icon="extension"
              />
              <SummaryCard
                label={t('settings.plugins.summary.enabled')}
                value={String(summary?.enabled ?? plugins.filter((plugin) => plugin.enabled).length)}
                icon="check_circle"
              />
              <SummaryCard
                label={t('settings.plugins.summary.attention')}
                value={String(grouped.attention.length)}
                icon="warning"
              />
              <SummaryCard
                label={t('settings.plugins.summary.marketplaces')}
                value={String(summary?.marketplaceCount ?? marketplaces.length)}
                icon="storefront"
              />
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button
                variant="secondary"
                size="sm"
                className="min-h-9 flex-1 sm:flex-none"
                onClick={() => void fetchPlugins(currentWorkDir)}
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                {t('settings.plugins.refresh')}
              </Button>
              <Button
                size="sm"
                className="min-h-9 flex-1 sm:flex-none"
                onClick={handleReload}
                loading={isApplying}
              >
                <span className="material-symbols-outlined text-[16px]">sync</span>
                {t('settings.plugins.apply')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {marketplaces.length > 0 && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.plugins.marketplacesTitle')}
            </h4>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('settings.plugins.marketplacesHint')}
            </p>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {marketplaces.map((marketplace) => (
              <div
                key={marketplace.name}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {marketplace.name}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    marketplace.autoUpdate
                      ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
                      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
                  }`}>
                    {marketplace.autoUpdate
                      ? t('settings.plugins.marketplaceAutoUpdateOn')
                      : t('settings.plugins.marketplaceAutoUpdateOff')}
                  </span>
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)] break-words">
                  {marketplace.source}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                  <span>{t('settings.plugins.marketplaceInstalledCount', { count: String(marketplace.installedCount) })}</span>
                  {marketplace.lastUpdated && (
                    <span>{t('settings.plugins.marketplaceUpdatedAt', { value: new Date(marketplace.lastUpdated).toLocaleString() })}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {plugins.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6">
          <span className="material-symbols-outlined text-[40px] text-[var(--color-text-tertiary)] mb-2 block">
            extension
          </span>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            {t('settings.plugins.empty')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            {t('settings.plugins.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          {renderGroup('attention', grouped.attention, fetchPluginDetail, currentWorkDir, t)}
          {renderGroup('enabled', grouped.enabled, fetchPluginDetail, currentWorkDir, t)}
          {renderGroup('disabled', grouped.disabled, fetchPluginDetail, currentWorkDir, t)}
        </>
      )}
      </>
      )}
    </div>
  )
}

function renderGroup(
  bucket: PluginBucket,
  items: PluginSummary[],
  fetchPluginDetail: (id: string, cwd?: string) => Promise<void>,
  cwd: string | undefined,
  t: ReturnType<typeof useTranslation>,
) {
  if (items.length === 0) return null

  const titleKey =
    bucket === 'attention'
      ? 'settings.plugins.group.attention'
      : bucket === 'enabled'
        ? 'settings.plugins.group.enabled'
        : 'settings.plugins.group.disabled'

  return (
    <section
      key={bucket}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t(titleKey)}
          </h4>
          <p className="text-xs leading-5 text-[var(--color-text-tertiary)] mt-1">
            {t('settings.plugins.groupHint', { count: String(items.length) })}
          </p>
        </div>
        <span className="text-xs text-[var(--color-text-tertiary)]">{items.length}</span>
      </div>
      <div className="flex flex-col p-2">
        {items.map((plugin) => (
          <button
            key={plugin.id}
            onClick={() => void fetchPluginDetail(plugin.id, cwd)}
            className="group rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
                {plugin.hasErrors ? 'warning' : plugin.enabled ? 'extension' : 'extension_off'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
                    {plugin.name}
                  </span>
                  <StatusPill plugin={plugin} />
                  <ScopePill scope={plugin.scope} />
                  {plugin.version && (
                    <span className="rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                      v{plugin.version}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] break-words">
                  {plugin.description || t('settings.plugins.noDescription')}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                  <span>{plugin.marketplace}</span>
                  {plugin.componentCounts.skills > 0 && (
                    <span>{t('settings.plugins.capability.skills', { count: String(plugin.componentCounts.skills) })}</span>
                  )}
                  {plugin.componentCounts.agents > 0 && (
                    <span>{t('settings.plugins.capability.agents', { count: String(plugin.componentCounts.agents) })}</span>
                  )}
                  {plugin.componentCounts.mcpServers > 0 && (
                    <span>{t('settings.plugins.capability.mcpServers', { count: String(plugin.componentCounts.mcpServers) })}</span>
                  )}
                  {plugin.errors.length > 0 && (
                    <span className="text-[var(--color-error)]">
                      {t('settings.plugins.errorCount', { count: String(plugin.errors.length) })}
                    </span>
                  )}
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100">
                chevron_right
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-3">
      <div className="flex min-w-0 items-start gap-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        <span className="material-symbols-outlined text-[14px] flex-shrink-0">{icon}</span>
        <span className="min-w-0 break-words text-[10px] leading-4 whitespace-normal">
          {label}
        </span>
      </div>
      <div className="mt-2 truncate text-xl font-semibold text-[var(--color-text-primary)]">
        {value}
      </div>
    </div>
  )
}

function StatusPill({ plugin }: { plugin: PluginSummary }) {
  const t = useTranslation()

  if (plugin.hasErrors) {
    return (
      <span className="rounded-full bg-[var(--color-error)]/12 px-2 py-0.5 text-[10px] font-medium text-[var(--color-error)]">
        {t('settings.plugins.status.attention')}
      </span>
    )
  }

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
      plugin.enabled
        ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
        : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
    }`}>
      {plugin.enabled
        ? t('settings.plugins.status.enabled')
        : t('settings.plugins.status.disabled')}
    </span>
  )
}

function ScopePill({ scope }: { scope: PluginSummary['scope'] }) {
  const t = useTranslation()
  return (
    <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
      {t(`settings.plugins.scope.${scope}`)}
    </span>
  )
}

type MarketplacePluginEntry = {
  pluginId: string
  name: string
  marketplace: string
  description?: string
  category?: string
  tags?: string[]
  version?: string
  authorName?: string
  isInstalled: boolean
}

function MarketplaceBrowser({
  marketplacePlugins,
  marketplaceNames,
  isLoading,
  isInstalling,
  selectedMarketplace,
  onSelectMarketplace,
  onRefresh,
  onInstall,
  t,
}: {
  marketplacePlugins: MarketplacePluginEntry[]
  marketplaceNames: { name: string; pluginCount: number }[]
  isLoading: boolean
  isInstalling: Record<string, boolean>
  selectedMarketplace: string
  onSelectMarketplace: (name: string) => void
  onRefresh: (name: string) => void
  onInstall: (pluginId: string, scope?: PluginScope) => void
  t: ReturnType<typeof useTranslation>
}) {
  const [installScope, setInstallScope] = useState<PluginScope>('user')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredPlugins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return marketplacePlugins
    return marketplacePlugins.filter((p) => {
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q)) ||
        (p.category?.toLowerCase().includes(q)) ||
        (p.authorName?.toLowerCase().includes(q)) ||
        (p.tags?.some((tag) => tag.toLowerCase().includes(q)))
      )
    })
  }, [marketplacePlugins, searchQuery])

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('settings.plugins.browseTitle')}
          </h4>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            {t('settings.plugins.browseHint')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedMarketplace}
            onChange={(e) => onSelectMarketplace(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          >
            <option value="">{t('settings.plugins.allMarketplaces')}</option>
            {marketplaceNames.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} ({m.pluginCount})
              </option>
            ))}
          </select>
          {selectedMarketplace && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRefresh(selectedMarketplace)}
              loading={isLoading}
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
            </Button>
          )}
        </div>
      </div>

      <div className="px-5 py-3 border-b border-[var(--color-border)]">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[var(--color-text-tertiary)]">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('settings.plugins.searchPlaceholder')}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          />
        </div>
      </div>

      {isLoading && filteredPlugins.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : filteredPlugins.length === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('settings.plugins.noMarketplacePlugins')}
        </div>
      ) : (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredPlugins.map((plugin) => (
            <div
              key={plugin.pluginId}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 flex flex-col"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)] break-words">
                    {plugin.name}
                  </span>
                  {plugin.version && (
                    <span className="ml-2 rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                      v{plugin.version}
                    </span>
                  )}
                </div>
                {plugin.isInstalled ? (
                  <span className="flex-shrink-0 rounded-full bg-[var(--color-success-container)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-success)]">
                    {t('settings.plugins.installed')}
                  </span>
                ) : (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <select
                      value={installScope}
                      onChange={(e) => setInstallScope(e.target.value as PluginScope)}
                      className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-[10px] text-[var(--color-text-tertiary)] focus:outline-none"
                    >
                      <option value="user">user</option>
                      <option value="project">project</option>
                    </select>
                    <Button
                      size="sm"
                      className="min-h-7 px-2 text-[11px]"
                      loading={isInstalling[plugin.pluginId]}
                      onClick={() => onInstall(plugin.pluginId, installScope)}
                    >
                      {t('settings.plugins.install')}
                    </Button>
                  </div>
                )}
              </div>
              {plugin.description && (
                <p className="mt-1.5 text-xs leading-5 text-[var(--color-text-secondary)] break-words line-clamp-2">
                  {plugin.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                <span>{plugin.marketplace}</span>
                {plugin.category && (
                  <span className="rounded-full bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px]">
                    {plugin.category}
                  </span>
                )}
                {plugin.authorName && <span>by {plugin.authorName}</span>}
              </div>
              {plugin.tags && plugin.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {plugin.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
