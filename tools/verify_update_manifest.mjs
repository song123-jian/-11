import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fail(message, exitCode = 1) {
  console.error(`更新清单验签失败：${message}`)
  process.exitCode = exitCode
}

function parseArgs(argv) {
  const values = {}
  const names = new Set(['manifest', 'signature', 'public-key'])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      console.log('用法：node tools/verify_update_manifest.mjs [--manifest PATH] [--signature PATH] [--public-key PATH]')
      process.exit(0)
    }
    const inline = argument.match(/^--(manifest|signature|public-key)=(.*)$/)
    if (inline) {
      values[inline[1]] = inline[2]
      continue
    }
    const name = argument.match(/^--(manifest|signature|public-key)$/)?.[1]
    if (name) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`参数 ${argument} 缺少路径`)
      values[name] = value
      index += 1
      continue
    }
    if (argument.startsWith('--') || !names.has(argument)) throw new Error(`不支持的参数：${argument}`)
  }
  return values
}

function resolvePath(value, fallback) {
  const candidate = value?.trim() || fallback
  if (!candidate) throw new Error('路径不能为空')
  return path.resolve(process.cwd(), candidate)
}

function readBase64Signature(signaturePath) {
  const encoded = fs.readFileSync(signaturePath, 'utf8').replace(/[\t\n\r ]/g, '')
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('签名文件不是合法 Base64')
  }
  const signature = Buffer.from(encoded, 'base64')
  if (signature.length !== 64) throw new Error('Ed25519 签名长度必须为 64 字节')
  return signature
}

function verifyUpdateManifest({ manifestPath, signaturePath, publicKeyPath }) {
  const manifest = fs.readFileSync(manifestPath)
  const signature = readBase64Signature(signaturePath)
  const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath))
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`公钥算法必须为 Ed25519，实际为 ${publicKey.asymmetricKeyType || 'unknown'}`)
  }
  if (!crypto.verify(null, manifest, publicKey, signature)) throw new Error('签名与清单内容不匹配')
  return {
    verified: true,
    algorithm: 'ed25519',
    manifestSha256: crypto.createHash('sha256').update(manifest).digest('hex').toUpperCase(),
    manifest: path.relative(toolRoot, manifestPath).replaceAll('\\', '/'),
    signature: path.relative(toolRoot, signaturePath).replaceAll('\\', '/'),
    publicKey: path.relative(toolRoot, publicKeyPath).replaceAll('\\', '/'),
  }
}

try {
  const args = parseArgs(process.argv.slice(2))
  const manifestPath = resolvePath(
    args.manifest || process.env.EFFICIENCY_UPDATE_MANIFEST_PATH || process.env.EFFICIENCY_UPDATE_MANIFEST,
    path.join(toolRoot, 'output/performance/supply-chain-manifest.json'),
  )
  const signaturePath = resolvePath(
    args.signature || process.env.EFFICIENCY_UPDATE_SIGNATURE_PATH || process.env.EFFICIENCY_UPDATE_SIGNATURE,
    path.join(toolRoot, 'output/performance/supply-chain-manifest.sig'),
  )
  const publicKeyPath = resolvePath(
    args['public-key'] || process.env.EFFICIENCY_UPDATE_PUBLIC_KEY_PATH || process.env.EFFICIENCY_UPDATE_PUBLIC_KEY,
    '',
  )
  console.log(JSON.stringify(verifyUpdateManifest({ manifestPath, signaturePath, publicKeyPath }), null, 2))
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
