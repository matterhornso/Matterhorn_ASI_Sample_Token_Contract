// Deploy Rholang contract to ASI:Chain DevNet
import { secp256k1 as secp } from '@noble/curves/secp256k1'
import { blake2b } from '@noble/hashes/blake2b'
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils'
import { readFileSync } from 'fs'

const VALIDATOR_URL = 'https://ihmps4dkpg.execute-api.us-east-1.amazonaws.com/prod/bb93eaa595aaddf6912e372debc73eef/endpoint_0/HTTP_API'

function encodeVarint(value) {
  const bytes = []
  let v = BigInt(value)
  while (v > 127n) { bytes.push(Number((v & 0xffn) | 0x80n)); v >>= 7n }
  bytes.push(Number(v))
  return new Uint8Array(bytes)
}

function tag(n, w) { return encodeVarint((n << 3) | w) }

function str(n, v) {
  if (!v) return new Uint8Array(0)
  const e = utf8ToBytes(v)
  return concatBytes(tag(n, 2), encodeVarint(e.length), e)
}

function int64(n, v) {
  if (!v) return new Uint8Array(0)
  return concatBytes(tag(n, 0), encodeVarint(v))
}

async function deploy(term, privateKeyHex, phloLimit = 500_000) {
  const privateKey = hexToBytes(privateKeyHex)
  const timestamp = Date.now()

  // Get latest block number
  const blocksRes = await fetch(`${VALIDATOR_URL}/api/blocks/1`)
  const blocks = await blocksRes.json()
  const validAfterBlockNumber = blocks[0]?.blockNumber ?? 0

  // Build protobuf signing projection (language field excluded)
  const projection = concatBytes(
    str(2, term),
    int64(3, timestamp),
    int64(7, 1),                       // phloPrice
    int64(8, phloLimit),
    int64(10, validAfterBlockNumber),
    str(11, 'root')                    // shardId
  )

  // Sign with Blake2b + secp256k1
  const hash = blake2b(projection, { dkLen: 32 })
  const sig = secp.sign(hash, privateKey, { lowS: true, format: 'der' })
  const pubKey = secp.getPublicKey(privateKey, false) // 65 bytes with 04 prefix

  const body = {
    data: {
      term,
      timestamp,
      phloPrice: 1,
      phloLimit,
      validAfterBlockNumber,
      shardId: 'root',
      language: 'rholang',
    },
    deployer: bytesToHex(pubKey),
    signature: bytesToHex(sig),
    sigAlgorithm: 'secp256k1',
  }

  const res = await fetch(`${VALIDATOR_URL}/api/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`Deploy failed: ${text}`)

  const match = text.match(/[0-9a-f]{100,}/i)
  return match ? match[0] : text
}

// --- Main ---
const privateKey = process.env.PRIVATE_KEY
if (!privateKey) {
  console.error('Set PRIVATE_KEY env var (hex, no 0x prefix)')
  process.exit(1)
}

const term = readFileSync('./fungible-token.rho', 'utf8')
const deployId = await deploy(term, privateKey, 500_000)

console.log('Deploy ID:', deployId)
console.log('Explorer:', `https://explorer.dev.asichain.io/transaction/${deployId}`)
