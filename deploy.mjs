#!/usr/bin/env node
// ============================================================================
// ASI Sample Token — Deploy Script
// ============================================================================
//
// Signs and submits fungible-token.rho to ASI:Chain DevNet via the validator
// API, then polls the GraphQL indexer until the deploy is included in a block.
// On success, writes deployment metadata to deployment.json.
//
// Usage:
//   PRIVATE_KEY=<hex>  node deploy.mjs
//   PRIVATE_KEY=<hex>  PHLO_LIMIT=3000000  node deploy.mjs
//
// Signing algorithm (per ASI:Chain / F1R3FLY spec):
//   1. Build proto3 projection: { term, timestamp, phloPrice=1, phloLimit,
//      validAfterBlockNumber, shardId="root" }  — `language` excluded
//   2. Blake2b-256 over the projection bytes
//   3. secp256k1 ECDSA sign, low-S, DER-encoded
//   4. Submit with full 65-byte uncompressed pubkey (04-prefix)
// ============================================================================

import { secp256k1 as secp } from '@noble/curves/secp256k1'
import { blake2b } from '@noble/hashes/blake2b'
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ----------------------------------------------------------------------------
// Network config
// ----------------------------------------------------------------------------
const NET = {
  // AWS proxy the wallet uses. Not officially stable — if this stops working,
  // open wallet.dev.asichain.io DevTools → Network → copy the /api/deploy base.
  validatorUrl: 'https://ihmps4dkpg.execute-api.us-east-1.amazonaws.com/prod/bb93eaa595aaddf6912e372debc73eef/endpoint_0/HTTP_API',
  indexerUrl: 'https://indexer.dev.asichain.io/v1/graphql',
  explorerUrl: 'https://explorer.dev.asichain.io',
  faucetUrl: 'https://faucet.dev.asichain.io',
  walletUrl: 'https://wallet.dev.asichain.io',
  shardId: 'root',
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTRACT_PATH = resolve(__dirname, 'fungible-token.rho')
const DEPLOYMENT_PATH = resolve(__dirname, 'deployment.json')

// ----------------------------------------------------------------------------
// Proto3 helpers — hand-rolled to avoid a protobuf dependency
// ----------------------------------------------------------------------------
function encodeVarint(value) {
  const bytes = []
  let v = BigInt(value)
  while (v > 127n) { bytes.push(Number((v & 0xffn) | 0x80n)); v >>= 7n }
  bytes.push(Number(v))
  return new Uint8Array(bytes)
}
const tag = (field, wire) => encodeVarint((field << 3) | wire)

function pbString(field, value) {
  if (!value) return new Uint8Array(0)
  const bytes = utf8ToBytes(value)
  return concatBytes(tag(field, 2), encodeVarint(bytes.length), bytes)
}
function pbInt64(field, value) {
  if (!value) return new Uint8Array(0)
  return concatBytes(tag(field, 0), encodeVarint(value))
}

// ----------------------------------------------------------------------------
// Deploy
// ----------------------------------------------------------------------------
async function deploy(term, privateKeyHex, phloLimit) {
  const privateKey = hexToBytes(privateKeyHex)
  const timestamp = Date.now()

  // Anchor to a recent block so the deploy is not considered stale
  const blocksRes = await fetch(`${NET.validatorUrl}/api/blocks/1`)
  if (!blocksRes.ok) throw new Error(`Block lookup failed: ${blocksRes.status} ${await blocksRes.text()}`)
  const blocks = await blocksRes.json()
  const validAfterBlockNumber = blocks?.[0]?.blockNumber ?? 0

  // Projection excludes `language` (critical — see signing algorithm above)
  const projection = concatBytes(
    pbString(2, term),
    pbInt64(3, timestamp),
    pbInt64(7, 1),
    pbInt64(8, phloLimit),
    pbInt64(10, validAfterBlockNumber),
    pbString(11, NET.shardId),
  )
  const hash = blake2b(projection, { dkLen: 32 })
  const sig = secp.sign(hash, privateKey, { lowS: true, format: 'der' })
  const pub = secp.getPublicKey(privateKey, false) // 65 bytes with 04 prefix

  const body = {
    data: {
      term,
      timestamp,
      phloPrice: 1,
      phloLimit,
      validAfterBlockNumber,
      shardId: NET.shardId,
      language: 'rholang',
    },
    deployer: bytesToHex(pub),
    signature: bytesToHex(sig),
    sigAlgorithm: 'secp256k1',
  }

  const res = await fetch(`${NET.validatorUrl}/api/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Deploy failed (${res.status}): ${text}`)

  // Response shape: '"Success! DeployId is: <128-hex>"'
  const match = text.match(/[0-9a-f]{100,}/i)
  if (!match) throw new Error(`Unexpected deploy response: ${text}`)
  return { deployId: match[0], timestamp, validAfterBlockNumber }
}

// ----------------------------------------------------------------------------
// Confirmation polling via GraphQL indexer
// ----------------------------------------------------------------------------
async function waitForConfirmation(deployId, { timeoutMs = 180_000, pollMs = 10_000 } = {}) {
  const query = `query($id: String!) {
    deployments(where: {deploy_id: {_eq: $id}}) {
      deploy_id errored error_message block_number block_hash
    }
  }`

  const deadline = Date.now() + timeoutMs
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    try {
      const res = await fetch(NET.indexerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { id: deployId } }),
      })
      const json = await res.json()
      const row = json?.data?.deployments?.[0]
      if (row) return row
    } catch (err) {
      // Indexer is occasionally flaky — tolerate and retry
      process.stderr.write(`  (indexer poll ${attempt} failed: ${err.message})\n`)
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
  return null
}

