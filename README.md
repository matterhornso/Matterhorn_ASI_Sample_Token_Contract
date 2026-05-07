# ASI Sample Token (ASIS)

A fungible token for ASI:Chain DevNet, written in Rholang. ERC20-equivalent API: `totalSupply`, `balanceOf`, `transfer`, `approve` / `allowance` / `transferFrom`, `increaseAllowance` / `decreaseAllowance`, admin-only `mint` / `burn` / `pause` / `unpause`, stdout event log, registry publication.

- **Name**: ASI Sample Token
- **Symbol**: ASIS
- **Decimals**: 8
- **Network**: ASI:Chain DevNet
- **Contract**: [`fungible-token.rho`](./fungible-token.rho)
- **Deploy script**: [`deploy.mjs`](./deploy.mjs)

---

## Live on ASI:Chain DevNet

| | |
|---|---|
| **Deploy ID** | `304402202e3bb185fd7b1a05959f8ddc98b02fcabe33153acfe6f9eef7ba39a6704d629302201e95bf97d1da20a64e1d4a9a6b06611937f45589d9aed05a05cc615dc6bb494a` |
| **Block** | `375064` |
| **Block hash** | `4075660ee0f2e93775ba1d8037a116be31db41f5493f1ad5ac5d1feef2ed8512` |
| **Status** | `errored: false` |
| **Explorer** | [View transaction](https://explorer.dev.asichain.io/transaction/304402202e3bb185fd7b1a05959f8ddc98b02fcabe33153acfe6f9eef7ba39a6704d629302201e95bf97d1da20a64e1d4a9a6b06611937f45589d9aed05a05cc615dc6bb494a) |
| **Discovery channel** | `@"asi_stoken_v1"` — public `Token` facet |

Verify via the ASI:Chain GraphQL indexer:

```bash
curl -sS -X POST 'https://indexer.dev.asichain.io/v1/graphql' \
  -H 'Content-Type: application/json' \
  --data '{"query":"{ deployments(where: {deploy_id: {_eq: \"<DEPLOY_ID>\"}}) { deploy_id errored error_message block_number block_hash } }"}'
```

---

## Architecture

Two facets over shared private state:

```
┌─────────────────────────────────────────────────────────────┐
│                  fungible-token.rho deploy                  │
│                                                             │
│   ┌───────────────┐          ┌──────────────────────────┐   │
│   │   Token       │          │   TokenAdmin             │   │
│   │   (public)    │          │   (capability)           │   │
│   │               │          │                          │   │
│   │ transfer      │          │ mint                     │   │
│   │ approve       │          │ burn                     │   │
│   │ transferFrom  │          │ pause                    │   │
│   │ balanceOf     │          │ unpause                  │   │
│   │ allowance     │          │                          │   │
│   │ totalSupply   │          │                          │   │
│   │ paused        │          │                          │   │
│   │ name/symbol/  │          │                          │   │
│   │  decimals     │          │                          │   │
│   └───────┬───────┘          └─────────────┬────────────┘   │
│           │                                │                │
│     bundle+{Token}               bundle+{TokenAdmin}        │
│           │                                │                │
│   rho:registry:insertArbitrary  rho:registry:insertArbitrary│
│           │                                │                │
│           ▼                                ▼                │
│      tokenFacetUri                   adminFacetUri          │
│    (public — published                (private — share     │
│     on @"asi_stoken_v1")               only with admin)    │
│                                                             │
│   ┌────────── shared private state (new block) ─────────┐   │
│   │   balances   │   allowances   │   totalSupply       │   │
│   │                          │    paused                │   │
│   └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

Both facets close over `balances`, `allowances`, `totalSupply`, and `paused`. State channels live inside a `new` block, so the only entry points to the contract are the two registered facet URIs.

### OCAP admin model

There is no `owner` address on-chain. At deploy time the contract registers two URIs via `rho:registry:insertArbitrary`: one wraps the public `Token` facet, the other wraps the private `TokenAdmin` facet. **Admin authority = possession of `adminFacetUri`.** Delegation is off-chain (share the URI). Revocation is not included in v1 and requires wrapping the URI in a revocable forwarder.

---

## Public API

### Read methods

| Channel call | Returns |
|---|---|
| `Token!("name", *ack)` | `"ASI Sample Token"` |
| `Token!("symbol", *ack)` | `"ASIS"` |
| `Token!("decimals", *ack)` | `8` |
| `Token!("totalSupply", *ack)` | integer |
| `Token!("paused", *ack)` | `true` / `false` |
| `Token!("balanceOf", addr, *ack)` | integer (0 if unknown) |
| `Token!("allowance", owner, spender, *ack)` | integer (0 if unset) |

### User methods (gated by `paused`)

| Channel call | Returns |
|---|---|
| `Token!("transfer", from, to, amount, *ack)` | `"ok"` or `"error: <reason>"` |
| `Token!("approve", owner, spender, amount, *ack)` | `"ok"` or `"error: <reason>"` |
| `Token!("increaseAllowance", owner, spender, addedValue, *ack)` | `("ok", newAllowance)` or error |
| `Token!("decreaseAllowance", owner, spender, subtractedValue, *ack)` | `("ok", newAllowance)` or error |
| `Token!("transferFrom", spender, from, to, amount, *ack)` | `"ok"` or `"error: <reason>"` |

### Admin methods (require `adminFacetUri`)

| Channel call | Returns |
|---|---|
| `TokenAdmin!("mint", to, amount, *ack)` | `("ok", newTotalSupply)` or error |
| `TokenAdmin!("burn", from, amount, *ack)` | `("ok", newTotalSupply)` or error |
| `TokenAdmin!("pause", *ack)` | `"ok"` or `"error: already paused"` |
| `TokenAdmin!("unpause", *ack)` | `"ok"` or `"error: not paused"` |

> The `tokenFacetUri` and `adminFacetUri` are logged at deploy time as `("TokenFacetURI", rho:id:…)` and `("AdminFacetURI", rho:id:…)`. They are written to validator stdout, which is not exposed by the current DevNet wallet IDE, explorer, or indexer. Capture the URIs by deploying against a local validator (`docker logs validator1`) or a self-run observer node.

### Event log

Emitted on validator stdout:

```
("Event", "Transfer", from, to, amount)
("Event", "Approval", owner, spender, amount)
("Event", "Mint",  to,   amount)
("Event", "Burn",  from, amount)
("Event", "Paused")
("Event", "Unpaused")
```

`mint` and `burn` also emit a `Transfer` event with `from == "0x0"` / `to == "0x0"` to match ERC20 indexer conventions.

---

## Correctness model

| ID | Invariant |
|---|---|
| **I1** | `balances` always holds exactly one message (the map). |
| **I2** | `allowances` always holds exactly one message (the map). |
| **I3** | `totalSupply` always holds exactly one message (integer). |
| **I4** | `paused` always holds exactly one message (boolean). |
| **I5** | Conservation: `totalSupply == sum(balances)` at every externally observable state. `mint` adds, `burn` subtracts, `transfer`/`transferFrom` are net-zero. |
| **I6** | Allowance monotonicity: `transferFrom` decreases the allowance by exactly `amount` per successful call. |

Every `for (@x <- stateChannel)` is paired with `stateChannel!(…)` on every code path, including error branches — this maintains I1–I4. Multi-state operations use a JOIN (`for (@a <- ch1; @b <- ch2; …)`) so intermediate state is never externally observable. See in-line `INVARIANT` / `LAW` / `PROOF` comments in [`fungible-token.rho`](./fungible-token.rho) for the full proofs.

---

## Deploying

### Prerequisites

1. Node.js ≥ 18.17
2. A funded ASI:Chain DevNet key — create at [wallet.dev.asichain.io](https://wallet.dev.asichain.io), fund via the [faucet](https://faucet.dev.asichain.io)
3. Export the private key as 64 hex chars (no `0x` prefix)

### Deploy

```bash
npm install
PRIVATE_KEY=<64-hex> npm run deploy
```

The script:

1. Signs the contract (Blake2b-256 over a proto3 projection, secp256k1 low-S DER).
2. POSTs to the validator API and receives a Deploy ID.
3. Polls the GraphQL indexer until block inclusion (≤3 min).
4. Writes [`deployment.json`](./deployment.json) with block number, hash, and notes.

Example output:

```
Deploying ASI Sample Token (ASIS) to ASI:Chain DevNet
  contract        .../fungible-token.rho
  phlo limit      3,000,000
  validator api   …/prod/.../HTTP_API

Deploy submitted.
  deploy id       30440220....
  explorer        https://explorer.dev.asichain.io/transaction/30440220...
  validAfter      184203

Waiting for block inclusion (≤3 min)…

Confirmed in block 184207 (27s).

Wrote .../deployment.json
```

### Phlo budget

| Operation | Recommended phlo limit |
|---|---|
| Deploy (initial) | `3_000_000` |
| `transfer`, `approve`, `increaseAllowance`, `decreaseAllowance` | `500_000` |
| `transferFrom` (3-way JOIN) | `700_000` |
| `mint`, `burn` | `500_000` |
| `pause`, `unpause` | `250_000` |
| Read methods | `100_000` |

---

## Interacting with the contract

All interactions are separate Rholang deploys. Resolve the public facet via the registry URI or via `@"asi_stoken_v1"`.

### Read a balance

```rholang
new lookup(`rho:registry:lookup`), stdout(`rho:io:stdout`), tokenCh, ack in {
  lookup!(`rho:id:<PASTE_TOKEN_URI>`, *tokenCh) |
  for (Token <- tokenCh) {
    Token!("balanceOf", "1111YourAddressHere...", *ack) |
    for (@bal <- ack) { stdout!(("balance", bal)) }
  }
}
```

### Admin mint

```rholang
new lookup(`rho:registry:lookup`), adminCh, ack in {
  lookup!(`rho:id:<PASTE_ADMIN_URI>`, *adminCh) |
  for (TokenAdmin <- adminCh) {
    TokenAdmin!("mint", "1111RecipientAddress...", 1_000_000_000_000, *ack) |
    for (@result <- ack) { Nil }
  }
}
```

Mints 10,000 ASIS (1e12 at 8 decimals).

### User transferFrom flow

```rholang
// 1. owner approves spender for 500 ASIS
Token!("approve", "1111Owner...", "1111Spender...", 50_000_000_000, *ack)

// 2. spender moves 200 ASIS from owner to recipient
Token!("transferFrom", "1111Spender...", "1111Owner...", "1111Recipient...", 20_000_000_000, *ack)

// 3. check remaining allowance — should return 30_000_000_000
Token!("allowance", "1111Owner...", "1111Spender...", *ack)
```

---

## Security considerations

- **Admin URI custody.** `adminFacetUri` is the only authority for mint/burn/pause. Never commit it; treat it as a private key.
- **ERC20 approve race.** A spender can front-run `approve` to spend both old and new amounts. Prefer `increaseAllowance` / `decreaseAllowance`.
- **Pause blast radius.** `pause` halts all user-facing methods (transfers, approvals, delegated transfers) at once. No per-method pause.
- **Registry bundle.** `bundle+` makes both registered URIs write-only at the callee — holders can invoke methods but cannot read internal state directly.

---

## Project layout

```
Matterhorn_ASI_Sample_Token_Contract/
├── fungible-token.rho   # The contract
├── deploy.mjs           # CLI: sign, submit, poll for confirmation
├── deployment.json      # On-chain deploy record
├── package.json
└── README.md
```
