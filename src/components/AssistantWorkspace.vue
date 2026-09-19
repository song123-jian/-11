<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock4,
  Copy,
  Download,
  FileDown,
  FileText,
  FileUp,
  GripVertical,
  Languages,
  LayoutGrid,
  ListFilter,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Timer,
  TimerReset,
  Trash2,
  Upload,
  Users,
  Volume2,
  VolumeX,
  X,
  QrCode,
  Zap,
} from 'lucide-vue-next'
import { loadState, saveState } from '../services/storage'
import { networkConnectionPresentation } from '../services/networkStatus'
import ToolEntryCard from './ToolEntryCard.vue'
import {
  ASSISTANT_SCHEMA_VERSION,
  DEFAULT_FOCUS_PROFILES,
  NOTE_CATEGORIES,
  REMINDER_CATEGORIES,
  REMINDER_RECURRENCES,
  TODO_CATEGORIES,
  TODO_PRIORITIES,
  buildFocusStats,
  dateKey,
  exportTodosCsv,
  filterTodos,
  formatDuration,
  isTodoOverdue,
  localDateTimeValue,
  normalizeAssistantReminders,
  normalizeAssistantState,
  normalizeAssistantTodos,
  normalizeFocusState,
  normalizeMeetings,
  normalizeAssistantNotes,
  reminderRecurrenceLabel,
  sortTodos,
} from '../services/assistantTools'

const props = defineProps({
  activeTab: { type: String, default: 'overview' },
  networkOnline: { type: Boolean, default: true },
})

const emit = defineEmits(['open-tool', 'notify', 'update:activeTab'])

function notify(message, type = 'success') {
  emit('notify', message, type)
}

const legacyTodos = loadState('todos', [])
const legacyNote = loadState('quick-note', '')
const legacyReminders = loadState('reminders', [])
const assistant = ref(normalizeAssistantState(loadState('assistant', null), {
  todos: legacyTodos,
  note: legacyNote,
  reminders: legacyReminders,
}))

const todos = computed({
  get: () => assistant.value.todos,
  set: (value) => { assistant.value.todos = value },
})
const notes = computed({
  get: () => assistant.value.notes,
  set: (value) => { assistant.value.notes = value },
})
const reminders = computed({
  get: () => assistant.value.reminders,
  set: (value) => { assistant.value.reminders = value },
})
const focus = computed({
  get: () => assistant.value.focus,
  set: (value) => { assistant.value.focus = value },
})
const meetings = computed({
  get: () => assistant.value.meetings,
  set: (value) => { assistant.value.meetings = value },
})

let persistTimer
let noteSaveTimer
let clockTimer
let applyingRemoteState = false

function persistAssistant() {
  const snapshot = normalizeAssistantState(assistant.value)
  saveState('assistant', snapshot)
  // Keep the legacy keys readable for older builds and existing user data.
  saveState('todos', snapshot.todos.map(({ id, text, done }) => ({ id, text, done })))
  saveState('quick-note', snapshot.notes[0]?.content || '')
  saveState('reminders', snapshot.reminders.map(({ id, title, at, notified }) => ({ id, title, at, notified })))
}

function queuePersist() {
  clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    persistAssistant()
    noteSaveState.value = '已自动保存'
  }, 220)
}

watch(assistant, () => {
  if (applyingRemoteState) return
  noteSaveState.value = '正在保存...'
  queuePersist()
}, { deep: true })

function handleRemoteAssistantState(event) {
  if (event?.detail?.namespace !== 'assistant') return
  applyingRemoteState = true
  clearTimeout(persistTimer)
  assistant.value = normalizeAssistantState(event.detail.value)
  noteSaveState.value = '云端状态已更新'
  void nextTick(() => {
    applyingRemoteState = false
  })
}

const assistantTabDefinitions = [
  { id: 'overview', label: '效率总览', icon: BarChart3, description: '汇总任务、专注与提醒数据' },
  { id: 'todos', label: '待办清单', icon: ClipboardList, description: '优先级、标签、截止时间与子任务' },
  { id: 'focus', label: '番茄钟', icon: Timer, description: '专注方案、自动循环与趋势统计' },
  { id: 'reminders', label: '日历提醒', icon: CalendarDays, description: '重复规则、提前提醒与月视图' },
  { id: 'notes', label: '快捷便签', icon: FileText, description: '自动保存、分类检索与任务转换' },
  { id: 'toolbox', label: '办公工具箱', icon: ListFilter, description: '计时、文本处理、二维码与换算' },
  { id: 'meeting', label: '会议纪要', icon: Users, description: '记录要点并一键提取待办' },
  { id: 'templates', label: '模板库', icon: BookOpen, description: '工作计划、复盘与会议模板' },
  { id: 'translation', label: '翻译助手', icon: Languages, description: '保留格式并生成多语言译文' },
  { id: 'ai', label: 'AI 助手', icon: Sparkles, description: '调用已配置的中转站模型' },
]
const assistantTabs = computed(() => {
  const status = networkConnectionPresentation(props.networkOnline)
  return assistantTabDefinitions.map((tab) => ({ ...tab, status: status.label, statusClass: status.className }))
})
const assistantTabIds = new Set(assistantTabDefinitions.map((tab) => tab.id))
const normalizeAssistantTab = (tab) => assistantTabIds.has(tab) ? tab : 'overview'
const assistantTab = ref(normalizeAssistantTab(props.activeTab))
const dashboardPeriod = ref('week')
const assistantNow = ref(Date.now())

watch(() => props.activeTab, (tab) => {
  const normalized = normalizeAssistantTab(tab)
  if (assistantTab.value !== normalized) assistantTab.value = normalized
})

watch(assistantTab, (tab) => {
  if (props.activeTab !== tab) emit('update:activeTab', tab)
})

function selectTab(tab) {
  assistantTab.value = tab
}

function openTool(id) {
  emit('open-tool', id)
}

function labelFor(collection, id, fallback = id) {
  return collection.find((item) => item.id === id)?.label || fallback
}

const todoPriorityLabel = (id) => labelFor(TODO_PRIORITIES, id, '中')
const todoCategoryLabel = (id) => labelFor(TODO_CATEGORIES, id, '其他')
const reminderCategoryLabel = (id) => labelFor(REMINDER_CATEGORIES, id, '其他')
const noteCategoryLabel = (id) => labelFor(NOTE_CATEGORIES, id, '备忘')

// Todo management
const newTodo = ref('')
const newTodoPriority = ref('medium')
const newTodoCategory = ref('work')
const newTodoTags = ref('')
const newTodoDueAt = ref('')
const newTodoSubtask = ref('')
const newTodoCreateReminder = ref(true)
const todoQuery = ref('')
const todoFilterPriority = ref('all')
const todoFilterCategory = ref('all')
const todoSortMode = ref('smart')
const todoShowCompleted = ref(true)
const todoViewMode = ref('list')
const selectedTodoIds = ref([])
const bulkPriority = ref('medium')
const bulkCategory = ref('work')
const draggingTodoId = ref('')
const todoSubtaskDrafts = ref({})

const visibleTodos = computed(() => filterTodos(todos.value, {
  query: todoQuery.value,
  priority: todoFilterPriority.value,
  category: todoFilterCategory.value,
  sort: todoSortMode.value,
  showCompleted: todoShowCompleted.value,
}, assistantNow.value))
const overdueTodos = computed(() => todos.value.filter((todo) => isTodoOverdue(todo, assistantNow.value)))
const completedTodoCount = computed(() => todos.value.filter((todo) => todo.done).length)
const todoCompletionRate = computed(() => todos.value.length ? Math.round(completedTodoCount.value / todos.value.length * 100) : 0)
const todoTagOptions = computed(() => [...new Set(todos.value.flatMap((todo) => todo.tags || []))].slice(0, 30))

function todoDueLabel(todo) {
  if (!todo.dueAt) return '未设置截止时间'
  const timestamp = new Date(todo.dueAt).getTime()
  if (!Number.isFinite(timestamp)) return '截止时间无效'
  return `${isTodoOverdue(todo, assistantNow.value) ? '已逾期 · ' : ''}${new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
}

function todoQuadrant(todo) {
  const urgent = isTodoOverdue(todo, assistantNow.value) || (todo.dueAt && new Date(todo.dueAt).getTime() - assistantNow.value < 2 * 86_400_000)
  const important = todo.priority === 'high'
  if (important && urgent) return 'do'
  if (important && !urgent) return 'schedule'
  if (!important && urgent) return 'delegate'
  return 'later'
}

const quadrantGroups = [
  { id: 'do', label: '重要且紧急', hint: '立即处理', color: 'red' },
  { id: 'schedule', label: '重要不紧急', hint: '安排时间', color: 'amber' },
  { id: 'delegate', label: '不重要但紧急', hint: '快速处理', color: 'blue' },
  { id: 'later', label: '不重要不紧急', hint: '稍后处理', color: 'muted' },
]

function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now()}-${random}`
}

function addTodoRecord(text, options = {}) {
  const value = String(text || '').trim().slice(0, 200)
  if (!value) return null
  const now = Date.now()
  const todo = {
    id: createId('todo'),
    text: value,
    done: false,
    priority: TODO_PRIORITIES.some((item) => item.id === options.priority) ? options.priority : 'medium',
    category: TODO_CATEGORIES.some((item) => item.id === options.category) ? options.category : 'other',
    tags: Array.isArray(options.tags) ? options.tags : [],
    dueAt: options.dueAt || '',
    subtasks: Array.isArray(options.subtasks) ? options.subtasks : [],
    focusMinutes: 0,
    order: todos.value.length,
    createdAt: now,
    updatedAt: now,
  }
  todos.value = normalizeAssistantTodos([todo, ...todos.value])
  return todo
}

