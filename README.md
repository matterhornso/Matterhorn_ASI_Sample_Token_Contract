# ASI:Chain Simple Fungible Token

A simple fungible token contract written in Rholang for ASI:Chain DevNet, with a Node.js deployment script.

## What's in the box

- `fungible-token.rho` — Rholang token contract with mint, transfer, and balance query
- `deploy.mjs` — Node.js script to sign and submit the contract to ASI:Chain DevNet
- `package.json` — Dependencies for cryptographic signing

## The Contract

The token contract lives entirely on-chain as a Rholang process. It exposes three operations through a single `Token` channel published on `@"simple_ft_v1"`:

| Operation | Signature | Description |
|-----------|-----------|-------------|
| **mint** | `Token!("mint", address, amount, ack)` | Create new tokens for an address |
| **transfer** | `Token!("transfer", from, to, amount, ack)` | Move tokens between addresses |
| **balance** | `Token!("balance", address, ack)` | Query token balance (read-only) |

Every operation returns a result on the `ack` channel — either `"ok"` or an error string like `"error: insufficient balance"`.

### Design principles

- **State channel linearity** — The internal `balances` map is consumed and restored on every code path, including errors. This prevents permanent state loss.
- **OCAP security** — The `balances` channel is created inside a `new` block, making it unforgeable and inaccessible to external processes.
- **Conservation** — Transfers move exact amounts. No tokens are created or destroyed outside of `mint`.

### Interacting with the deployed contract

From a separate Rholang deploy:

```rholang
new ack in {
  for (Token <- @"simple_ft_v1") {
    Token!("mint", "1111youraddresshere", 1000, *ack) |
    for (@result <- ack) {
      // result == "ok"
    }
  }
}
```

## Deployment

### Option A — Wallet IDE (recommended for first deploy)

1. Create an account at https://wallet.dev.asichain.io
2. Get test tokens from https://faucet.dev.asichain.io
3. Open the Deploy tab, paste the contents of `fungible-token.rho`
4. Set Phlo limit to `500000`
5. Click Deploy — note the Deploy ID
6. Confirm at `https://explorer.dev.asichain.io/transaction/<deployId>`

### Option B — CLI via Node.js

```bash
npm install
PRIVATE_KEY=your_hex_private_key node deploy.mjs
```

The script will output a Deploy ID and an explorer link.

### Checking deploy status

Query the ASI:Chain indexer:

```bash
curl -X POST https://indexer.dev.asichain.io/v1/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ deployments(where: {deploy_id: {_eq: \"YOUR_DEPLOY_ID\"}}) { deploy_id errored error_message block_number } }"}'
```

## ASI:Chain quick reference

| Topic | Detail |
|-------|--------|
| Network | DevNet (live since Nov 2025) |
| Address format | `1111...` (50-54 chars) |
| Gas unit | Phlo (start at 500,000) |
| Token unit | 1 ASI = 100,000,000 dust |
| Block time | ~10 seconds |
| Explorer | https://explorer.dev.asichain.io |
| Wallet | https://wallet.dev.asichain.io |
| Faucet | https://faucet.dev.asichain.io |

## License

MIT
