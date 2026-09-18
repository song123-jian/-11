export function networkConnectionPresentation(online) {
  return online === false
    ? { label: '离线', className: 'offline' }
    : { label: '在线', className: 'available' }
}

export function formatNetworkConnectionLabel(online, runningTaskCount = 0) {
  const { label } = networkConnectionPresentation(online)
  const count = Number.isFinite(runningTaskCount) ? Math.max(0, Math.trunc(runningTaskCount)) : 0
  return count ? `${label} · ${count} 个任务进行中` : label
}
