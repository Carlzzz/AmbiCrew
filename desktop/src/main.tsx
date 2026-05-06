import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './theme/globals.css'
import { installClientDiagnosticsCapture } from './lib/diagnosticsCapture'
import { initializeTheme } from './stores/uiStore'

initializeTheme()
installClientDiagnosticsCapture()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
