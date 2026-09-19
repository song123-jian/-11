function errorSummary(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: String(error.message || '').slice(0, 2_000),
      stack: String(error.stack || '').slice(0, 8_000),
    }
  }
  return { message: String(error ?? '').slice(0, 2_000) }
}

function writeDiagnostic(event, details) {
  // The diagnostic runner captures WebView2 stderr locally; never send this data remotely.
  console.error('[efficiency-diagnostic]', JSON.stringify({
    event,
    at: new Date().toISOString(),
    ...details,
  }))
}

export function installFrontendDiagnostics(app) {
  if (typeof window === 'undefined') return () => {}
  const onError = (event) => {
    writeDiagnostic('window-error', {
      error: errorSummary(event.error || event.message),
      source: event.filename ? { filename: event.filename, line: event.lineno, column: event.colno } : undefined,
    })
  }
  const onRejection = (event) => {
    writeDiagnostic('unhandled-rejection', { reason: errorSummary(event.reason) })
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  if (app) {
    app.config.errorHandler = (error, instance, info) => {
      writeDiagnostic('vue-error', {
        error: errorSummary(error),
        info: String(info || '').slice(0, 500),
        component: instance?.$options?.name || instance?.$options?.__name || 'anonymous',
      })
    }
  }
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
