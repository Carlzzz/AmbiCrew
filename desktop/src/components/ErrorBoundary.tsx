import React from 'react'
import { t } from '../i18n'
import { reportReactError } from '../lib/diagnosticsCapture'

type Props = {
  children: React.ReactNode
}

type State = {
  hasError: boolean
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    void reportReactError(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <div className="text-base font-semibold">{t('errorBoundary.title')}</div>
            <div className="mt-2 text-sm text-[var(--color-text-tertiary)]">
              {t('errorBoundary.description')}
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
