<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlarmClock,
  Check,
  Clock3,
  Moon,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
} from 'lucide-vue-next'
import {
  MIN_POWER_DELAY_SECONDS,
  POWER_ACTIONS,
  POWER_SAFETY_BUFFER_SECONDS,
  cancelPowerSchedule,
  createPowerRequestId,
  formatPowerDuration,
  getPowerScheduleStatus,
  normalizePowerScheduleStatus,
  powerActionLabel,
  schedulePowerAction,
  toLocalDateTimeValue,
  validatePowerSchedule,
} from '../services/shutdownScheduler.js'

const props = defineProps({
  runtimeMode: { type: String, default: 'browser' },
})
const emit = defineEmits(['notify'])

const mode = ref('countdown')
const action = ref('shutdown')
const countdownHours = ref(0)
const countdownMinutes = ref(30)
const countdownSeconds = ref(0)
const targetAt = ref(toLocalDateTimeValue(Date.now() + 60 * 60 * 1000))
const confirmOpen = ref(false)
const pendingDraft = ref(null)
const busy = ref(false)
const errorMessage = ref('')
const now = ref(Date.now())
const schedule = ref(normalizePowerScheduleStatus())

let ticker
let poller

const isDesktop = computed(() => props.runtimeMode === 'tauri')
const isActive = computed(() => ['scheduled', 'executing'].includes(schedule.value.status))
const countdownTotalSeconds = computed(() => {
  const rawValues = [countdownHours.value, countdownMinutes.value, countdownSeconds.value]
  if (rawValues.some((value) => value === '' || value === null || value === undefined)) return NaN
  const [hours, minutes, seconds] = rawValues.map(Number)
  if (![hours, minutes, seconds].every(Number.isInteger)) return NaN
  if (hours < 0 || hours > 744 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return NaN
  return hours * 3_600 + minutes * 60 + seconds
})
const validation = computed(() => {
  try {
    return validatePowerSchedule({
      mode: mode.value,
      action: action.value,
      countdownSeconds: countdownTotalSeconds.value,
      targetAt: targetAt.value,
      now: now.value,
    })
  } catch {
    return null
  }
})
const remainingMs = computed(() => {
  if (!schedule.value.executeAtMs || !isActive.value) return 0
  return Math.max(0, schedule.value.executeAtMs - now.value)
})
const statusLabel = computed(() => ({
  idle: '尚未设置',
  scheduled: '等待执行',
  executing: '正在执行',
  executed: '已执行',
  canceled: '已取消',
  failed: '执行失败',
}[schedule.value.status] || '尚未设置'))
const statusTone = computed(() => ({
  scheduled: 'active',
  executing: 'active',
  executed: 'success',
  canceled: 'muted',
  failed: 'error',
}[schedule.value.status] || 'muted'))
const targetLabel = computed(() => {
  if (!schedule.value.executeAtMs) return ''
  return new Date(schedule.value.executeAtMs).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
})
const runtimeLabel = computed(() => isDesktop.value ? '桌面版可执行' : '浏览器预览')

function notify(message, type = 'success') {
  emit('notify', message, type)
}

function stopTimers() {
  if (ticker) window.clearInterval(ticker)
  if (poller) window.clearInterval(poller)
  ticker = undefined
  poller = undefined
}

function tick() {
  now.value = Date.now()
  if (schedule.value.status === 'scheduled' && schedule.value.executeAtMs <= now.value) {
    schedule.value = { ...schedule.value, status: 'executing' }
  }
}

function startTimers() {
  if (!ticker) ticker = window.setInterval(tick, 250)
  if (!poller && isDesktop.value) poller = window.setInterval(() => { void refreshRemoteStatus() }, 1_000)
}

async function refreshRemoteStatus() {
  if (!isDesktop.value) return
  try {
    const remote = normalizePowerScheduleStatus(await getPowerScheduleStatus())
    if (remote.status === 'idle') return
    if (schedule.value.requestId && remote.requestId && remote.requestId !== schedule.value.requestId) return
    schedule.value = remote
    if (!remote.active) stopTimers()
  } catch {
    // A desktop process can be closing while the scheduled action is firing.
  }
}

function openConfirm() {
  errorMessage.value = ''
  if (!isDesktop.value) {
    notify('浏览器模式仅支持预览，真实定时关机请使用 Tauri 桌面版', 'info')
    return
  }
  if (isActive.value) {
    notify('已有一个定时任务在运行，请先取消后再创建', 'info')
    return
  }
  try {
    pendingDraft.value = validatePowerSchedule({
      mode: mode.value,
      action: action.value,
      countdownSeconds: countdownTotalSeconds.value,
      targetAt: targetAt.value,
      now: Date.now(),
    })
    confirmOpen.value = true
  } catch (error) {
    errorMessage.value = error.message || '定时参数无效'
  }
}

function closeConfirm() {
  if (busy.value) return
  confirmOpen.value = false
  pendingDraft.value = null
}

async function confirmSchedule() {
  if (!pendingDraft.value || busy.value) return
  busy.value = true
  errorMessage.value = ''
  const requestId = createPowerRequestId()
  try {
    const remote = await schedulePowerAction({
      action: pendingDraft.value.action,
      executeAtMs: pendingDraft.value.executeAtMs,
      requestId,
    })
    schedule.value = normalizePowerScheduleStatus({
      ...remote,
      requestId: remote?.requestId || requestId,
      action: remote?.action || pendingDraft.value.action,
      executeAtMs: remote?.executeAtMs || pendingDraft.value.executeAtMs,
    })
    confirmOpen.value = false
    pendingDraft.value = null
    startTimers()
    notify(`已创建${powerActionLabel(schedule.value.action)}定时任务`)
  } catch (error) {
    errorMessage.value = error.message || '定时任务创建失败'
    notify(errorMessage.value, 'error')
  } finally {
    busy.value = false
  }
}

async function cancelSchedule() {
  if (!isActive.value || busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const remote = normalizePowerScheduleStatus(await cancelPowerSchedule(schedule.value.requestId))
    schedule.value = remote.status === 'idle'
      ? { ...schedule.value, status: 'canceled', active: false }
      : remote
    stopTimers()
    notify('定时任务已取消', 'info')
  } catch (error) {
    errorMessage.value = error.message || '取消定时任务失败'
    notify(errorMessage.value, 'error')
  } finally {
    busy.value = false
  }
}

function resetSchedule() {
  if (isActive.value) return
  errorMessage.value = ''
  schedule.value = normalizePowerScheduleStatus()
}

watch(() => props.runtimeMode, (value) => {
  if (value === 'tauri') void refreshRemoteStatus()
}, { immediate: true })

onMounted(() => {
  tick()
  if (isDesktop.value) void refreshRemoteStatus()
})

onBeforeUnmount(() => {
  stopTimers()
})
</script>

<template>
  <section class="content-card tool-card power-card" aria-labelledby="power-tool-title">
    <div class="tool-title-row">
      <div>
        <h2 id="power-tool-title">定时关机</h2>
        <p>为长任务或作息安排设置一次性系统动作；执行前保留安全缓冲，可随时取消。</p>
      </div>
      <span class="power-runtime-chip" :class="isDesktop ? 'desktop' : 'browser'"><Power :size="13" /> {{ runtimeLabel }}</span>
    </div>

    <div v-if="!isDesktop" class="dependency-panel missing power-browser-notice" role="status">
      <strong>当前为浏览器预览模式</strong>
      <span>浏览器不会调用关机、重启或休眠命令。请在 Windows Tauri 桌面版中使用真实执行能力。</span>
    </div>

    <div class="power-form">
      <div class="power-section-heading"><span><AlarmClock :size="17" /> 触发方式</span><small>单个活动任务</small></div>
      <div class="segmented-control power-mode-switch" aria-label="定时模式">
        <button type="button" :class="{ active: mode === 'countdown' }" :aria-pressed="mode === 'countdown'" :disabled="isActive || busy" @click="mode = 'countdown'">倒计时</button>
        <button type="button" :class="{ active: mode === 'at-time' }" :aria-pressed="mode === 'at-time'" :disabled="isActive || busy" @click="mode = 'at-time'">定点时间</button>
      </div>

      <div v-if="mode === 'countdown'" class="power-duration-grid">
        <label>小时<input v-model.number="countdownHours" class="form-control" type="number" min="0" max="744" step="1" :disabled="isActive || busy" /></label>
        <label>分钟<input v-model.number="countdownMinutes" class="form-control" type="number" min="0" max="59" step="1" :disabled="isActive || busy" /></label>
        <label>秒<input v-model.number="countdownSeconds" class="form-control" type="number" min="0" max="59" step="1" :disabled="isActive || busy" /></label>
      </div>
      <label v-else class="power-target-field">执行时间<input v-model="targetAt" class="form-control" type="datetime-local" step="1" :disabled="isActive || busy" /></label>

      <div class="power-section-heading action-heading"><span><Power :size="17" /> 执行动作</span><small>默认不强制关闭程序</small></div>
      <div class="power-action-grid" role="radiogroup" aria-label="系统动作">
        <button v-for="item in POWER_ACTIONS" :key="item.id" type="button" class="power-action-option" :class="{ active: action === item.id }" :aria-pressed="action === item.id" :disabled="isActive || busy" @click="action = item.id">
          <component :is="item.id === 'shutdown' ? Power : item.id === 'restart' ? RotateCcw : Moon" :size="18" />
          <span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
          <Check v-if="action === item.id" :size="16" class="power-action-check" />
        </button>
      </div>

      <div class="power-safety-note"><ShieldCheck :size="16" /><span>系统动作默认带 {{ POWER_SAFETY_BUFFER_SECONDS }} 秒保存缓冲；创建前会再次确认完整参数。</span></div>
      <p v-if="errorMessage" class="power-error" role="alert">{{ errorMessage }}</p>
      <div class="action-row power-actions">
        <button class="primary-button" type="button" :disabled="!isDesktop || isActive || busy || !validation" @click="openConfirm"><Clock3 :size="15" /> {{ busy ? '处理中...' : '设置定时任务' }}</button>
        <button v-if="isActive" class="danger-button" type="button" :disabled="busy" @click="cancelSchedule"><Square :size="15" /> 取消任务</button>
        <button v-else class="outline-button" type="button" :disabled="busy || schedule.status === 'idle'" @click="resetSchedule"><RefreshCw :size="15" /> 清除状态</button>
      </div>
    </div>

    <section class="power-status-panel" :class="statusTone" aria-live="polite" aria-atomic="true">
      <div class="power-status-heading"><span><span class="power-status-dot"></span>{{ statusLabel }}</span><small v-if="schedule.action">{{ powerActionLabel(schedule.action) }}</small></div>
      <div v-if="isActive" class="power-countdown" aria-label="剩余时间"><strong>{{ formatPowerDuration(remainingMs) }}</strong><span>距离触发</span></div>
      <div v-if="targetLabel" class="power-status-meta"><span>计划时间</span><strong>{{ targetLabel }}</strong></div>
      <p v-if="schedule.error" class="power-error">{{ schedule.error }}</p>
      <p v-else-if="schedule.status === 'executed'" class="power-status-copy">系统动作已提交；桌面系统可能正在退出当前会话。</p>
      <p v-else-if="schedule.status === 'canceled'" class="power-status-copy">本次任务未执行，当前设备不会发生电源动作。</p>
      <p v-else-if="schedule.status === 'idle'" class="power-status-copy">设置后会在此显示剩余时间和执行状态。</p>
    </section>
  </section>

  <div v-if="confirmOpen" class="modal-backdrop power-confirm-backdrop" @click.self="closeConfirm">
    <section class="power-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="power-confirm-title" @keydown.esc.prevent="closeConfirm">
      <div class="modal-heading"><div><p class="eyebrow">定时关机</p><h2 id="power-confirm-title">确认系统动作</h2></div><button class="icon-button" type="button" aria-label="关闭确认" title="关闭确认" @click="closeConfirm"><X :size="18" /></button></div>
      <dl class="power-confirm-details">
        <div><dt>动作</dt><dd>{{ powerActionLabel(pendingDraft?.action) }}</dd></div>
        <div><dt>触发时间</dt><dd>{{ pendingDraft?.executeAtMs ? new Date(pendingDraft.executeAtMs).toLocaleString('zh-CN') : '-' }}</dd></div>
        <div><dt>安全缓冲</dt><dd>{{ POWER_SAFETY_BUFFER_SECONDS }} 秒，默认不强制关闭程序</dd></div>
      </dl>
      <p class="power-confirm-warning"><ShieldCheck :size="16" />确认后会在 Windows 桌面版创建一次性任务；达到触发时间后将执行所选动作。</p>
      <div class="modal-actions"><button class="outline-button" type="button" :disabled="busy" @click="closeConfirm">返回修改</button><button class="primary-button" type="button" :disabled="busy" @click="confirmSchedule"><Check :size="15" /> {{ busy ? '创建中...' : '确认并创建' }}</button></div>
    </section>
  </div>
</template>
