// desktop/src/components/settings/CrewCentralLogin.tsx
//
// CrewCentral login UI component — shows login status and provides
// login/logout buttons. Opens browser for OAuth flow via Tauri shell.open.
// Uses server-side central-oauth API for session management.

import { useEffect } from 'react'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { useCentralOAuthStore } from '../../stores/centralOAuthStore'

export function CrewCentralLogin() {
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    startPolling,
    stopPolling,
  } = useCentralOAuthStore()

  useEffect(() => {
    fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  const handleLogin = async () => {
    try {
      const { authorizeUrl } = await login()
      try {
        await shellOpen(authorizeUrl)
        startPolling()
      } catch (err) {
        console.error('[CrewCentralLogin] shellOpen failed:', err)
        useCentralOAuthStore.setState({
          error: '无法打开浏览器，请检查系统设置',
        })
      }
    } catch {
      // store.login() errors are already captured into store.error
    }
  }

  if (status === null) {
    if (error) {
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">CrewCentral</span>
            <span className="text-xs text-[var(--color-error)]">连接失败</span>
          </div>
          <div className="text-xs text-[var(--color-error)]">{error}</div>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">CrewCentral</span>
        <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
      </div>
    )
  }

  if (status.loggedIn) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">CrewCentral</span>
          <span className="text-[var(--color-success)] text-xs">
            ✓ 已连接
            {status.displayName ? ` — ${status.displayName}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={logout}
          disabled={isLoading}
          className="self-start px-3 py-1 text-xs rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
        >
          {isLoading ? '断开中...' : '断开连接'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">CrewCentral</span>
        <span className="text-xs text-[var(--color-text-tertiary)]">未连接</span>
      </div>
      <div className="text-xs text-[var(--color-text-secondary)]">
        连接 CrewCentral 中控系统，自动获取模型列表并通过 CrewProxy 网关进行用量统计。
      </div>
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoading}
        className="self-start rounded-md bg-[image:var(--gradient-btn-primary)] px-4 py-2 text-sm text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] hover:brightness-105 disabled:opacity-50 transition-opacity"
      >
        {isLoading ? '启动中...' : '连接 CrewCentral'}
      </button>
      {error && (
        <div className="text-xs text-[var(--color-error)]">{error}</div>
      )}
    </div>
  )
}
