import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useScheduledTaskDesktopNotifications } from '../../hooks/useScheduledTaskDesktopNotifications'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { useCentralOAuthStore } from '../../stores/centralOAuthStore'
import { TabBar } from './TabBar'
import { StartupErrorView } from './StartupErrorView'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useTranslation } from '../../i18n'

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const t = useTranslation()

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        await initializeDesktopServerUrl()
        await fetchSettings()
        await useCentralOAuthStore.getState().fetchStatus()

        if (!cancelled) {
          setReady(true)
        }

        void (async () => {
          await useTabStore.getState().restoreTabs()
          if (cancelled) return
          const { activeTabId: activeId, tabs } = useTabStore.getState()
          const activeTab = tabs.find((tab) => tab.sessionId === activeId)
          if (activeId && activeTab?.type === 'session') {
            useChatStore.getState().connectToSession(activeId)
          }
        })().catch(() => {})
      } catch (error) {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error))
          setReady(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [fetchSettings])

  // Only activate scheduled task notifications after the server URL is initialized
  useScheduledTaskDesktopNotifications()

  useKeyboardShortcuts()

  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
        {t('app.launching')}
      </div>
    )
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--color-surface)]">
      <div
        data-testid="sidebar-shell"
        data-state={sidebarOpen ? 'open' : 'closed'}
        className="sidebar-shell"
      >
        <Sidebar />
      </div>
      <main
        id="content-area"
        data-sidebar-state={sidebarOpen ? 'open' : 'closed'}
        className="min-w-0 flex-1 flex flex-col overflow-hidden"
      >
        <TabBar />
        <ContentRouter />
      </main>
      <ToastContainer />
    </div>
  )
}
