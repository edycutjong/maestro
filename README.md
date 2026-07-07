<div align="center">
  <img src="docs/icon-animated.svg" alt="Maestro Logo" width="120">

  <h1>Maestro 🎼</h1>
  <p><em>Callable orchestrator — hires specialist agents on-chain, grades their work, delivers one vetted result</em></p>
  <img src="docs/readme-hero-animated.svg" alt="Maestro" width="100%">

  <br/>

  [![Built for CROO Hackathon](https://img.shields.io/badge/DoraHacks-CROO_Hackathon_2026-8b5cf6?style=for-the-badge)](https://dorahacks.io/hackathon/croo-hackathon)

  <br/>

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
  ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
  [![CI](https://github.com/edycutjong/maestro/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/maestro/actions/workflows/ci.yml)

</div>

---

## 📸 See it in Action

<div align="center">
  <img src="docs/see-in-action.png" alt="Maestro Demo" width="100%">
</div>

> **The Orchestrator Workflow.** Request → Maestro Hires Specialists → Agents Work → Maestro Grades & Consolidates → Final Result Delivered.

---

## 💡 The Problem & Solution
Single agents fail at complex tasks because they lack specialized context and self-reflection. Managing a multi-agent system manually is cumbersome and non-scalable.
**Maestro** solves this by acting as an autonomous orchestrator. It intelligently provisions the right specialist agents from the Constellation network, oversees their work, and distills their outputs into a single, high-fidelity result.

**Key Features:**
- ⚡ **Autonomous Hiring:** Automatically selects the best specialist agents for a specific prompt.
- 🔒 **Quality Assurance:** Integrates with grading agents to evaluate outputs before delivery.
- 🎨 **Consolidated Outputs:** Delivers a single, cohesive response instead of raw multi-agent logs.
- 🔄 **Active State Recovery:** Recovers and resumes pending pipeline executions upon startup if container restarts.
- ⚡ **Fast Fallover Retry Bypass:** Intercepts subcontractor rejections/expirations instantly, bypassing retry loops to cascade to backup providers.
- 💼 **Dynamic Payout Wallet:** Uses `MAESTRO_PAYOUT_ADDRESS` to route fee revenues directly to custom cold storage.

## 🌌 The Constellation — On-Chain A2A Graph

Maestro is the **hub** of a multi-agent constellation. Every arrow below is a real CAP order settled in USDC on Base — escrow-backed, with automatic refunds on failure. This composition is impossible (or far worse) on a flat REST marketplace: there is no escrow, no on-chain provenance, and no way to refund a buyer when a sub-agent underperforms.

```mermaid
graph LR
    User([Any Agent / User]) -->|hires| M[Maestro 🎼]
    M -->|research| W[Worker 🛠️]
    M -->|self-correct retry| FW[Fallback Worker 🛠️]
    M -->|grade 0–100| L[Litmus 🧪]
    M -->|human sign-off| S[Summon 👤]
    G[Gauntlet 🧤] -.->|certifies| M
    GL[Goldilocks 🧈] -.->|prices| M
    classDef hot fill:#F59E0B,stroke:#111,color:#111,font-weight:bold;
    class M hot;
```

- **Depth:** Maestro runs a *cognitive reflection loop* — if Litmus scores a draft below threshold, it re-hires a fallback Worker with the grader's critique, re-grades, then escalates to a human via Summon.
- **Fiduciary refund:** if quality stays critically low, Maestro autonomously refunds the buyer's escrow instead of delivering substandard work.
- **One request → many CAP orders:** a single pipeline run can generate 4–5 on-chain sub-orders across 3–4 distinct agents.

## 🔗 Live Run Log — On-Chain Proof (Base Mainnet)

Real CAP orders settled in USDC during the hackathon. As the constellation **hub**, one Maestro request fans out into several sub-hires — so each run adds multiple rows.

**Total real CAP orders: _0_** · _last updated: 2026-06-__

| # | Date | Role | Counterparty | Amount (USDC) | Order ID | Tx (BaseScan) | Result |
|---|------|------|--------------|---------------|----------|---------------|--------|
| 1 | _2026-06-__ | Provider (paid) | _requester_ | _0.00_ | `_ord_…_` | [0x…](https://basescan.org/tx/0x…) | brief delivered |
| 2 | _2026-06-__ | Requester (hired) | Worker | _0.00_ | `_ord_…_` | [0x…](https://basescan.org/tx/0x…) | research |
| 3 | _2026-06-__ | Requester (hired) | Litmus 🧪 | _0.00_ | `_ord_…_` | [0x…](https://basescan.org/tx/0x…) | score _N_/100 |
| 4 | _2026-06-__ | Requester (hired) | Summon 👤 | _0.00_ | `_ord_…_` | [0x…](https://basescan.org/tx/0x…) | approved |

> Every sub-hire is already captured in the delivered `audit[]` array (`orderId`, `amount`, `txHash`) — copy those straight in. Delete this note once populated.

## 🏗️ Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js (TypeScript) |
| **Ecosystem** | Constellation A2A (croo-core) |
| **Testing** | Vitest |

## 🧩 CROO SDK Methods Used

Maestro builds on the shared **`@edycutjong/croo-core`** SDK. The methods it actually calls:

| Method | Source | Role in Maestro |
|---|---|---|
| `makeClient(sdkKey)` | croo-core | Instantiates the shared CROO `AgentClient` (Base Mainnet config) from the SDK key. |
| `runProvider(...)` | croo-core | Runs Maestro as an on-chain **provider** — subscribes to order/negotiation events and fulfils incoming hires. |
| `hire(...)` | croo-core | Acts as a **consumer** — Maestro orchestrates by placing orders against other Constellation agents (A2A). |
| `isMockMode()` | croo-core | Branches between offline mock mode and live on-chain execution. |
| `client.uploadFile(...)` | @croo-network/sdk | Uploads the composed deliverable artifact. |
| `client.rejectOrder(...)` | @croo-network/sdk | Declines an incoming order that fails policy checks. |
| `client.getNegotiation(id)` | @croo-network/sdk | Reads negotiation/order state while orchestrating. |

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 20
- npm

### Installation
1. Clone: `git clone https://github.com/edycutjong/maestro.git`
2. Install: `npm install`
3. Configure: `cp .env.example .env.local` and fill in your service IDs (skip for mock mode)

### ▶️ Run it now — offline mock mode (no wallet, no USDC)
```bash
npm install
npm run demo            # full Research → Grade → Human → Deliver pipeline, end-to-end
# …or boot the live provider loop in mock mode:
CROO_MOCK=true npm run dev
```
`npm run demo` exercises the real `work()` path against deterministic mock sub-agents — no funding required, perfect for reproducing the orchestration locally.

## 🧪 Testing & CI

**4-stage pipeline:** Quality → Security → Build → Deploy Gate

```bash
# ── Code Quality ────────────────────────────
make lint          # ESLint
make typecheck     # TypeScript check
make test          # Run tests
make test-coverage # Coverage report
make ci            # Full quality gate

# ── Security ────────────────────────────────
make security-scan # npm audit + license check
```

| Layer | Tool | Status |
|---|---|---|
| Code Quality | ESLint + TypeScript | ✅ |
| Unit Testing | Vitest (64 tests) | ✅ |
| Security (SAST) | CodeQL | ✅ |
| Security (SCA) | Dependabot + npm audit | ✅ |
| Secret Scanning | TruffleHog | ✅ |

## 📁 Project Structure
```text
dorahacks-croo-maestro/
├── docs/              # README assets (hero, screenshots)
├── src/               # Application source code
├── scripts/           # Build and run scripts
├── __tests__/         # Vitest test suites
├── .github/           # CI workflows
└── README.md          # You are here
```

## 🚢 Deploy
Containerized for any PaaS (Railway, Render, Fly.io, Cloud Run). Maestro is a background **worker** (connects out to the CROO WebSocket — no inbound port):
```bash
docker build -t maestro .
docker run --env-file .env.local maestro
```

## 📄 License
[MIT](LICENSE) © 2026 Edy Cu

## 🙏 Acknowledgments
Built for the DoraHacks CROO Hackathon 2026.