// ----------------------------------------------------------------------------
// CLI entry
// ----------------------------------------------------------------------------
function die(msg, code = 1) {
  process.stderr.write(`\nerror: ${msg}\n\n`)
  process.exit(code)
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    die(
      'PRIVATE_KEY env var required (hex, no 0x prefix).\n' +
      'Generate one via https://wallet.dev.asichain.io and fund it from ' +
      NET.faucetUrl,
    )
  }
  if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
    die('PRIVATE_KEY must be 64 hex chars (32 bytes, no 0x prefix).')
  }

  const phloLimit = Number(process.env.PHLO_LIMIT ?? 3_000_000)
  const term = readFileSync(CONTRACT_PATH, 'utf8')

  console.log('Deploying ASI Sample Token (ASIS) to ASI:Chain DevNet')
  console.log(`  contract        ${CONTRACT_PATH}`)
  console.log(`  phlo limit      ${phloLimit.toLocaleString()}`)
  console.log(`  validator api   ${NET.validatorUrl.replace(/.*\/prod/, '…/prod')}`)
  console.log()

  const started = Date.now()
  const { deployId, timestamp, validAfterBlockNumber } =
    await deploy(term, privateKey, phloLimit)

  console.log('Deploy submitted.')
  console.log(`  deploy id       ${deployId}`)
  console.log(`  explorer        ${NET.explorerUrl}/transaction/${deployId}`)
  console.log(`  validAfter      ${validAfterBlockNumber}`)
  console.log()
  console.log('Waiting for block inclusion (≤3 min)…')

  const status = await waitForConfirmation(deployId)
  const elapsedS = Math.round((Date.now() - started) / 1000)

  if (!status) {
    console.log()
    console.log(`Still pending after ${elapsedS}s. Track manually:`)
    console.log(`  ${NET.explorerUrl}/transaction/${deployId}`)
    writeFileSync(DEPLOYMENT_PATH, JSON.stringify({
      network: 'asi-chain-devnet',
      deployId, timestamp, validAfterBlockNumber,
      phloLimit,
      status: 'pending',
      explorerUrl: `${NET.explorerUrl}/transaction/${deployId}`,
      tokenChannelName: '@"asi_stoken_v1"',
    }, null, 2))
    return
  }

  if (status.errored) {
    console.log()
    console.log(`Deploy errored on-chain: ${status.error_message}`)
    writeFileSync(DEPLOYMENT_PATH, JSON.stringify({
      network: 'asi-chain-devnet',
      deployId, timestamp, validAfterBlockNumber,
      phloLimit,
      status: 'errored',
      blockNumber: status.block_number,
      errorMessage: status.error_message,
      explorerUrl: `${NET.explorerUrl}/transaction/${deployId}`,
    }, null, 2))
    process.exit(1)
  }

  console.log()
  console.log(`Confirmed in block ${status.block_number} (${elapsedS}s).`)
  console.log()

  const deployment = {
    network: 'asi-chain-devnet',
    contract: 'ASI Sample Token (ASIS)',
    deployId,
    timestamp,
    blockNumber: status.block_number,
    blockHash: status.block_hash,
    phloLimit,
    tokenChannelName: '@"asi_stoken_v1"',
    explorerUrl: `${NET.explorerUrl}/transaction/${deployId}`,
    status: 'confirmed',
    notes: {
      tokenFacetUri: 'Logged as ("TokenFacetURI", `rho:id:…`) on validator stdout. Retrievable via a local validator node (docker logs validator1). Also discoverable via @"asi_stoken_v1" from any deploy.',
      adminFacetUri: 'Logged as ("AdminFacetURI", `rho:id:…`) on validator stdout. Not recoverable from the DevNet wallet IDE or indexer. See README.md → "Admin URI recovery" for details.',
    },
  }
  writeFileSync(DEPLOYMENT_PATH, JSON.stringify(deployment, null, 2))
  console.log(`Wrote ${DEPLOYMENT_PATH}`)
  console.log()
  console.log('Note: the TokenFacetURI / AdminFacetURI values are logged to validator')
  console.log('stdout, which is not exposed by the DevNet wallet IDE, explorer, or')
  console.log('indexer. To capture them, deploy against a local validator and run:')
  console.log('  docker logs -f validator1 | grep -E "(Token|Admin)FacetURI"')
  console.log(`See ${NET.walletUrl} for interactive deploys and state inspection.`)
}

main().catch(err => die(err.stack ?? String(err)))
