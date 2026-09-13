function networkDependency(online) {
  if (online === true) {
    return {
      id: 'network', label: '本机网络状态', status: 'ready', statusLabel: '系统已连接',
      detail: '浏览器报告网络已连接；在线工具仍需在你主动点击并授权后发起请求。', toolId: 'ip',
    }
  }
  if (online === false) {
    return {
      id: 'network', label: '本机网络状态', status: 'attention', statusLabel: '系统离线',
      detail: '在线工具会保持可预测的失败状态；恢复网络后可从网络工具重新发起请求。', toolId: 'ip',
    }
  }
  return {
    id: 'network', label: '本机网络状态', status: 'informational', statusLabel: '状态未知',
    detail: '当前运行环境未提供网络状态信号；在线工具会在用户主动执行时返回实际结果。', toolId: 'ip',
  }
}

export function buildDependencyStatus({ runtimeMode = 'browser', capabilities = {}, online = null } = {}) {
  const isDesktop = runtimeMode === 'tauri'
  const hasLibreOffice = Boolean(capabilities?.libreoffice)
  return [
    {
      id: 'webview2', label: 'WebView2 运行环境', status: isDesktop ? 'ready' : 'informational',
      statusLabel: isDesktop ? '已就绪' : '浏览器模式',
      detail: isDesktop
        ? '当前 Tauri 桌面窗口已由 WebView2 运行环境创建。'
        : '浏览器开发模式无需 WebView2；正式桌面版会由系统运行时承载。',
      toolId: null,
    },
    {
      id: 'libreoffice', label: 'LibreOffice', status: hasLibreOffice ? 'ready' : 'attention',
      statusLabel: hasLibreOffice ? '已检测' : '未检测',
      detail: hasLibreOffice
        ? 'Office 导出 PDF 可用；实际转换仍会为每个任务单独校验输入和输出目录。'
        : 'Office 导出 PDF 暂不可用；安装或配置 LibreOffice 后重启桌面版即可使用，其他工具不受影响。',
      toolId: 'office-pdf',
    },
    {
      id: 'ocr', label: 'OCR 语言模型', status: 'informational', statusLabel: '按需加载',
      detail: '中文/英文 OCR 模型只会在你主动开始识别后按需下载并缓存，图片内容不会上传。',
      toolId: 'ocr',
    },
    networkDependency(online),
  ]
}