function addTodo() {
  const tags = newTodoTags.value.split(/[,，\s]+/).map((item) => item.trim().replace(/^#/, '')).filter(Boolean).slice(0, 8)
  const subtasks = newTodoSubtask.value.trim() ? [{ id: createId('subtask'), text: newTodoSubtask.value.trim().slice(0, 160), done: false }] : []
  const todo = addTodoRecord(newTodo.value, {
    priority: newTodoPriority.value,
    category: newTodoCategory.value,
    tags,
    dueAt: newTodoDueAt.value,
    subtasks,
  })
  if (!todo) return
  if (newTodoCreateReminder.value && todo.dueAt) {
    reminders.value = normalizeAssistantReminders([{
      id: createId('reminder'),
      title: `截止：${todo.text}`,
      at: todo.dueAt,
      category: todo.category === 'life' ? 'life' : 'work',
      linkedTodoId: todo.id,
      advanceMinutes: 0,
      recurrence: { type: 'none', interval: 1, weekdays: [] },
    }, ...reminders.value])
  }
  newTodo.value = ''
  newTodoTags.value = ''
  newTodoDueAt.value = ''
  newTodoSubtask.value = ''
  notify('待办已添加')
}

function updateTodo(todo) {
  todo.tags = String(todo.tags || '').split(/[,，\s]+/).map((item) => item.trim().replace(/^#/, '')).filter(Boolean).slice(0, 8)
  todo.updatedAt = Date.now()
  queuePersist()
}

function toggleTodo(todo) {
  todo.done = !todo.done
  todo.completedAt = todo.done ? Date.now() : null
  todo.updatedAt = Date.now()
  queuePersist()
}

function deleteTodo(todo) {
  todos.value = todos.value.filter((item) => item.id !== todo.id)
  selectedTodoIds.value = selectedTodoIds.value.filter((id) => id !== todo.id)
  notify('待办已删除', 'info')
}

function toggleTodoSelection(todo) {
  selectedTodoIds.value = selectedTodoIds.value.includes(todo.id)
    ? selectedTodoIds.value.filter((id) => id !== todo.id)
    : [...selectedTodoIds.value, todo.id]
}

function toggleVisibleTodoSelection() {
  const ids = visibleTodos.value.map((todo) => todo.id)
  const allSelected = ids.length > 0 && ids.every((id) => selectedTodoIds.value.includes(id))
  selectedTodoIds.value = allSelected
    ? selectedTodoIds.value.filter((id) => !ids.includes(id))
    : [...new Set([...selectedTodoIds.value, ...ids])]
}

function bulkComplete() {
  const selected = new Set(selectedTodoIds.value)
  todos.value.forEach((todo) => {
    if (selected.has(todo.id)) {
      todo.done = true
      todo.completedAt = Date.now()
      todo.updatedAt = Date.now()
    }
  })
  notify(`已完成 ${selected.size} 项待办`)
  selectedTodoIds.value = []
}

function bulkDelete() {
  const selected = new Set(selectedTodoIds.value)
  todos.value = todos.value.filter((todo) => !selected.has(todo.id))
  notify(`已删除 ${selected.size} 项待办`, 'info')
  selectedTodoIds.value = []
}

function bulkUpdateTodoMeta() {
  const selected = new Set(selectedTodoIds.value)
  todos.value.forEach((todo) => {
    if (!selected.has(todo.id)) return
    todo.priority = bulkPriority.value
    todo.category = bulkCategory.value
    todo.updatedAt = Date.now()
  })
  notify(`已更新 ${selected.size} 项待办`)
}

function addSubtask(todo) {
  const value = String(todoSubtaskDrafts.value[todo.id] || '').trim().slice(0, 160)
  if (!value) return
  todo.subtasks = [...(todo.subtasks || []), { id: createId('subtask'), text: value, done: false }].slice(0, 30)
  todoSubtaskDrafts.value[todo.id] = ''
  todo.updatedAt = Date.now()
}

function toggleSubtask(todo, subtask) {
  subtask.done = !subtask.done
  todo.updatedAt = Date.now()
}

function removeSubtask(todo, subtask) {
  todo.subtasks = (todo.subtasks || []).filter((item) => item.id !== subtask.id)
}

function startTodoDrag(todo) {
  draggingTodoId.value = todo.id
}

function dropTodo(todo) {
  const sourceId = draggingTodoId.value
  draggingTodoId.value = ''
  if (!sourceId || sourceId === todo.id) return
  const sourceIndex = todos.value.findIndex((item) => item.id === sourceId)
  const targetIndex = todos.value.findIndex((item) => item.id === todo.id)
  if (sourceIndex < 0 || targetIndex < 0) return
  const next = [...todos.value]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  todos.value = next.map((item, index) => ({ ...item, order: index, updatedAt: Date.now() }))
}

// Focus timer and statistics
const focusProfileId = ref(focus.value.activeProfileId)
const focusMode = ref('work')
const focusSeconds = ref(0)
const focusRunning = ref(false)
const focusCycleCount = ref(0)
const focusTimer = ref(null)
const focusInitialSeconds = ref(0)
const focusEndsAt = ref(0)
const focusSessionStartedAt = ref(0)
const focusTodoId = ref('')
const profileDraft = ref({ name: '', workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 })
const profileEditorOpen = ref(false)
let audioContext
let noiseSource
let noiseGain

const activeFocusProfile = computed(() => focus.value.profiles.find((profile) => profile.id === focusProfileId.value) || focus.value.profiles[0] || DEFAULT_FOCUS_PROFILES[0])
const focusDisplay = computed(() => `${String(Math.floor(focusSeconds.value / 60)).padStart(2, '0')}:${String(focusSeconds.value % 60).padStart(2, '0')}`)
const focusModeLabel = computed(() => focusMode.value === 'work' ? '专注' : focusMode.value === 'short' ? '短休息' : '长休息')
const focusStats = computed(() => buildFocusStats(focus.value.sessions, assistantNow.value))
const focusTrendMax = computed(() => Math.max(1, ...focusStats.value.trend.map((item) => item.minutes)))

function focusDurationFor(mode) {
  if (mode === 'short') return activeFocusProfile.value.shortBreakMinutes * 60
  if (mode === 'long') return activeFocusProfile.value.longBreakMinutes * 60
  return activeFocusProfile.value.workMinutes * 60
}

function resetFocusTimer() {
  focusRunning.value = false
  if (focusTimer.value) window.clearInterval(focusTimer.value)
  focusTimer.value = null
  focusMode.value = 'work'
  focusSeconds.value = focusDurationFor('work')
  focusInitialSeconds.value = focusSeconds.value
  focusEndsAt.value = 0
  focusSessionStartedAt.value = 0
}

function recordFocusSession(seconds, completed = true) {
  if (seconds < 30 || focusMode.value !== 'work') return
  const durationMinutes = Math.max(1, Math.round(seconds / 60))
  const startedAt = focusSessionStartedAt.value || Date.now() - seconds * 1_000
  focus.value.sessions = [...focus.value.sessions, {
    id: createId('focus'),
    startedAt,
    endedAt: Date.now(),
    durationMinutes,
    type: 'work',
    todoId: focusTodoId.value,
    completed,
  }].slice(-2_000)
  if (focusTodoId.value) {
    const todo = todos.value.find((item) => item.id === focusTodoId.value)
    if (todo) {
      todo.focusMinutes = Math.min(100_000, Number(todo.focusMinutes || 0) + durationMinutes)
      todo.updatedAt = Date.now()
    }
  }
}

function startWhiteNoise() {
  if (noiseSource) return
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) {
    notify('当前浏览器不支持白噪音', 'info')
    return
  }
  audioContext = audioContext || new AudioContextCtor()
  const sampleRate = audioContext.sampleRate
  const buffer = audioContext.createBuffer(1, sampleRate * 2, sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * 0.25
  noiseSource = audioContext.createBufferSource()
  noiseSource.buffer = buffer
  noiseSource.loop = true
  const filter = audioContext.createBiquadFilter()
  filter.type = focus.value.settings.noiseType === 'cafe' ? 'bandpass' : 'lowpass'
  filter.frequency.value = focus.value.settings.noiseType === 'cafe' ? 1_200 : 900
  noiseGain = audioContext.createGain()
  noiseGain.gain.value = 0.035
  noiseSource.connect(filter).connect(noiseGain).connect(audioContext.destination)
  noiseSource.start()
}

function stopWhiteNoise() {
  if (!noiseSource) return
  try { noiseSource.stop() } catch { /* already stopped */ }
  noiseSource.disconnect()
  noiseSource = null
  noiseGain = null
}

function toggleWhiteNoise() {
  focus.value.settings.whiteNoise = !focus.value.settings.whiteNoise
  if (focus.value.settings.whiteNoise) startWhiteNoise()
  else stopWhiteNoise()
}

function finishFocusCycle() {
  const completedMode = focusMode.value
  const duration = focusInitialSeconds.value
  focusEndsAt.value = 0
  recordFocusSession(duration, true)
  if (completedMode === 'work') focusCycleCount.value += 1
  if (!focus.value.settings.autoCycle) {
    focusRunning.value = false
    if (focusTimer.value) window.clearInterval(focusTimer.value)
    focusTimer.value = null
    notify(`${focusModeLabel.value}已完成`)
    return
  }
  const nextMode = completedMode === 'work'
    ? (focusCycleCount.value % activeFocusProfile.value.longBreakEvery === 0 ? 'long' : 'short')
    : 'work'
  focusMode.value = nextMode
  focusSeconds.value = focusDurationFor(nextMode)
  focusInitialSeconds.value = focusSeconds.value
  focusEndsAt.value = Date.now() + focusSeconds.value * 1_000
  focusSessionStartedAt.value = nextMode === 'work' ? Date.now() : 0
  notify(`${completedMode === 'work' ? '专注' : '休息'}完成，开始${nextMode === 'work' ? '专注' : nextMode === 'short' ? '短休息' : '长休息'}`)
}

function startFocus() {
  if (focusRunning.value) return
  focusRunning.value = true
  if (!focusSeconds.value) focusSeconds.value = focusDurationFor(focusMode.value)
  focusInitialSeconds.value = focusSeconds.value
  focusEndsAt.value = Date.now() + focusSeconds.value * 1_000
  focusSessionStartedAt.value = focusMode.value === 'work' ? Date.now() : 0
  if (focus.value.settings.whiteNoise) startWhiteNoise()
  focusTimer.value = window.setInterval(() => {
    const remaining = Math.max(0, Math.ceil((focusEndsAt.value - Date.now()) / 1_000))
    if (remaining <= 0) {
      focusSeconds.value = 0
      finishFocusCycle()
      return
    }
    focusSeconds.value = remaining
  }, 1_000)
}

function stopFocus({ recordPartial = true } = {}) {
  if (!focusRunning.value) return
  const currentSeconds = focusEndsAt.value
    ? Math.max(0, Math.ceil((focusEndsAt.value - Date.now()) / 1_000))
    : focusSeconds.value
  focusSeconds.value = currentSeconds
  const elapsed = focusInitialSeconds.value - currentSeconds
  if (recordPartial && elapsed >= 30) recordFocusSession(elapsed, false)
  focusRunning.value = false
  focusEndsAt.value = 0
  if (focusTimer.value) window.clearInterval(focusTimer.value)
  focusTimer.value = null
  stopWhiteNoise()
}

function toggleFocus() {
  if (focusRunning.value) stopFocus()
  else startFocus()
}

function skipFocusPhase() {
  stopFocus({ recordPartial: false })
  focusMode.value = focusMode.value === 'work' ? 'short' : 'work'
  focusSeconds.value = focusDurationFor(focusMode.value)
  focusInitialSeconds.value = focusSeconds.value
}

function saveProfile() {
  const draft = profileDraft.value
  const name = String(draft.name || '').trim().slice(0, 40)
  if (!name) return notify('请输入方案名称', 'error')
  const profile = {
    id: createId('profile'),
    name,
    workMinutes: Math.min(180, Math.max(1, Math.round(Number(draft.workMinutes) || 25))),
    shortBreakMinutes: Math.min(60, Math.max(1, Math.round(Number(draft.shortBreakMinutes) || 5))),
    longBreakMinutes: Math.min(120, Math.max(1, Math.round(Number(draft.longBreakMinutes) || 15))),
    longBreakEvery: Math.min(12, Math.max(1, Math.round(Number(draft.longBreakEvery) || 4))),
  }
  focus.value.profiles = [...focus.value.profiles, profile].slice(0, 20)
  focusProfileId.value = profile.id
  focus.value.activeProfileId = profile.id
  profileDraft.value = { name: '', workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 }
  profileEditorOpen.value = false
  resetFocusTimer()
  notify('专注方案已保存')
}

function removeProfile(profile) {
  if (focus.value.profiles.length <= 1 || DEFAULT_FOCUS_PROFILES.some((item) => item.id === profile.id)) return
  focus.value.profiles = focus.value.profiles.filter((item) => item.id !== profile.id)
  if (focusProfileId.value === profile.id) {
    focusProfileId.value = focus.value.profiles[0].id
    focus.value.activeProfileId = focusProfileId.value
    resetFocusTimer()
  }
}

watch(focusProfileId, (value) => {
  if (!focus.value.profiles.some((profile) => profile.id === value)) return
  focus.value.activeProfileId = value
  if (!focusRunning.value) resetFocusTimer()
})

// Reminder and calendar management
const reminderTitle = ref('')
const reminderAt = ref(localDateTimeValue(Date.now() + 3_600_000))
const reminderCategory = ref('work')
const reminderAdvanceMinutes = ref(0)
const reminderRecurrence = ref('none')
const reminderInterval = ref(1)
const reminderWeekdays = ref([1])
const reminderStarred = ref(false)
const reminderLinkedTodoId = ref('')
const reminderFilterCategory = ref('all')
const calendarVisible = ref(true)
const calendarCursor = ref(new Date())
const calendarSelectedDate = ref(dateKey(Date.now()))
const draggingReminderId = ref('')

const calendarWeekdays = ['一', '二', '三', '四', '五', '六', '日']
const calendarMonthTitle = computed(() => `${calendarCursor.value.getFullYear()} 年 ${calendarCursor.value.getMonth() + 1} 月`)
const calendarCells = computed(() => {
  const year = calendarCursor.value.getFullYear()
  const month = calendarCursor.value.getMonth()
  const first = new Date(year, month, 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = dateKey(date)
    return { key, day: date.getDate(), inMonth: date.getMonth() === month, isToday: key === dateKey(assistantNow.value) }
  })
})
const filteredReminders = computed(() => reminders.value
  .filter((reminder) => reminderFilterCategory.value === 'all' || reminder.category === reminderFilterCategory.value)
  .sort((left, right) => Number(right.starred) - Number(left.starred) || (left.order || 0) - (right.order || 0) || new Date(left.at) - new Date(right.at)))

function remindersForDate(key) {
  return reminders.value.filter((reminder) => dateKey(reminder.at) === key)
}

function selectCalendarDate(key) {
  calendarSelectedDate.value = key
  if (!reminderAt.value || reminderAt.value.slice(0, 10) !== key) reminderAt.value = `${key}T09:00`
  assistantTab.value = 'reminders'
}

function moveCalendarMonth(delta) {
  calendarCursor.value = new Date(calendarCursor.value.getFullYear(), calendarCursor.value.getMonth() + delta, 1)
}

function toggleReminderWeekday(day) {
  reminderWeekdays.value = reminderWeekdays.value.includes(day)
    ? reminderWeekdays.value.filter((item) => item !== day)
    : [...reminderWeekdays.value, day].sort((left, right) => left - right)
}

async function requestReminderNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'default') return
  try {
    await Notification.requestPermission()
  } catch {
    // Saving the reminder must remain available when permission prompts are blocked.
  }
}

async function addReminder() {
  const title = reminderTitle.value.trim().slice(0, 120)
  const timestamp = new Date(reminderAt.value).getTime()
  if (!title || !Number.isFinite(timestamp) || timestamp <= Date.now()) {
    notify('请输入提醒内容和未来时间', 'error')
    return
  }
  await requestReminderNotificationPermission()
  reminders.value = normalizeAssistantReminders([{
    id: createId('reminder'),
    title,
    at: reminderAt.value,
    category: reminderCategory.value,
    advanceMinutes: Number(reminderAdvanceMinutes.value),
    starred: reminderStarred.value,
    linkedTodoId: reminderLinkedTodoId.value,
    recurrence: {
      type: reminderRecurrence.value,
      interval: Number(reminderInterval.value),
      weekdays: reminderWeekdays.value,
    },
    notified: false,
    order: reminders.value.length,
  }, ...reminders.value])
  reminderTitle.value = ''
  reminderStarred.value = false
  reminderLinkedTodoId.value = ''
  notify('提醒已保存到本机')
}

function deleteReminder(reminder) {
  reminders.value = reminders.value.filter((item) => item.id !== reminder.id)
  notify('提醒已删除', 'info')
}

function toggleReminderStar(reminder) {
  reminder.starred = !reminder.starred
  reminder.order = reminder.order || 0
}

function reminderDisplay(reminder) {
  const linked = reminder.linkedTodoId ? todos.value.find((todo) => todo.id === reminder.linkedTodoId) : null
  return `${new Date(reminder.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${reminderRecurrenceLabel(reminder)}${linked ? ` · ${linked.text}` : ''}`
}

function startReminderDrag(reminder) {
  draggingReminderId.value = reminder.id
}

function dropReminder(reminder) {
  const sourceId = draggingReminderId.value
  draggingReminderId.value = ''
  if (!sourceId || sourceId === reminder.id) return
  const sourceIndex = reminders.value.findIndex((item) => item.id === sourceId)
  const targetIndex = reminders.value.findIndex((item) => item.id === reminder.id)
  if (sourceIndex < 0 || targetIndex < 0) return
  const next = [...reminders.value]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  reminders.value = next.map((item, index) => ({ ...item, order: index }))
}

function handleReminderSchedulerEvent(event) {
  const detail = event?.detail || {}
  if (detail.type === 'fallback') {
    if (detail.reminder?.title) notify(`提醒：${detail.reminder.title}`, 'info')
    return
  }
  if (detail.type !== 'state' || !Array.isArray(detail.reminders)) return
  reminders.value = normalizeAssistantReminders(detail.reminders)
  queuePersist()
}

// Notes
const noteSearch = ref('')
const activeNoteId = ref(notes.value[0]?.id || '')
const noteSaveState = ref('已自动保存')
const draggingNoteId = ref('')
const activeNote = computed(() => notes.value.find((note) => note.id === activeNoteId.value) || null)
const visibleNotes = computed(() => notes.value.filter((note) => {
  const query = noteSearch.value.trim().toLocaleLowerCase()
  return !query || `${note.title} ${note.content}`.toLocaleLowerCase().includes(query)
}).sort((left, right) => (left.order || 0) - (right.order || 0)))

function createNote() {
  const now = Date.now()
  const note = {
    id: createId('note'),
    title: '新便签',
    content: '',
    category: 'memo',
    color: 'blue',
    order: notes.value.length,
    createdAt: now,
    updatedAt: now,
  }
  notes.value = normalizeAssistantNotes([note, ...notes.value])
  activeNoteId.value = note.id
  assistantTab.value = 'notes'
}

function saveExternalNote({ title = '新便签', content = '', category = 'memo', color = 'blue' } = {}) {
  const normalizedContent = String(content || '').trim()
  if (!normalizedContent) {
    notify('没有可保存的内容', 'info')
    return false
  }
  const now = Date.now()
  const note = {
    id: createId('note'),
    title: String(title || '新便签').trim().slice(0, 200) || '新便签',
    content: normalizedContent.slice(0, 20_000),
    category: NOTE_CATEGORIES.some((item) => item.id === category) ? category : 'memo',
    color: ['yellow', 'blue', 'red', 'green', 'purple'].includes(color) ? color : 'blue',
    order: notes.value.length,
    createdAt: now,
    updatedAt: now,
  }
  notes.value = normalizeAssistantNotes([note, ...notes.value])
  activeNoteId.value = note.id
  assistantTab.value = 'notes'
  notify('内容已保存为便签')
  return true
}

function deleteNote(note) {
  notes.value = notes.value.filter((item) => item.id !== note.id)
  activeNoteId.value = notes.value[0]?.id || ''
  notify('便签已删除', 'info')
}

function updateNote(note) {
  note.updatedAt = Date.now()
  noteSaveState.value = '正在保存...'
  clearTimeout(noteSaveTimer)
  noteSaveTimer = window.setTimeout(() => {
    persistAssistant()
    noteSaveState.value = '已自动保存'
  }, 220)
}

function convertNoteToTodo(note) {
  const text = (note.title ? `${note.title}：` : '') + note.content
  if (!text.trim()) return notify('便签没有可转换的内容', 'info')
  addTodoRecord(text, { category: note.category === 'idea' ? 'project-a' : 'work', tags: [noteCategoryLabel(note.category)] })
  notify('便签已转为待办')
}

function convertNoteToReminder(note) {
  const text = (note.title || note.content).trim().slice(0, 120)
  if (!text) return notify('便签没有可转换的内容', 'info')
  reminderTitle.value = text
  reminderAt.value = localDateTimeValue(Date.now() + 3_600_000)
  reminderCategory.value = note.category === 'follow-up' ? 'work' : 'other'
  assistantTab.value = 'reminders'
  notify('已带入提醒表单，请确认时间后保存')
}

function startNoteDrag(note) {
  draggingNoteId.value = note.id
}

function dropNote(note) {
  const sourceId = draggingNoteId.value
  draggingNoteId.value = ''
  if (!sourceId || sourceId === note.id) return
  const sourceIndex = notes.value.findIndex((item) => item.id === sourceId)
  const targetIndex = notes.value.findIndex((item) => item.id === note.id)
  if (sourceIndex < 0 || targetIndex < 0) return
  const next = [...notes.value]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  notes.value = next.map((item, index) => ({ ...item, order: index }))
}

// Dashboard
const dashboardTodoStats = computed(() => {
  const now = assistantNow.value
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(todayStart)
  const day = weekStart.getDay() || 7
  weekStart.setDate(weekStart.getDate() - day + 1)
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)
  const start = dashboardPeriod.value === 'day'
    ? todayStart.getTime()
    : dashboardPeriod.value === 'month'
      ? monthStart.getTime()
      : weekStart.getTime()
  const completed = todos.value.filter((todo) => todo.done && (todo.completedAt || todo.updatedAt || todo.createdAt) >= start).length
  const created = todos.value.filter((todo) => (todo.createdAt || 0) >= start).length
  return { completed, created, overdue: overdueTodos.value.length }
})
const dashboardPeriodLabel = computed(() => ({ day: '今日', week: '本周', month: '本月' }[dashboardPeriod.value] || '本周'))
const dashboardFocusStats = computed(() => {
  if (dashboardPeriod.value === 'day') return { minutes: focusStats.value.todayMinutes, pomodoros: focusStats.value.todayPomodoros }
  if (dashboardPeriod.value === 'month') return { minutes: focusStats.value.monthMinutes, pomodoros: focusStats.value.monthPomodoros }
  return { minutes: focusStats.value.weekMinutes, pomodoros: focusStats.value.weekPomodoros }
})
const reminderStats = computed(() => {
  const total = reminders.value.length
  const fulfilled = reminders.value.filter((reminder) => reminder.notified).length
  return { total, fulfilled, rate: total ? Math.round(fulfilled / total * 100) : 0 }
})
const todoCategoryStats = computed(() => TODO_CATEGORIES.map((category) => ({
  ...category,
  count: todos.value.filter((todo) => todo.category === category.id).length,
})).filter((item) => item.count > 0))
const categoryMax = computed(() => Math.max(1, ...todoCategoryStats.value.map((item) => item.count)))

