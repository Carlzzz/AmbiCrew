import { useChatStore } from '../../stores/chatStore'

export function AuthRestartBanner({ sessionId }: { sessionId: string }) {
  const authRestartState = useChatStore(
    (s) => s.sessions[sessionId]?.authRestartState,
  )

  if (!authRestartState) return null

  if (authRestartState === 'restarting') {
    return (
      <div className="mx-auto max-w-[860px] px-8 py-2">
        <div className="flex items-center gap-2 rounded-md bg-[var(--color-surface-container)] px-4 py-2 text-sm text-[var(--color-on-surface-variant)]">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          凭据已失效，正在重新连接…
        </div>
      </div>
    )
  }

  // authRestartState === 'failed'
  return (
    <div className="mx-auto max-w-[860px] px-8 py-2">
      <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-4 py-2 text-sm text-red-400">
        重新连接失败，请运行 /login
      </div>
    </div>
  )
}
