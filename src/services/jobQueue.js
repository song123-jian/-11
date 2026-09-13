function canceledError() {
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  return error
}

function boundedInteger(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback
}

export function normalizeJobStatus(update = {}, previous = {}) {
  const requestedStage = String(update?.stage ?? '').trim()
  const previousStage = String(previous?.stage ?? '').trim()
  const stage = (requestedStage || previousStage || '处理中').slice(0, 80)
  const hasTotalUpdate = Object.prototype.hasOwnProperty.call(update || {}, 'total')
  const requestedTotal = boundedInteger(update?.total)
  const previousTotal = boundedInteger(previous?.total)
  const total = previousTotal > 0 ? previousTotal : (hasTotalUpdate && requestedTotal > 0 ? requestedTotal : null)
  if (!total) return { stage, completed: null, total: null, remaining: null }
  const requestedCompleted = boundedInteger(update?.completed, previous?.completed ?? 0)
  const previousCompleted = boundedInteger(previous?.completed, 0)
  const completed = Math.min(total, Math.max(previousCompleted, requestedCompleted))
  return { stage, completed, total, remaining: total - completed }
}

export function createJob({ worker, onStart, onProgress, onStatus, onDone, onError, onCanceling, onCancel, onSettled }) {
  let canceled = false
  let settled = false
  let workStatus = normalizeJobStatus({ stage: '等待执行' })
  const controller = new AbortController()

  const reportProgress = (value) => {
    if (canceled || settled) return
    const progress = Math.min(99, Math.max(0, Math.round(Number(value) || 0)))
    onProgress?.(progress)
  }

  const reportStatus = (update) => {
    if (canceled || settled) return
    const next = normalizeJobStatus(update, workStatus)
    if (Object.keys(next).every((key) => next[key] === workStatus[key])) return
    workStatus = next
    onStatus?.(next)
  }

  const settle = (status, payload) => {
    if (settled) return
    settled = true
    try {
      if (status === 'success') onDone?.(payload)
      if (status === 'failed') onError?.(payload)
      if (status === 'canceled') onCancel?.()
    } finally {
      onSettled?.(status, payload)
    }
  }

  const cancel = () => {
    if (settled || canceled) return false
    canceled = true
    onCanceling?.()
    controller.abort()
    return true
  }

  const promise = Promise.resolve()
    .then(() => {
      if (canceled) throw canceledError()
      onStart?.()
      return worker({
        onProgress: reportProgress,
        reportStatus,
        isCanceled: () => canceled,
        signal: controller.signal,
        throwIfCanceled: () => {
          if (canceled) throw canceledError()
        },
      })
    })
    .then((result) => {
      if (canceled) throw canceledError()
      onProgress?.(100)
      settle('success', result)
      return result
    })
    .catch((error) => {
      if (canceled || error?.name === 'AbortError') {
        settle('canceled')
        return undefined
      }
      settle('failed', error)
      return undefined
    })

  return { cancel, promise, isCanceled: () => canceled }
}