// Toolbox
const toolboxMode = ref('timer')
const toolboxTimerMode = ref('stopwatch')
const toolboxSeconds = ref(0)
const toolboxCountdownMinutes = ref(5)
const toolboxCountdownRemaining = ref(300)
const toolboxTimerRunning = ref(false)
let toolboxTimer
const toolboxText = ref('')
const toolboxTextOutput = ref('')
const toolboxTextStats = computed(() => ({
  chars: toolboxText.value.length,
  noSpaceChars: toolboxText.value.replace(/\s/g, '').length,
  words: toolboxText.value.trim() ? toolboxText.value.trim().split(/\s+/).length : 0,
  lines: toolboxText.value ? toolboxText.value.split(/\r?\n/).length : 0,
}))
const toolboxDisplay = computed(() => `${String(Math.floor((toolboxTimerMode.value === 'countdown' ? toolboxCountdownRemaining.value : toolboxSeconds.value) / 60)).padStart(2, '0')}:${String((toolboxTimerMode.value === 'countdown' ? toolboxCountdownRemaining.value : toolboxSeconds.value) % 60).padStart(2, '0')}`)

function resetToolboxTimer() {
  toolboxTimerRunning.value = false
  if (toolboxTimer) window.clearInterval(toolboxTimer)
  toolboxTimer = undefined
  toolboxSeconds.value = 0
  toolboxCountdownRemaining.value = Math.max(1, Math.round(Number(toolboxCountdownMinutes.value) || 5)) * 60
}

