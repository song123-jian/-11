import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRANSLATION_MAX_CHARACTERS,
  buildTranslationMessages,
  canSwapTranslationLanguages,
  normalizeTranslationPreferences,
  safeTranslationTitle,
  translationPreferenceSummary,
  validateTranslationText,
} from '../src/services/translationTools.js'
import { createConsentDisclosure } from '../src/services/privacyConsent.js'
import { restoreTaskHistory, serializeTaskHistory } from '../src/services/taskHistoryTools.js'

test('translation preferences normalize safe source, target, style, and formatting values', () => {
  assert.deepEqual(normalizeTranslationPreferences({ sourceLanguage: 'en', targetLanguage: 'auto', style: 'formal', preserveFormatting: false }), {
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    style: 'formal',
    preserveFormatting: false,
  })
  assert.equal(translationPreferenceSummary({ sourceLanguage: 'en', targetLanguage: 'ja', style: 'concise' }), '英语 → 日语 · 简洁')
  assert.equal(safeTranslationTitle('en', 'zh-CN'), '翻译结果 · 英语 → 简体中文')
})

test('translation text validation rejects empty and oversized input without changing content', () => {
  assert.equal(validateTranslationText('  Hello\nWorld  '), '  Hello\nWorld  ')
  assert.throws(() => validateTranslationText('   '), /请输入需要翻译的原文/)
  assert.throws(() => validateTranslationText('x'.repeat(TRANSLATION_MAX_CHARACTERS + 1)), /不能超过/)
})

test('translation language swapping requires two explicit languages', () => {
  assert.equal(canSwapTranslationLanguages('en', 'zh-CN'), true)
  assert.equal(canSwapTranslationLanguages('auto', 'zh-CN'), false)
  assert.equal(canSwapTranslationLanguages('en', 'auto'), false)
})

test('translation messages preserve the source text and constrain model behavior', () => {
  const messages = buildTranslationMessages({
    text: 'Hello **world**\nhttps://example.test/{id}',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    style: 'formal',
    preserveFormatting: true,
  })
  assert.equal(messages.length, 2)
  assert.match(messages[0].content, /只输出译文/)
  assert.match(messages[1].content, /源语言：英语/)
  assert.match(messages[1].content, /目标语言：简体中文/)
  assert.match(messages[1].content, /保留原文的段落、换行/)
  assert.match(messages[1].content, /Hello \*\*world\*\*\nhttps:\/\/example\.test\/\{id\}/)
})

test('translation consent is purpose-scoped separately from generic relay content', () => {
  const provider = { provider: 'relay.example', providerKey: 'https://relay.example/v1' }
  const disclosure = createConsentDisclosure('translation', provider)
  assert.equal(disclosure.label, '翻译助手内容发送')
  assert.match(disclosure.purpose, /生成翻译结果/)
  assert.equal(createConsentDisclosure('translation', { providerKey: '' }), null)
})

test('translation task history keeps its controlled operation label', () => {
  const createdTimestamp = Date.UTC(2026, 8, 15)
  const stored = serializeTaskHistory([{
    id: `${createdTimestamp}-abcd1234`,
    operation: 'translation',
    label: '翻译助手',
    status: 'success',
    progress: 100,
    createdTimestamp,
    finishedTimestamp: createdTimestamp + 1_000,
  }])
  assert.equal(restoreTaskHistory(stored)[0].label, '翻译助手')
})
