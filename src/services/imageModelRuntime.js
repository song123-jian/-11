import { checkLocalAiRuntime } from './imageAiTools.js'

export const IMAGE_MODEL_RUNTIME_VERSION = 'local-vision-1'

export async function inspectImageModelRuntime() {
  try {
    const runtime = await checkLocalAiRuntime()
    return {
      ...runtime,
      version: IMAGE_MODEL_RUNTIME_VERSION,
      remoteVision: false,
      status: 'ready',
    }
  } catch (error) {
    return {
      available: false,
      engine: 'unavailable',
      modelLoaded: false,
      mode: 'local-heuristic',
      version: IMAGE_MODEL_RUNTIME_VERSION,
      remoteVision: false,
      status: 'unavailable',
      detail: error?.message || '本地图片引擎未就绪',
    }
  }
}

export function describeImageModelBoundary(runtime) {
  if (!runtime?.available) return '当前环境不支持本地图片处理，请切换到支持 Canvas 的桌面或浏览器环境。'
  return '默认使用本机 Canvas 智能算法，不上传原图；如需云端视觉模型，必须由供应商明确支持并单独授权。'
}