function toggleToolboxTimer() {
  if (toolboxTimerRunning.value) {
    toolboxTimerRunning.value = false
    window.clearInterval(toolboxTimer)
    toolboxTimer = undefined
    return
  }
  if (toolboxTimerMode.value === 'countdown' && toolboxCountdownRemaining.value <= 0) toolboxCountdownRemaining.value = Math.max(1, Math.round(Number(toolboxCountdownMinutes.value) || 5)) * 60
  toolboxTimerRunning.value = true
  toolboxTimer = window.setInterval(() => {
    if (toolboxTimerMode.value === 'countdown') {
      if (toolboxCountdownRemaining.value <= 1) {
        toolboxCountdownRemaining.value = 0
        toolboxTimerRunning.value = false
        window.clearInterval(toolboxTimer)
        toolboxTimer = undefined
        notify('倒计时已结束', 'info')
        return
      }
      toolboxCountdownRemaining.value -= 1
    } else toolboxSeconds.value += 1
  }, 1_000)
}

function applyCountdownMinutes() {
  if (toolboxTimerRunning.value) return
  toolboxCountdownRemaining.value = Math.max(1, Math.round(Number(toolboxCountdownMinutes.value) || 5)) * 60
}

function transformToolboxText(mode) {
  const value = toolboxText.value
  if (mode === 'strip') toolboxTextOutput.value = value.replace(/[*_`~>#-]/g, '').replace(/\s{2,}/g, ' ').trim()
  else if (mode === 'upper') toolboxTextOutput.value = value.toLocaleUpperCase()
  else if (mode === 'lower') toolboxTextOutput.value = value.toLocaleLowerCase()
  else if (mode === 'title') toolboxTextOutput.value = value.replace(/(^|\s)(\S)/g, (_, prefix, char) => `${prefix}${char.toLocaleUpperCase()}`)
  else toolboxTextOutput.value = value
}

async function copyToolboxText() {
  if (!toolboxTextOutput.value) return
  try {
    await navigator.clipboard.writeText(toolboxTextOutput.value)
    notify('文本已复制')
  } catch {
    notify('当前环境无法访问剪贴板', 'info')
  }
}

// Meeting minutes
const meetingDraft = ref({ title: '', attendees: '', date: localDateTimeValue(Date.now()), keyPoints: '', actions: '' })
const selectedMeetingId = ref('')
const selectedMeeting = computed(() => meetings.value.find((meeting) => meeting.id === selectedMeetingId.value) || null)

function saveMeeting({ silent = false } = {}) {
  const draft = meetingDraft.value
  if (!draft.title.trim()) {
    if (!silent) notify('请输入会议主题', 'error')
    return null
  }
  const saved = normalizeMeetings([{
    id: createId('meeting'),
    ...draft,
    createdAt: Date.now(),
  }])[0]
  if (!saved) return null
  meetings.value = [saved, ...meetings.value].slice(0, 60)
  selectedMeetingId.value = saved.id
  if (!silent) notify('会议纪要已保存')
  return saved
}

function extractMeetingTodos() {
  const lines = meetingDraft.value.actions.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*・]|\[[ xX]\])\s*/, '').trim()).filter(Boolean)
  if (!lines.length) return notify('请先在行动项中逐行填写待办', 'info')
  lines.forEach((line) => addTodoRecord(line, { category: 'work', tags: ['会议'] }))
  const saved = saveMeeting({ silent: true })
  const note = {
    id: createId('note'),
    title: meetingDraft.value.title.trim().slice(0, 200),
    content: `参会人：${meetingDraft.value.attendees.trim()}\n\n核心要点：\n${meetingDraft.value.keyPoints.trim()}\n\n行动项：\n${lines.map((line) => `- ${line}`).join('\n')}`.slice(0, 20_000),
    category: 'memo',
    color: 'blue',
    order: notes.value.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  notes.value = normalizeAssistantNotes([note, ...notes.value])
  if (saved) selectedMeetingId.value = saved.id
  notify(`已提取 ${lines.length} 项待办，并生成结构化便签`)
}

function loadMeeting(meeting) {
  selectedMeetingId.value = meeting.id
  meetingDraft.value = { title: meeting.title, attendees: meeting.attendees, date: meeting.date, keyPoints: meeting.keyPoints, actions: meeting.actions }
}

// Templates
const templates = [
  { id: 'daily-plan', type: 'todo', title: '每日工作计划', description: '快速建立当天的工作骨架', items: ['整理今日重点', '处理待回复消息', '回顾并记录进展'] },
  { id: 'weekly-list', type: 'todo', title: '周工作清单', description: '按工作、沟通、复盘拆分一周事项', items: ['本周重点目标', '跨团队沟通事项', '周五复盘与下周计划'] },
  { id: 'project-follow', type: 'todo', title: '项目跟进清单', description: '跟踪里程碑、风险和下一步', items: ['确认项目里程碑', '更新风险与依赖', '同步下一步负责人'] },
  { id: 'meeting-note', type: 'note', title: '会议纪要模板', description: '记录主题、决策与行动项', content: '会议主题：\n参会人：\n\n核心要点：\n\n决策：\n\n行动项：\n' },
  { id: 'daily-review', type: 'note', title: '每日复盘模板', description: '沉淀完成事项与改进点', content: '今天完成：\n\n遇到的问题：\n\n明日最重要的一件事：\n' },
  { id: 'issue-record', type: 'note', title: '问题记录模板', description: '让问题、影响和处理结果可追踪', content: '问题描述：\n影响范围：\n复现步骤：\n处理方案：\n结论：\n' },
]

function applyTemplate(template) {
  if (template.type === 'todo') {
    template.items.forEach((item) => addTodoRecord(item, { category: template.id === 'project-follow' ? 'project-a' : 'work', tags: ['模板'] }))
    assistantTab.value = 'todos'
    notify(`已添加 ${template.items.length} 项待办`)
  } else {
    const now = Date.now()
    const note = { id: createId('note'), title: template.title, content: template.content, category: 'memo', color: 'blue', order: notes.value.length, createdAt: now, updatedAt: now }
    notes.value = normalizeAssistantNotes([note, ...notes.value])
    activeNoteId.value = note.id
    assistantTab.value = 'notes'
    notify('模板已套用到新便签')
  }
}

// Backup and import
const backupFileInput = ref(null)

function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function exportAssistantJson() {
  const payload = {
    kind: 'efficiency-assistant-backup',
    version: ASSISTANT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    assistant: normalizeAssistantState(assistant.value),
  }
  downloadText(`efficiency-assistant-${dateKey(Date.now())}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
  notify('助手数据 JSON 已导出')
}

function exportAssistantCsv() {
  downloadText(`efficiency-todos-${dateKey(Date.now())}.csv`, exportTodosCsv(todos.value), 'text/csv;charset=utf-8')
  notify('待办 CSV 已导出')
}

function triggerBackupImport() {
  backupFileInput.value?.click()
}

async function importAssistantBackup(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text())
    const candidate = parsed?.assistant || parsed
    const next = normalizeAssistantState(candidate)
    if (!next.todos.length && !next.notes.length && !next.reminders.length && !next.meetings.length) {
      notify('备份中没有可导入的助手数据', 'error')
      return
    }
    if (!window.confirm('导入会替换当前效率助手数据，是否继续？')) return
    assistant.value = next
    activeNoteId.value = next.notes[0]?.id || ''
    focusProfileId.value = next.focus.activeProfileId
    resetFocusTimer()
    persistAssistant()
    notify('助手数据已导入')
  } catch {
    notify('备份文件格式无效', 'error')
  }
}

