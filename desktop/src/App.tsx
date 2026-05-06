import { AppShell } from './components/layout/AppShell'
import { useScheduledTaskDesktopNotifications } from './hooks/useScheduledTaskDesktopNotifications'

export function App() {
  useScheduledTaskDesktopNotifications()
  return <AppShell />
}
