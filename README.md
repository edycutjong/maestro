<div align="center">
  <img src="docs/icon-animated.svg" alt="Maestro Logo" width="120">

  <h1>Maestro 🎼</h1>
  <p><em>Callable orchestrator — hires specialist agents on-chain, grades their work, delivers one vetted result</em></p>
  <img src="docs/readme-hero-animated.svg" alt="Maestro" width="100%">

  <br/>

  [![Live Demo](https://img.shields.io/badge/🚀_Live-Demo-06b6d4?style=for-the-badge)](https://mock.croo.network)
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

## 🏗️ Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js (TypeScript) |
| **Ecosystem** | Constellation A2A (croo-core) |
| **Testing** | Vitest |

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 20
- npm

### Installation
1. Clone: `git clone https://github.com/edycutjong/maestro.git`
2. Install: `npm install`
3. Run: `npm run dev`

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
| Unit Testing | Vitest | ✅ |
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

## 📄 License
[MIT](LICENSE) © 2026 Edy Cu

## 🙏 Acknowledgments
Built for the DoraHacks CROO Hackathon 2026.
