const rules = [
  {
    code: 'INPUT_INVALID',
    match: /Base URL|接口不存在|模型名|API Key 不能为空/,
    retryable: false,
    recovery: '检查中转站地址、模型名和 API Key 后重新执行。',
  },
  {
    code: 'PERMISSION_DENIED',
    match: /中转站鉴权失败|API Key/,
    retryable: false,
    recovery: '确认 API Key 有效且具备目标模型权限后重新执行。',
  },
  {
    code: 'DEPENDENCY_MISSING',
    match: /未检测到|需要在 Tauri|需要.*桌面版|依赖.*未就绪/,
    retryable: false,
    recovery: '安装或启用所需依赖，重启桌面版后重新执行。',
  },
  {
    code: 'OUTPUT_CONFLICT',
    match: /输出文件已存在|同名|重复/,
    retryable: false,
    recovery: '更换名称或输出位置，确认预览无冲突后重新执行。',
  },
  {
    code: 'STORAGE_FULL',
    match: /磁盘空间不足|磁盘已满|disk full/i,
    retryable: true,
    recovery: '释放目标磁盘空间后安全重试；源文件不会被修改。',
  },
  {
    code: 'INPUT_UNREADABLE',
    match: /损坏|已加密|无法读取|未找到|不存在/,
    retryable: false,
    recovery: '确认文件可访问且未损坏；源文件不会被修改。',
  },
  {
    code: 'INPUT_INVALID',
    match: /请先|请选择|不能为空|必须|不支持|无效|超出范围|不能超过|格式/,
    retryable: false,
    recovery: '修正输入或参数后重新执行。',
  },
  {
    code: 'PERMISSION_DENIED',
    match: /权限|未授权|拒绝访问|禁止访问/,
    retryable: true,
    recovery: '确认系统权限或选择可写位置后安全重试。',
  },
  {
    code: 'OPERATION_TIMEOUT',
    match: /超时|超过 \d+ 秒/,
    retryable: true,
    recovery: '检查网络或外部依赖状态后安全重试。',
  },
  {
    code: 'NETWORK_UNAVAILABLE',
    match: /Failed to fetch|网络|DNS|HTTP \d+|连接|服务返回/,
    retryable: true,
    recovery: '检查网络连接和服务状态后安全重试。',
  },
]

export function normalizeTaskError(error) {
  const message = String(error?.message || '任务执行失败')
  if (error?.name === 'AbortError') {
    return { code: 'JOB_CANCELED', message: '任务已取消', retryable: true, recovery: '需要时可重新执行，源文件未修改。' }
  }
  const rule = rules.find((candidate) => candidate.match.test(message))
  if (rule) return { code: rule.code, message, retryable: rule.retryable, recovery: rule.recovery }
  return {
    code: 'JOB_FAILED',
    message,
    retryable: true,
    recovery: '保留当前输入并安全重试；若再次失败，请导出诊断包。',
  }
}