function handleAssistantKeydown(event) {
  if (!event.ctrlKey || !event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 't') {
    event.preventDefault()
    assistantTab.value = 'todos'
    window.setTimeout(() => document.querySelector('#assistant-todo-input')?.focus(), 0)
  } else if (key === 'n') {
    event.preventDefault()
    assistantTab.value = 'notes'
    if (!activeNote.value) createNote()
    window.setTimeout(() => document.querySelector('#assistant-note-editor')?.focus(), 0)
  } else if (key === 'f') {
    event.preventDefault()
    assistantTab.value = 'focus'
    if (!focusRunning.value) startFocus()
  }
}

onMounted(() => {
  persistAssistant()
  clockTimer = window.setInterval(() => {
    assistantNow.value = Date.now()
  }, 15_000)
  window.addEventListener('keydown', handleAssistantKeydown)
  window.addEventListener('efficiency:reminder', handleReminderSchedulerEvent)
  window.addEventListener('efficiency-state-remote', handleRemoteAssistantState)
  resetFocusTimer()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleAssistantKeydown)
  window.removeEventListener('efficiency:reminder', handleReminderSchedulerEvent)
  window.removeEventListener('efficiency-state-remote', handleRemoteAssistantState)
  window.clearInterval(clockTimer)
  window.clearInterval(toolboxTimer)
  if (focusTimer.value) window.clearInterval(focusTimer.value)
  clearTimeout(persistTimer)
  clearTimeout(noteSaveTimer)
  stopWhiteNoise()
  if (!applyingRemoteState) persistAssistant()
})
</script>

