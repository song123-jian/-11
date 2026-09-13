import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const projectRoot = process.cwd()
const verifierPath = path.join(projectRoot, 'tools', 'verify_update_manifest.mjs')

function runVerifier(args, env = {}) {
  return spawnSync(process.execPath, [verifierPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

test('update manifest verifier accepts a valid signature and rejects tampering or malformed Base64', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'efficiency-update-signature-'))
  try {
    const manifestPath = path.join(tempRoot, 'manifest.json')
    const signaturePath = path.join(tempRoot, 'manifest.sig')
    const publicKeyPath = path.join(tempRoot, 'public-key.pem')
    const payload = Buffer.from('{"schemaVersion":1,"releaseQualified":false}\n', 'utf8')
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(manifestPath, payload)
    fs.writeFileSync(signaturePath, `${crypto.sign(null, payload, privateKey).toString('base64')}\n`, 'utf8')
    fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))

    const valid = runVerifier(['--manifest', manifestPath, '--signature', signaturePath, '--public-key', publicKeyPath])
    assert.equal(valid.status, 0, valid.stderr)
    assert.equal(JSON.parse(valid.stdout).verified, true)

    fs.writeFileSync(manifestPath, Buffer.from('{"schemaVersion":1,"releaseQualified":true}\n', 'utf8'))
    const tampered = runVerifier(['--manifest', manifestPath, '--signature', signaturePath, '--public-key', publicKeyPath])
    assert.notEqual(tampered.status, 0)
    assert.match(tampered.stderr, /不匹配/)

    fs.writeFileSync(signaturePath, 'not-base64!', 'utf8')
    const malformed = runVerifier(['--manifest', manifestPath, '--signature', signaturePath, '--public-key', publicKeyPath])
    assert.notEqual(malformed.status, 0)
    assert.match(malformed.stderr, /合法 Base64/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

