# TODO — Full-Stack Token dApp

Roadmap for turning this into a complete dApp with UI, secure backend, and advanced token features.

---

## Phase 1 — Contract Enhancements

- [ ] **Add approve/transferFrom** — ERC20-style allowance system so third parties (like a staking contract or DEX) can move tokens on a user's behalf. Requires a second `allowances` state channel with atomic JOIN reads.
- [ ] **Add total supply tracking** — Maintain a `totalSupply` state channel incremented on mint. Expose a read-only `Token!("totalSupply", ack)` method.
- [ ] **Add owner/admin controls** — Use `rho:rchain:deployerId` to capture the deployer's identity at deploy time. Gate `mint` so only the deployer can create new tokens.
- [ ] **Tax on trade** — Deduct a configurable percentage on every `transfer` and `transferFrom`. Send the tax to a treasury address. Store the tax rate in a state channel that only the admin can update.
- [ ] **Staking contract** — Separate Rholang process that:
  - Accepts token deposits via `transferFrom` (requires approve/allowance)
  - Tracks staked balances and stake timestamps per address
  - Calculates rewards based on block number difference (use `rho:block:number`)
  - Allows withdrawal of stake + earned rewards
  - Mints reward tokens (needs mint permission from the token contract)
- [ ] **Event logging** — Send structured data to a public log channel (e.g., `@"simple_ft_events"`) on every mint/transfer so off-chain indexers can track history.
- [ ] **Registry-based deployment** — Use `rho:registry:insertArbitrary` to get a stable URI for the token contract instead of a plain string channel. This prevents name collisions and is the production pattern on ASI:Chain.

---

## Phase 2 — Secure Backend

- [ ] **API server** (Node.js / Express or Fastify)
  - `POST /api/mint` — Admin-only endpoint to mint tokens (requires auth)
  - `POST /api/transfer` — Submit a transfer on behalf of a user
  - `GET /api/balance/:address` — Query on-chain balance
  - `GET /api/history/:address` — Return transfer history from indexer
  - `GET /api/staking/:address` — Return staking position and accrued rewards
- [ ] **Authentication** — Wallet-based auth flow:
  - User signs a challenge message with their ASI:Chain private key
  - Backend verifies the secp256k1 signature against the claimed public key
  - Issues a JWT for subsequent API calls
- [ ] **Transaction signing** — Backend holds a hot wallet key (encrypted at rest) for admin operations like minting. User-initiated transfers should be signed client-side and relayed through the backend.
- [ ] **Rate limiting** — Prevent abuse on mint/transfer endpoints. Use sliding window rate limits per authenticated address.
- [ ] **Indexer integration** — Poll `https://indexer.dev.asichain.io/v1/graphql` for deploy confirmations and build a local cache of token events for fast queries.
- [ ] **Environment config** — Store validator URL, admin keys, and JWT secrets in env vars. Use `.env` with `dotenv` (never commit secrets).

---

## Phase 3 — Frontend UI

- [ ] **Tech stack** — React + TypeScript + Vite. Tailwind CSS for styling.
- [ ] **Wallet connection** — Build a connect flow that:
  - Lets users paste their ASI:Chain address (no browser extension exists yet)
  - Or import a private key into local encrypted storage (Web Crypto API)
  - Signs transactions client-side before sending to the backend
- [ ] **Dashboard page**
  - Show connected address and token balance
  - Display recent transfer history (from backend API)
  - Show total supply and token info
- [ ] **Transfer page**
  - Form: recipient address, amount
  - Client-side validation (address format, balance check)
  - Sign transaction → submit to backend → show confirmation with explorer link
- [ ] **Staking page**
  - Show current stake amount, time staked, accrued rewards
  - Stake / Unstake forms with approve + deposit flow
  - Claim rewards button
  - APY display calculated from the reward rate
- [ ] **Admin page** (gated by admin auth)
  - Mint tokens to an address
  - Update tax rate
  - View treasury balance
- [ ] **Transaction status** — Poll backend for deploy confirmation after submitting. Show pending → confirmed → failed states with explorer links.
- [ ] **Mobile responsive** — The wallet IDE is desktop-only, but the dApp frontend should work on mobile browsers.

---

## Phase 4 — Testing & Deployment

- [ ] **Contract tests** — Write Rholang test deploys that exercise every contract method, including error paths (transfer with insufficient balance, unauthorized mint, etc.). Deploy to DevNet and verify via indexer.
- [ ] **Backend tests** — Unit tests for signing logic, API endpoint integration tests against a local mock.
- [ ] **Frontend tests** — Component tests with Vitest + React Testing Library for forms and wallet flows.
- [ ] **CI/CD** — GitHub Actions pipeline:
  - Lint + test on PR
  - Deploy backend to a cloud provider (Railway, Fly.io, or AWS Lambda)
  - Deploy frontend to Vercel or Cloudflare Pages
- [ ] **Security audit** — Review the Rholang contract for state channel linearity violations, missing write-backs on error paths, and unauthorized access to gated operations.

---

## Notes

- ASI:Chain is currently on DevNet only — no TestNet or MainNet yet. Plan for redeployment when those launch.
- `stdout` in Rholang prints to the validator terminal, not the wallet IDE or explorer. Use public channels or the indexer for observability.
- The deploy script's validator URL is an AWS proxy that may rotate. If it stops working, check the wallet IDE's network tab for the current endpoint.