<template>
  <section class="assistant-workspace" aria-label="效率助手">
    <div class="assistant-workspace-toolbar">
      <div class="assistant-tablist" role="tablist" aria-label="效率助手功能">
        <ToolEntryCard
          v-for="tab in assistantTabs"
          :key="tab.id"
          role="tab"
          :aria-selected="assistantTab === tab.id"
          :active="assistantTab === tab.id"
          :label="tab.label"
          :description="tab.description"
          :icon="tab.icon"
          :status="tab.status"
          :status-class="tab.statusClass"
          @click="selectTab(tab.id)"
        />
      </div>
      <div class="assistant-data-actions">
        <button class="icon-button" type="button" title="导出 JSON" aria-label="导出效率助手 JSON" @click="exportAssistantJson"><FileDown :size="16" /></button>
        <button class="icon-button" type="button" title="导出待办 CSV" aria-label="导出待办 CSV" @click="exportAssistantCsv"><Download :size="16" /></button>
        <button class="icon-button" type="button" title="导入备份" aria-label="导入效率助手备份" @click="triggerBackupImport"><FileUp :size="16" /></button>
        <input ref="backupFileInput" class="assistant-hidden-input" type="file" accept="application/json,.json" @change="importAssistantBackup" />
      </div>
    </div>

    <section v-if="assistantTab === 'overview'" class="assistant-overview">
      <div class="assistant-section-heading">
        <div><p class="eyebrow">效率助手</p><h2>今天的工作节奏</h2><p>把任务、专注和提醒放在同一处，所有数据默认保存在本机。</p></div>
        <div class="assistant-heading-actions">
          <button class="outline-button" type="button" @click="selectTab('todos')"><Plus :size="15" /> 新建待办</button>
          <button class="primary-button" type="button" @click="selectTab('focus')"><Play :size="15" /> 开始专注</button>
        </div>
      </div>

      <div class="assistant-kpi-grid">
        <div class="assistant-kpi"><span>待办完成率</span><strong>{{ todoCompletionRate }}%</strong><small>{{ completedTodoCount }}/{{ todos.length }} 项已完成</small></div>
        <div class="assistant-kpi"><span>今日专注</span><strong>{{ formatDuration(focusStats.todayMinutes) }}</strong><small>{{ focusStats.todayPomodoros }} 个番茄</small></div>
        <div class="assistant-kpi"><span>提醒履约率</span><strong>{{ reminderStats.rate }}%</strong><small>{{ reminderStats.fulfilled }}/{{ reminderStats.total || 0 }} 已完成</small></div>
        <div class="assistant-kpi attention"><span>逾期待办</span><strong>{{ overdueTodos.length }}</strong><small>优先处理重要事项</small></div>
      </div>

      <div class="assistant-overview-grid">
        <section class="assistant-panel dashboard-panel" aria-labelledby="assistant-dashboard-title">
          <div class="assistant-panel-heading"><div><h3 id="assistant-dashboard-title">效率趋势</h3><p>{{ dashboardPeriodLabel }}专注汇总与任务分类分布</p></div><div class="segmented-control compact-segment" role="group" aria-label="仪表盘统计周期"><button type="button" :class="{ active: dashboardPeriod === 'day' }" :aria-pressed="dashboardPeriod === 'day'" @click="dashboardPeriod = 'day'">日</button><button type="button" :class="{ active: dashboardPeriod === 'week' }" :aria-pressed="dashboardPeriod === 'week'" @click="dashboardPeriod = 'week'">周</button><button type="button" :class="{ active: dashboardPeriod === 'month' }" :aria-pressed="dashboardPeriod === 'month'" @click="dashboardPeriod = 'month'">月</button></div></div>
          <div class="focus-trend" aria-label="近七日专注趋势">
            <div v-for="point in focusStats.trend" :key="point.key" class="focus-trend-column"><div class="focus-trend-bar-wrap"><span class="focus-trend-bar" :style="{ height: `${Math.max(6, point.minutes / focusTrendMax * 100)}%` }" :title="`${point.label} ${point.minutes} 分钟`"></span></div><small>{{ point.label }}</small><strong>{{ point.minutes }}</strong></div>
          </div>
          <div class="dashboard-period-summary" :aria-label="`${dashboardPeriodLabel}统计`">
            <div><span>{{ dashboardPeriodLabel }}完成待办</span><strong>{{ dashboardTodoStats.completed }}</strong><small>新建 {{ dashboardTodoStats.created }} 项</small></div>
            <div><span>{{ dashboardPeriodLabel }}专注</span><strong>{{ formatDuration(dashboardFocusStats.minutes) }}</strong><small>{{ dashboardFocusStats.pomodoros }} 个番茄</small></div>
            <div><span>当前逾期待办</span><strong class="danger">{{ dashboardTodoStats.overdue }}</strong><small>未完成事项</small></div>
          </div>
          <div class="category-breakdown"><div v-for="item in todoCategoryStats" :key="item.id" class="category-line"><span>{{ item.label }}</span><span class="category-track"><i :style="{ width: `${item.count / categoryMax * 100}%` }"></i></span><b>{{ item.count }}</b></div><p v-if="!todoCategoryStats.length" class="empty-inline">添加待办后会显示分类占比</p></div>
        </section>
        <section class="assistant-panel quick-actions-panel" aria-labelledby="assistant-quick-title">
          <div class="assistant-panel-heading"><div><h3 id="assistant-quick-title">快捷入口</h3><p>常用动作无需离开当前页面</p></div><Zap :size="17" /></div>
          <div class="assistant-quick-grid"><button type="button" @click="selectTab('todos')"><ClipboardList :size="17" /><span>整理待办</span><small>{{ todos.length }} 项</small></button><button type="button" @click="selectTab('reminders')"><CalendarPlus :size="17" /><span>添加提醒</span><small>{{ reminders.length }} 条</small></button><button type="button" @click="selectTab('notes')"><FileText :size="17" /><span>记录便签</span><small>{{ notes.length }} 张</small></button><button type="button" @click="selectTab('toolbox')"><Clock4 :size="17" /><span>打开工具箱</span><small>计时与文本</small></button></div>
          <div class="assistant-overview-links"><button v-if="overdueTodos.length" class="overview-alert" type="button" @click="selectTab('todos')"><Bell :size="15" /><span>{{ overdueTodos.length }} 项待办已逾期</span><ArrowRight :size="14" /></button><button v-for="reminder in filteredReminders.slice(0, 2)" :key="reminder.id" type="button" @click="selectTab('reminders')"><CalendarDays :size="14" /><span>{{ reminder.title }}</span><small>{{ reminderDisplay(reminder) }}</small></button><p v-if="!overdueTodos.length && !filteredReminders.length" class="empty-inline">暂无需要处理的提醒</p></div>
        </section>
      </div>
    </section>

    <section v-else-if="assistantTab === 'todos'" class="assistant-panel assistant-feature-panel" aria-labelledby="assistant-todo-title">
      <div class="assistant-section-heading"><div><p class="eyebrow">任务管理</p><h2 id="assistant-todo-title">待办清单</h2><p>优先级、截止时间、标签和子任务共同构成可执行的任务视图。</p></div><div class="assistant-heading-actions"><span class="assistant-stat-chip"><CheckCircle2 :size="14" /> {{ todoCompletionRate }}% 完成</span><span v-if="overdueTodos.length" class="assistant-stat-chip danger"><Bell :size="14" /> {{ overdueTodos.length }} 项逾期</span></div></div>
      <form class="todo-create-form" @submit.prevent="addTodo">
        <label class="todo-create-main">待办内容<input id="assistant-todo-input" v-model="newTodo" class="form-control" type="text" maxlength="200" placeholder="例如：完成季度项目复盘" /></label>
        <label>优先级<select v-model="newTodoPriority" class="form-select"><option v-for="item in TODO_PRIORITIES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
        <label>分类<select v-model="newTodoCategory" class="form-select"><option v-for="item in TODO_CATEGORIES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
        <label>标签<input v-model="newTodoTags" class="form-control" type="text" maxlength="120" placeholder="项目 A, 本周" /></label>
        <label>截止时间<input v-model="newTodoDueAt" class="form-control" type="datetime-local" /></label>
        <label>首个子任务<input v-model="newTodoSubtask" class="form-control" type="text" maxlength="160" placeholder="可选" /></label>
        <label class="check-option todo-reminder-toggle"><input v-model="newTodoCreateReminder" type="checkbox" /><span>截止时间同步提醒</span></label>
        <button class="primary-button" type="submit"><Plus :size="15" /> 添加待办</button>
      </form>
      <div class="todo-toolbar">
        <label class="todo-search"><Search :size="15" /><input v-model="todoQuery" type="search" placeholder="搜索待办或标签" aria-label="搜索待办" /></label>
        <label><span class="sr-only">优先级筛选</span><select v-model="todoFilterPriority" class="form-select"><option value="all">全部优先级</option><option v-for="item in TODO_PRIORITIES" :key="item.id" :value="item.id">{{ item.label }}优先级</option></select></label>
        <label><span class="sr-only">分类筛选</span><select v-model="todoFilterCategory" class="form-select"><option value="all">全部分类</option><option v-for="item in TODO_CATEGORIES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
        <label><span class="sr-only">排序</span><select v-model="todoSortMode" class="form-select"><option value="smart">智能排序</option><option value="priority">按优先级</option><option value="due">按截止时间</option><option value="manual">手动顺序</option></select></label>
        <label class="check-option"><input v-model="todoShowCompleted" type="checkbox" /><span>显示已完成</span></label>
        <div class="todo-view-toggle" role="group" aria-label="待办视图"><button type="button" :class="{ active: todoViewMode === 'list' }" :aria-pressed="todoViewMode === 'list'" @click="todoViewMode = 'list'"><ClipboardList :size="15" /> 列表</button><button type="button" :class="{ active: todoViewMode === 'quadrant' }" :aria-pressed="todoViewMode === 'quadrant'" @click="todoViewMode = 'quadrant'"><LayoutGrid :size="15" /> 四象限</button></div>
      </div>
      <div v-if="visibleTodos.length" class="todo-select-row"><label class="check-option"><input type="checkbox" :checked="visibleTodos.length > 0 && visibleTodos.every((todo) => selectedTodoIds.includes(todo.id))" @change="toggleVisibleTodoSelection" /><span>选择当前 {{ visibleTodos.length }} 项</span></label><span v-if="selectedTodoIds.length" class="selected-count">已选 {{ selectedTodoIds.length }} 项</span></div>
      <div v-if="selectedTodoIds.length" class="bulk-action-bar"><strong>批量操作</strong><button class="outline-button" type="button" @click="bulkComplete"><Check :size="14" /> 完成</button><button class="outline-button" type="button" @click="bulkDelete"><Trash2 :size="14" /> 删除</button><label>优先级<select v-model="bulkPriority" class="form-select"><option v-for="item in TODO_PRIORITIES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label>分类<select v-model="bulkCategory" class="form-select"><option v-for="item in TODO_CATEGORIES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><button class="primary-button" type="button" @click="bulkUpdateTodoMeta"><CheckSquare2 :size="14" /> 应用</button></div>
      <div v-if="todoViewMode === 'list'" class="todo-enhanced-list">
        <article v-for="todo in visibleTodos" :key="todo.id" class="todo-enhanced-row" :class="[{ done: todo.done, overdue: isTodoOverdue(todo, assistantNow) }, `priority-${todo.priority}`]" draggable="true" @dragstart="startTodoDrag(todo)" @dragover.prevent @drop="dropTodo(todo)">
          <GripVertical class="drag-handle" :size="16" aria-hidden="true" />
          <input type="checkbox" :checked="selectedTodoIds.includes(todo.id)" :aria-label="`选择待办 ${todo.text}`" @change="toggleTodoSelection(todo)" />
          <input class="todo-done-check" type="checkbox" :checked="todo.done" :aria-label="`完成待办 ${todo.text}`" @change="toggleTodo(todo)" />
          <div class="todo-enhanced-main">
            <div class="todo-title-line"><strong>{{ todo.text }}</strong><span class="priority-badge" :class="todo.priority">{{ todoPriorityLabel(todo.priority) }}优先</span><span class="category-badge">{{ todoCategoryLabel(todo.category) }}</span><span v-for="tag in todo.tags" :key="tag" class="tag-badge">#{{ tag }}</span></div>
            <div class="todo-meta-line"><span :class="{ overdue: isTodoOverdue(todo, assistantNow) }"><CalendarDays :size="13" /> {{ todoDueLabel(todo) }}</span><span v-if="todo.focusMinutes"><Timer :size="13" /> 已专注 {{ todo.focusMinutes }} 分钟</span><span v-if="todo.subtasks?.length"><CheckSquare2 :size="13" /> {{ todo.subtasks.filter((item) => item.done).length }}/{{ todo.subtasks.length }} 子任务</span></div>
            <div v-if="todo.subtasks?.length" class="subtask-list"><label v-for="subtask in todo.subtasks" :key="subtask.id"><input type="checkbox" :checked="subtask.done" @change="toggleSubtask(todo, subtask)" /><span :class="{ done: subtask.done }">{{ subtask.text }}</span><button class="icon-button tiny" type="button" :aria-label="`删除子任务 ${subtask.text}`" @click="removeSubtask(todo, subtask)"><X :size="12" /></button></label></div>
            <form class="subtask-add-form" @submit.prevent="addSubtask(todo)"><input v-model="todoSubtaskDrafts[todo.id]" type="text" maxlength="160" placeholder="添加子任务" :aria-label="`为 ${todo.text} 添加子任务`" /><button class="icon-button tiny" type="submit" aria-label="添加子任务"><Plus :size="13" /></button></form>
          </div>
          <div class="todo-inline-fields"><select v-model="todo.priority" class="compact-select" :aria-label="`${todo.text} 优先级`" @change="updateTodo(todo)"><option v-for="item in TODO_PRIORITIES" :key="item.id" :value="item.id">{{ item.label }}</option></select><select v-model="todo.category" class="compact-select" :aria-label="`${todo.text} 分类`" @change="updateTodo(todo)"><option v-for="item in TODO_CATEGORIES" :key="item.id" :value="item.id">{{ item.label }}</option></select><input :value="todo.dueAt" class="compact-date" type="datetime-local" :aria-label="`${todo.text} 截止时间`" @change="todo.dueAt = $event.target.value; updateTodo(todo)" /><button class="icon-button" type="button" :aria-label="`删除待办 ${todo.text}`" @click="deleteTodo(todo)"><Trash2 :size="15" /></button></div>
        </article>
      </div>
      <div v-else class="quadrant-grid"><section v-for="group in quadrantGroups" :key="group.id" class="quadrant-cell" :class="group.color"><div class="quadrant-heading"><div><h3>{{ group.label }}</h3><small>{{ group.hint }}</small></div><span>{{ visibleTodos.filter((todo) => todoQuadrant(todo) === group.id).length }}</span></div><button v-for="todo in visibleTodos.filter((item) => todoQuadrant(item) === group.id)" :key="todo.id" class="quadrant-item" type="button" @click="todoViewMode = 'list'; todoQuery = todo.text"><input type="checkbox" :checked="todo.done" readonly /><span>{{ todo.text }}</span></button><p v-if="!visibleTodos.some((todo) => todoQuadrant(todo) === group.id)" class="empty-inline">暂无任务</p></section></div>
      <div v-if="!visibleTodos.length" class="assistant-empty"><ClipboardList :size="26" /><strong>暂无匹配待办</strong><span>调整筛选条件或添加第一项任务。</span></div>
    </section>

    <section v-else-if="assistantTab === 'focus'" class="assistant-feature-panel">
      <div class="assistant-section-heading"><div><p class="eyebrow">专注管理</p><h2>番茄钟</h2><p>支持自定义方案、自动循环、白噪音和待办投入时长统计。</p></div><div class="assistant-heading-actions"><span class="assistant-stat-chip"><Timer :size="14" /> {{ focusStats.todayPomodoros }} 个番茄</span><span class="assistant-stat-chip"><Clock4 :size="14" /> {{ formatDuration(focusStats.weekMinutes) }} / 周</span></div></div>
      <div class="focus-summary-grid"><div><span>今日</span><strong>{{ formatDuration(focusStats.todayMinutes) }}</strong></div><div><span>本周</span><strong>{{ formatDuration(focusStats.weekMinutes) }}</strong></div><div><span>本月</span><strong>{{ formatDuration(focusStats.monthMinutes) }}</strong></div><div><span>已关联任务</span><strong>{{ Object.keys(focusStats.byTodo).length }}</strong></div></div>
      <div class="focus-layout">
        <section class="assistant-panel focus-timer-panel"><div class="assistant-panel-heading"><div><h3>{{ focusModeLabel }}</h3><p>{{ activeFocusProfile.name }} · 第 {{ focusCycleCount + 1 }} 个番茄</p></div><Timer :size="18" /></div><div class="timer-ring enhanced"><div><strong>{{ focusDisplay }}</strong><span>{{ focusRunning ? '进行中' : '已暂停' }}</span></div></div><div class="focus-controls"><button class="primary-button" type="button" @click="toggleFocus"><Pause v-if="focusRunning" :size="16" /><Play v-else :size="16" /> {{ focusRunning ? '暂停' : '开始' }}</button><button class="outline-button" type="button" @click="skipFocusPhase"><ArrowRight :size="15" /> 跳过阶段</button><button class="icon-button" type="button" aria-label="重置番茄钟" @click="resetFocusTimer"><TimerReset :size="17" /></button></div><div class="focus-link-row"><label>关联待办<select v-model="focusTodoId" class="form-select"><option value="">不关联</option><option v-for="todo in todos.filter((item) => !item.done)" :key="todo.id" :value="todo.id">{{ todo.text }}</option></select></label><label class="check-option"><input v-model="focus.settings.autoCycle" type="checkbox" /><span>自动循环</span></label></div><div class="focus-noise-row"><label class="check-option"><input type="checkbox" :checked="focus.settings.whiteNoise" @change="toggleWhiteNoise" /><span>{{ focus.settings.whiteNoise ? '白噪音播放中' : '白噪音' }}</span></label><select v-model="focus.settings.noiseType" class="compact-select" :disabled="focusRunning" aria-label="白噪音类型"><option value="rain">雨声</option><option value="cafe">咖啡馆</option></select><Volume2 v-if="focus.settings.whiteNoise" :size="15" /><VolumeX v-else :size="15" /></div></section>
        <section class="assistant-panel focus-profile-panel"><div class="assistant-panel-heading"><div><h3>时长方案</h3><p>保存多套工作与休息节奏</p></div><button class="icon-button" type="button" aria-label="新增专注方案" @click="profileEditorOpen = !profileEditorOpen"><Plus :size="16" /></button></div><label>当前方案<select v-model="focusProfileId" class="form-select"><option v-for="profile in focus.profiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.workMinutes }}/{{ profile.shortBreakMinutes }}/{{ profile.longBreakMinutes }} 分钟</option></select></label><div class="profile-list"><div v-for="profile in focus.profiles" :key="profile.id" class="profile-row"><div><strong>{{ profile.name }}</strong><small>工作 {{ profile.workMinutes }} 分钟 · 短休 {{ profile.shortBreakMinutes }} 分钟 · 长休 {{ profile.longBreakMinutes }} 分钟 / {{ profile.longBreakEvery }} 个番茄</small></div><button v-if="!DEFAULT_FOCUS_PROFILES.some((item) => item.id === profile.id)" class="icon-button tiny" type="button" :aria-label="`删除方案 ${profile.name}`" @click="removeProfile(profile)"><Trash2 :size="13" /></button></div></div><form v-if="profileEditorOpen" class="profile-editor" @submit.prevent="saveProfile"><label>方案名称<input v-model="profileDraft.name" class="form-control" maxlength="40" placeholder="例如：会议日" /></label><div class="form-grid three"><label>工作<input v-model="profileDraft.workMinutes" class="form-control" type="number" min="1" max="180" /></label><label>短休<input v-model="profileDraft.shortBreakMinutes" class="form-control" type="number" min="1" max="60" /></label><label>长休<input v-model="profileDraft.longBreakMinutes" class="form-control" type="number" min="1" max="120" /></label></div><label>每几个番茄触发长休<input v-model="profileDraft.longBreakEvery" class="form-control" type="number" min="1" max="12" /></label><button class="primary-button" type="submit"><Check :size="15" /> 保存方案</button></form></section>
      </div>
      <section class="assistant-panel focus-trend-panel"><div class="assistant-panel-heading"><div><h3>近七日趋势</h3><p>完成的专注时段会自动计入统计</p></div><BarChart3 :size="18" /></div><div class="focus-trend large"><div v-for="point in focusStats.trend" :key="point.key" class="focus-trend-column"><div class="focus-trend-bar-wrap"><span class="focus-trend-bar" :style="{ height: `${Math.max(6, point.minutes / focusTrendMax * 100)}%` }"></span></div><small>{{ point.label }}</small><strong>{{ point.minutes }} 分钟</strong></div></div></section>
    </section>

    <section v-else-if="assistantTab === 'reminders'" class="assistant-feature-panel">
      <div class="assistant-section-heading"><div><p class="eyebrow">日程管理</p><h2>日历提醒</h2><p>支持重复规则、提前提醒、月视图和星标置顶。</p></div><div class="assistant-heading-actions"><button class="outline-button" type="button" @click="calendarVisible = !calendarVisible"><CalendarDays :size="15" /> {{ calendarVisible ? '收起月历' : '展开月历' }}</button><span class="assistant-stat-chip"><Bell :size="14" /> {{ reminders.length }} 条</span></div></div>
      <div class="reminder-layout">
        <section v-if="calendarVisible" class="assistant-panel calendar-panel"><div class="calendar-heading"><button class="icon-button" type="button" aria-label="上个月" @click="moveCalendarMonth(-1)"><ChevronLeft :size="17" /></button><strong>{{ calendarMonthTitle }}</strong><button class="icon-button" type="button" aria-label="下个月" @click="moveCalendarMonth(1)"><ChevronRight :size="17" /></button></div><div class="calendar-weekdays"><span v-for="day in calendarWeekdays" :key="day">{{ day }}</span></div><div class="calendar-grid"><button v-for="cell in calendarCells" :key="cell.key" class="calendar-cell" :class="{ muted: !cell.inMonth, today: cell.isToday, selected: calendarSelectedDate === cell.key, 'has-reminder': remindersForDate(cell.key).length }" type="button" @click="selectCalendarDate(cell.key)"><span>{{ cell.day }}</span><i v-if="remindersForDate(cell.key).length">{{ remindersForDate(cell.key).length }}</i></button></div><button class="outline-button calendar-add-button" type="button" @click="selectCalendarDate(calendarSelectedDate)"><CalendarPlus :size="15" /> 在 {{ calendarSelectedDate }} 添加提醒</button></section>
        <section class="assistant-panel reminder-form-panel"><div class="assistant-panel-heading"><div><h3>新增提醒</h3><p>首次添加时可请求浏览器通知权限</p></div><CalendarPlus :size="18" /></div><form class="reminder-enhanced-form" @submit.prevent="addReminder"><label>提醒内容<input v-model="reminderTitle" class="form-control" type="text" maxlength="120" placeholder="例如：提交项目周报" /></label><label>时间<input v-model="reminderAt" class="form-control" type="datetime-local" /></label><div class="form-grid"><label>分类<select v-model="reminderCategory" class="form-select"><option v-for="item in REMINDER_CATEGORIES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label>提前提醒<select v-model="reminderAdvanceMinutes" class="form-select"><option :value="0">不提前</option><option :value="10">提前 10 分钟</option><option :value="60">提前 1 小时</option><option :value="1440">提前 1 天</option></select></label></div><div class="form-grid"><label>重复规则<select v-model="reminderRecurrence" class="form-select"><option v-for="item in REMINDER_RECURRENCES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label v-if="['custom'].includes(reminderRecurrence)">间隔天数<input v-model="reminderInterval" class="form-control" type="number" min="1" max="31" /></label><label v-else>关联待办<select v-model="reminderLinkedTodoId" class="form-select"><option value="">不关联</option><option v-for="todo in todos" :key="todo.id" :value="todo.id">{{ todo.text }}</option></select></label></div><label v-if="reminderRecurrence === 'weekly'" class="weekday-picker">每周<select v-model="reminderWeekdays" class="form-select" multiple aria-label="每周重复日期"><option v-for="(day, index) in ['日', '一', '二', '三', '四', '五', '六']" :key="day" :value="index">周{{ day }}</option></select></label><label v-if="reminderRecurrence === 'monthly'" class="field-hint">每月按当前日期重复</label><label class="check-option"><input v-model="reminderStarred" type="checkbox" /><span>星标置顶</span></label><button class="primary-button" type="submit"><Plus :size="15" /> 添加提醒</button></form></section>
      </div>
      <div class="reminder-list-toolbar"><label class="todo-search"><ListFilter :size="15" /><select v-model="reminderFilterCategory" class="form-select"><option value="all">全部提醒分类</option><option v-for="item in REMINDER_CATEGORIES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><span>{{ filteredReminders.length }} 条显示中</span></div>
      <div v-if="filteredReminders.length" class="reminder-enhanced-list"><article v-for="reminder in filteredReminders" :key="reminder.id" class="reminder-enhanced-row" :class="{ starred: reminder.starred }" draggable="true" @dragstart="startReminderDrag(reminder)" @dragover.prevent @drop="dropReminder(reminder)"><GripVertical class="drag-handle" :size="15" /><button class="star-button" type="button" :aria-label="`${reminder.starred ? '取消' : '添加'}星标 ${reminder.title}`" @click="toggleReminderStar(reminder)">{{ reminder.starred ? '★' : '☆' }}</button><div><strong>{{ reminder.title }}</strong><small>{{ reminderDisplay(reminder) }}</small></div><span class="category-badge">{{ reminderCategoryLabel(reminder.category) }}</span><span class="reminder-state" :class="{ done: reminder.notified }">{{ reminder.notified ? '已提醒' : '等待中' }}</span><button class="icon-button" type="button" :aria-label="`删除提醒 ${reminder.title}`" @click="deleteReminder(reminder)"><Trash2 :size="15" /></button></article></div><div v-else class="assistant-empty"><CalendarDays :size="26" /><strong>暂无提醒</strong><span>在月历中选择日期，或使用上方表单添加。</span></div>
    </section>

    <section v-else-if="assistantTab === 'notes'" class="assistant-feature-panel">
      <div class="assistant-section-heading"><div><p class="eyebrow">轻量信息卡</p><h2>快捷便签</h2><p>输入即自动保存，可按颜色和分类识别，也能一键转成待办或提醒。</p></div><div class="assistant-heading-actions"><span class="assistant-save-state"><Check :size="14" /> {{ noteSaveState }}</span><button class="primary-button" type="button" @click="createNote"><Plus :size="15" /> 新便签</button></div></div>
      <div class="notes-layout"><aside class="notes-sidebar"><label class="todo-search"><Search :size="15" /><input v-model="noteSearch" type="search" placeholder="搜索便签内容" aria-label="搜索便签" /></label><div class="notes-list"><button v-for="noteItem in visibleNotes" :key="noteItem.id" class="note-list-item" :class="[`note-${noteItem.color}`, { active: activeNoteId === noteItem.id }]" type="button" draggable="true" @click="activeNoteId = noteItem.id" @dragstart="startNoteDrag(noteItem)" @dragover.prevent @drop="dropNote(noteItem)"><GripVertical class="drag-handle" :size="13" /><span><strong>{{ noteItem.title || '无标题便签' }}</strong><small>{{ noteItem.content || '暂无内容' }}</small></span><em>{{ noteCategoryLabel(noteItem.category) }}</em></button><p v-if="!visibleNotes.length" class="empty-inline">暂无便签，点击“新便签”开始记录。</p></div></aside><section v-if="activeNote" class="assistant-panel note-editor-panel"><div class="note-editor-heading"><div><label for="assistant-note-title">标题<input id="assistant-note-title" v-model="activeNote.title" class="form-control" type="text" maxlength="200" @input="updateNote(activeNote)" /></label><span class="note-updated">{{ activeNote.content.length }} 字 · {{ noteSaveState }}</span></div><button class="icon-button" type="button" aria-label="删除当前便签" @click="deleteNote(activeNote)"><Trash2 :size="16" /></button></div><div class="note-editor-options"><label for="assistant-note-category">分类<select id="assistant-note-category" v-model="activeNote.category" class="form-select" @change="updateNote(activeNote)"><option v-for="item in NOTE_CATEGORIES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label for="assistant-note-color">颜色<select id="assistant-note-color" v-model="activeNote.color" class="form-select" @change="updateNote(activeNote)"><option value="yellow">黄色</option><option value="blue">蓝色</option><option value="red">红色</option><option value="green">绿色</option><option value="purple">紫色</option></select></label></div><textarea id="assistant-note-editor" v-model="activeNote.content" class="form-control note-editor-textarea" rows="16" maxlength="20000" placeholder="写下临时想法、会议关键词或下一步动作" @input="updateNote(activeNote)"></textarea><div class="note-editor-footer"><span>{{ activeNote.content.length }}/20,000 字</span><div><button class="outline-button" type="button" @click="convertNoteToTodo(activeNote)"><ClipboardCheck :size="15" /> 转为待办</button><button class="outline-button" type="button" @click="convertNoteToReminder(activeNote)"><CalendarPlus :size="15" /> 转为提醒</button><button class="icon-button" type="button" aria-label="复制便签内容" @click="toolboxTextOutput = activeNote.content; copyToolboxText()"><Copy :size="15" /></button></div></div></section><div v-else class="assistant-empty note-empty"><FileText :size="28" /><strong>还没有便签</strong><span>点击“新便签”创建第一张信息卡。</span><button class="primary-button" type="button" @click="createNote"><Plus :size="15" /> 新便签</button></div></div>
    </section>

    <section v-else-if="assistantTab === 'toolbox'" class="assistant-feature-panel">
      <div class="assistant-section-heading"><div><p class="eyebrow">办公轻工具</p><h2>工具箱</h2><p>会议计时、文本整理和常用工具入口集中在这里。</p></div><div class="assistant-heading-actions"><button class="outline-button" type="button" @click="openTool('qr')"><QrCode :size="15" /> 二维码</button><button class="outline-button" type="button" @click="openTool('unit')"><RefreshCw :size="15" /> 单位换算</button></div></div>
      <div class="toolbox-tabs" role="tablist" aria-label="工具箱功能"><button type="button" :class="{ active: toolboxMode === 'timer' }" @click="toolboxMode = 'timer'"><Clock4 :size="15" /> 计时器</button><button type="button" :class="{ active: toolboxMode === 'text' }" @click="toolboxMode = 'text'"><FileText :size="15" /> 文本处理</button></div>
      <section v-if="toolboxMode === 'timer'" class="toolbox-timer-panel"><div class="segmented-control"><button type="button" :class="{ active: toolboxTimerMode === 'stopwatch' }" @click="toolboxTimerMode = 'stopwatch'; resetToolboxTimer()"><Clock4 :size="14" /> 正计时</button><button type="button" :class="{ active: toolboxTimerMode === 'countdown' }" @click="toolboxTimerMode = 'countdown'; resetToolboxTimer()"><Timer :size="14" /> 倒计时</button></div><div class="toolbox-clock"><strong>{{ toolboxDisplay }}</strong><span>{{ toolboxTimerMode === 'stopwatch' ? '会议已进行' : '距离截止' }}</span></div><div v-if="toolboxTimerMode === 'countdown'" class="toolbox-countdown-input"><label>分钟<input v-model="toolboxCountdownMinutes" class="form-control short-input" type="number" min="1" max="600" @change="applyCountdownMinutes" /></label></div><div class="timer-actions"><button class="primary-button" type="button" @click="toggleToolboxTimer"><Pause v-if="toolboxTimerRunning" :size="16" /><Play v-else :size="16" /> {{ toolboxTimerRunning ? '暂停' : '开始' }}</button><button class="icon-button" type="button" aria-label="重置计时器" @click="resetToolboxTimer"><RefreshCw :size="16" /></button></div></section>
      <section v-else class="toolbox-text-panel"><div class="toolbox-text-grid"><div><label>输入文本<textarea v-model="toolboxText" class="form-control" rows="12" placeholder="粘贴需要清理或统计的文本"></textarea></label><div class="toolbox-text-stats"><span>{{ toolboxTextStats.chars }} 字符</span><span>{{ toolboxTextStats.noSpaceChars }} 非空格</span><span>{{ toolboxTextStats.words }} 词</span><span>{{ toolboxTextStats.lines }} 行</span></div></div><div><label>处理结果<textarea :value="toolboxTextOutput" class="form-control" rows="12" readonly placeholder="选择下方操作生成结果"></textarea></label><div class="toolbox-text-actions"><button class="outline-button" type="button" @click="transformToolboxText('strip')">去格式</button><button class="outline-button" type="button" @click="transformToolboxText('upper')">大写</button><button class="outline-button" type="button" @click="transformToolboxText('lower')">小写</button><button class="outline-button" type="button" @click="transformToolboxText('title')">首字母大写</button><button class="icon-button" type="button" aria-label="复制处理结果" @click="copyToolboxText"><Copy :size="15" /></button></div></div></div></section>
    </section>

    <section v-else-if="assistantTab === 'meeting'" class="assistant-feature-panel">
      <div class="assistant-section-heading"><div><p class="eyebrow">会议纪要助手</p><h2>快速记录与提取</h2><p>按结构记录会议，结束后将行动项同步为待办并生成便签存档。</p></div><span class="assistant-stat-chip"><Users :size="14" /> {{ meetings.length }} 份存档</span></div>
      <div class="meeting-layout"><section class="assistant-panel meeting-editor"><div class="form-grid"><label for="assistant-meeting-title">会议主题<input id="assistant-meeting-title" v-model="meetingDraft.title" class="form-control" maxlength="200" placeholder="例如：产品周会" /></label><label for="assistant-meeting-date">会议时间<input id="assistant-meeting-date" v-model="meetingDraft.date" class="form-control" type="datetime-local" /></label></div><label for="assistant-meeting-attendees">参会人<input id="assistant-meeting-attendees" v-model="meetingDraft.attendees" class="form-control" maxlength="500" placeholder="姓名或团队，用逗号分隔" /></label><label for="assistant-meeting-key-points">核心要点<textarea id="assistant-meeting-key-points" v-model="meetingDraft.keyPoints" class="form-control" rows="7" placeholder="记录背景、讨论要点和结论"></textarea></label><label for="assistant-meeting-actions">行动项（每行一项）<textarea id="assistant-meeting-actions" v-model="meetingDraft.actions" class="form-control" rows="7" placeholder="负责人 + 动作 + 截止时间"></textarea></label><div class="action-row"><button class="outline-button" type="button" @click="saveMeeting()"><Save :size="15" /> 保存纪要</button><button class="primary-button" type="button" @click="extractMeetingTodos"><ClipboardCheck :size="15" /> 提取待办并存档</button></div></section><aside class="assistant-panel meeting-history"><div class="assistant-panel-heading"><div><h3>最近纪要</h3><p>本机保存，随时可继续编辑</p></div><ClipboardList :size="18" /></div><button v-for="meeting in meetings" :key="meeting.id" class="meeting-history-item" type="button" :class="{ active: selectedMeetingId === meeting.id }" @click="loadMeeting(meeting)"><strong>{{ meeting.title }}</strong><small>{{ new Date(meeting.date).toLocaleString('zh-CN') }}</small></button><p v-if="!meetings.length" class="empty-inline">保存后的纪要会显示在这里。</p></aside></div>
    </section>

    <section v-else-if="assistantTab === 'templates'" class="assistant-feature-panel">
      <div class="assistant-section-heading"><div><p class="eyebrow">即用模板</p><h2>模板库</h2><p>从常用办公场景开始，减少重复编辑。</p></div><BookOpen :size="19" /></div><div class="template-grid"><article v-for="template in templates" :key="template.id" class="template-item"><div class="template-icon"><ClipboardList v-if="template.type === 'todo'" :size="20" /><FileText v-else :size="20" /></div><div><h3>{{ template.title }}</h3><p>{{ template.description }}</p><small v-if="template.items">{{ template.items.length }} 项待办</small><small v-else>结构化便签</small></div><button class="outline-button" type="button" @click="applyTemplate(template)"><Plus :size="15" /> 套用</button></article></div>
    </section>

    <section v-else-if="assistantTab === 'translation'" class="assistant-feature-panel assistant-translation-slot"><slot name="translation" :save-note="saveExternalNote"></slot></section>

    <section v-else-if="assistantTab === 'ai'" class="assistant-feature-panel assistant-ai-slot"><slot name="ai"></slot></section>
  </section>
</template>
