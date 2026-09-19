import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const outputPath = path.resolve(root, 'output/performance/supply-chain-manifest.json')
const signatureOutputPath = path.resolve(root, 'output/performance/supply-chain-manifest.sig')

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relativePath), 'utf8'))
}

function hashFile(relativePath) {
  const filePath = path.resolve(root, relativePath)
  const bytes = fs.readFileSync(filePath)
  return {
    path: relativePath.replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  }
}

function commandVersion(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    if (process.platform === 'win32') {
      try {
        return execFileSync('cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], {
          cwd: root,
          encoding: 'utf8',
        }).trim()
      } catch {
        return 'unavailable'
      }
    }
    return 'unavailable'
  }
}

function signatureStatus(relativePath) {
  const filePath = path.resolve(root, relativePath)
  if (process.platform !== 'win32') return 'not-applicable'
  try {
    const command = `(Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(filePath)}).Status.ToString()`
    return execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim()
  } catch {
    return 'unavailable'
  }
}

function loadUpdateSigner() {
  const configuredPath = process.env.EFFICIENCY_UPDATE_SIGNING_PRIVATE_KEY?.trim()
  if (!configuredPath) return null
  const privateKeyPath = path.resolve(root, configuredPath)
  try {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath))
    const publicKey = crypto.createPublicKey(privateKey)
    return { privateKey, publicKey }
  } catch {
    throw new Error('EFFICIENCY_UPDATE_SIGNING_PRIVATE_KEY 不是有效的私钥文件')
  }
}

function parseCargoDependencies(relativePath) {
  const lines = fs.readFileSync(path.resolve(root, relativePath), 'utf8').split(/\r?\n/)
  const dependencies = {}
  let section = ''
  for (const line of lines) {
    const header = line.match(/^\[([^\]]+)\]$/)
    if (header) {
      section = header[1]
      continue
    }
    if (!['dependencies', 'dev-dependencies', 'build-dependencies'].includes(section)) continue
    const entry = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (entry) dependencies[`${section}:${entry[1]}`] = entry[2].trim()
  }
  return dependencies
}

function countMatches(text, pattern) {
  return text.match(pattern)?.length || 0
}

function installedFrontendLicenses(dependencies) {
  return Object.keys(dependencies).map((name) => {
    const packagePath = path.resolve(root, 'node_modules', name, 'package.json')
    try {
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
      return {
        name,
        version: packageData.version || 'unknown',
        license: packageData.license || packageData.licenses || 'unknown',
        source: 'node_modules',
      }
    } catch {
      return { name, version: 'unavailable', license: 'unavailable', source: 'node_modules' }
    }
  })
}

function cargoPackageLicenses() {
  try {
    const metadata = JSON.parse(execFileSync('cargo', [
      'metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1', '--locked',
    ], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }))
    return metadata.packages.map(({ name, version, license, source }) => ({
      name,
      version,
      license: license || 'unknown',
      source: source || 'workspace',
    }))
  } catch {
    return []
  }
}

const packageJson = readJson('package.json')
const tauriConfig = readJson('src-tauri/tauri.conf.json')
const pnpmLock = fs.readFileSync(path.resolve(root, 'pnpm-lock.yaml'), 'utf8')
const cargoLock = fs.readFileSync(path.resolve(root, 'src-tauri/Cargo.lock'), 'utf8')
const frontendDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
const cargoLicenses = cargoPackageLicenses()
const exe = 'src-tauri/target/release/efficiency_toolbox.exe'
const installer = `src-tauri/target/release/bundle/nsis/${tauriConfig.productName}_${tauriConfig.version}_x64-setup.exe`
const portable = `output/portable/${tauriConfig.productName}_${tauriConfig.version}_x64-portable/efficiency_toolbox.exe`
const artifactPaths = [exe, installer, ...(fs.existsSync(path.resolve(root, portable)) ? [portable] : [])]
const artifactSignatures = artifactPaths.map(signatureStatus)
const updateSigner = loadUpdateSigner()
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  project: {
    name: packageJson.name,
    version: packageJson.version,
    target: 'windows-x64',
  },
  toolchain: {
    node: process.version,
    pnpm: commandVersion('pnpm', ['--version']),
    rustc: commandVersion('rustc', ['--version']),
    cargo: commandVersion('cargo', ['--version']),
  },
  dependencies: {
    frontend: {
      production: packageJson.dependencies,
      development: packageJson.devDependencies,
      installedLicenses: installedFrontendLicenses(frontendDependencies),
      lockfilePackages: countMatches(pnpmLock, /^  (?:'[^']+'|[^\s:]+):$/gm),
    },
    rust: {
      manifest: parseCargoDependencies('src-tauri/Cargo.toml'),
      packageLicenses: cargoLicenses,
      packagesWithoutLicense: cargoLicenses.filter(({ license }) => license === 'unknown').map(({ name, version }) => ({ name, version })),
      lockfilePackages: countMatches(cargoLock, /^\[\[package\]\]$/gm),
    },
  },
  sourceManifests: [
    hashFile('package.json'),
    hashFile('pnpm-lock.yaml'),
    hashFile('src-tauri/Cargo.toml'),
    hashFile('src-tauri/Cargo.lock'),
  ],
  artifacts: artifactPaths.map((artifact) => ({ ...hashFile(artifact), signature: signatureStatus(artifact) })),
  signing: {
    packageSignatureRequired: true,
    updateManifestSignatureRequired: true,
    packageSignatureStatus: signatureStatus(installer),
    updateManifestSignatureStatus: updateSigner ? 'valid' : 'not-configured',
    updateManifestSignatureAlgorithm: updateSigner ? 'ed25519' : null,
    updateManifestSignaturePath: updateSigner ? path.relative(root, signatureOutputPath).replaceAll('\\', '/') : null,
    releaseQualified: artifactSignatures.every((status) => status === 'Valid') && Boolean(updateSigner),
    note: updateSigner
      ? '更新清单使用显式配置的 Ed25519 私钥生成 detached signature；代码包仍需通过 Authenticode 签名门禁。'
      : '当前工作区未配置代码签名证书或更新清单签名密钥；此清单记录事实，不替代签名。',
  },
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`
if (updateSigner) {
  const payload = Buffer.from(serializedManifest, 'utf8')
  const signature = crypto.sign(null, payload, updateSigner.privateKey)
  if (!crypto.verify(null, payload, updateSigner.publicKey, signature)) {
    throw new Error('更新清单签名自校验失败')
  }
  fs.writeFileSync(signatureOutputPath, `${signature.toString('base64')}\n`, 'utf8')
}
fs.writeFileSync(outputPath, serializedManifest, 'utf8')
console.log(JSON.stringify(manifest, null, 2))
