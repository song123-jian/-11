import fs from 'node:fs/promises'
import { createWorker } from 'tesseract.js'

const args = process.argv.slice(2)
const outputFlag = args.indexOf('--output')
const outputPath = outputFlag >= 0 && args[outputFlag + 1]
  ? args[outputFlag + 1]
  : 'output/performance/ocr-synthetic-baseline.json'
const imagePaths = args.filter((arg, index) => (
  arg !== '--output' && !(outputFlag >= 0 && index === outputFlag + 1)
)).length
  ? args.filter((arg, index) => arg !== '--output' && !(outputFlag >= 0 && index === outputFlag + 1))
  : Array.from({ length: 10 }, (_, index) => `output/playwright/ocr-synthetic-${index + 1}.png`)
const lineCount = 1000
const linesPerImage = lineCount / imagePaths.length

if (!Number.isInteger(linesPerImage)) throw new Error('OCR 样本图片数量必须能整除 1000 行')

function buildGroundTruth() {
  return Array.from({ length: lineCount }, (_, index) => (
    `第${String(index + 1).padStart(4, '0')}行：文档办公工具支持本地处理、可取消任务和清晰的隐私提示。`
  )).join('')
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, '')
}

function editDistance(left, right) {
  const previous = new Array(right.length + 1).fill(0)
  const current = new Array(right.length + 1).fill(0)
  for (let column = 0; column <= right.length; column += 1) previous[column] = column
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
    }
    for (let column = 0; column <= right.length; column += 1) previous[column] = current[column]
  }
  return previous[right.length]
}

const worker = await createWorker('chi_sim', undefined, {
  logger: ({ status, progress }) => {
    if (status === 'recognizing text' && progress >= 0.99) process.stderr.write('OCR recognition complete\n')
  },
})

const expected = buildGroundTruth()
const actualParts = []
const confidences = []
try {
  for (const imagePath of imagePaths) {
    const image = await fs.readFile(imagePath)
    const result = await worker.recognize(image)
    actualParts.push(normalizeText(result.data.text))
    confidences.push(result.data.confidence)
  }
} finally {
  await worker.terminate()
}

const actual = actualParts.join('')
const distance = editDistance(expected, actual)
const baseline = {
  sample: 'synthetic-chinese-printed-text',
  imagePaths,
  language: 'chi_sim',
  lines: lineCount,
  linesPerImage,
  expectedCharacters: expected.length,
  recognizedCharacters: actual.length,
  editDistance: distance,
  cer: Number((distance / expected.length).toFixed(6)),
  confidence: Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2)),
  measuredAt: new Date().toISOString(),
  qualifiesAsV2ReleaseGate: false,
  note: '合成浏览器栅格样本，仅用于工程基线；不能替代冻结参考设备上的真实中文印刷体测试集。',
}

await fs.writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(baseline, null, 2))
