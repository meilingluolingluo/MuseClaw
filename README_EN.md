# MuseClaw

[English](README_EN.md) | [中文](README.md)

> **Enterprise Always-On Multi-Agent Workstation**  
> An enterprise-grade AI Agent platform featuring dedicated always-on sandboxes, roster-style multi-agent collaboration, deterministic Sentinel security guardrails, proactive automated routines, long-horizon goal planning, and closed-loop cross-channel collaboration.

---

## 🎯 Product Positioning & Core Value

MuseClaw is built to provide every enterprise employee with a **"dedicated AI virtual team"**. Moving beyond simple question-and-answer chat interfaces, MuseClaw assigns an isolated, always-on execution environment to each employee. It orchestrates role-specialized digital employees through an intuitive address-book (Roster) interface, seamlessly interfacing with internal enterprise systems and external workflows.

### Generational Shifts & Key Differentiators

| Dimension | Conventional Conversational Agents | Ephemeral Execution Sandboxes | **MuseClaw (This System)** |
| :--- | :--- | :--- | :--- |
| **Interaction Paradigm** | Single chat box, passive Q&A | Ephemeral single-task cards | **Virtual Team Roster UI + Dual-channel Sync (Web + Enterprise IM)** |
| **Agent Organization** | Monolithic prompt | No concept of organizational roles | **Role-Specialized Agent Matrix (Independent SOUL prompts, avatars, skills & models)** |
| **Runtime Lifecycle** | Stateless API calls or no runtime | Created on-demand, destroyed after task | **Dedicated Always-On Sandbox per employee with persistent intranet sessions & workspaces** |
| **Security Governance** | Relies on prompt safety instructions | Basic regex/command blacklists | **Deterministic Sentinel Engine (Physical interception of mutating operations, dual-channel approval)** |
| **Proactivity** | Zero proactivity (strictly passive) | Manual triggering only | **Proactive Automation Hub (Cron scheduling, Webhook inbound triggers, failure retry)** |
| **Strategic Planning** | Incapable of managing long-horizon tasks| Instant single-step execution only | **Long-Horizon Goals Engine (Milestone decomposition, autonomous inspection cadence & logging)** |
| **Knowledge Retention**| Context easily lost across sessions | No persistent data retention | **Controlled Memory System (Protected/Consolidated dual tracks + Dry-run review) + Artifacts Hub** |

---

## ✨ Core Feature Matrix

### 1. 👥 Roster Mode & Multi-Agent Collaboration
* **Digital Employee Roster**: Intuitive organizational matrix managing specialized digital employees (Data Analysis Assistant, Security & Compliance Inspector, Site Reliability Engineer, Code Reviewer, etc.).
* **Dedicated Persona Configuration (SOUL)**: Each digital employee maintains an independent System Prompt (SOUL), custom avatars (animated/static webp & emoji selector), dynamic model routing, and dedicated skill bindings.
* **Hierarchical Main Chat & Side Chats**: Equips each digital employee with a persistent pinned **Main Chat** (the core persistent ongoing workflow, protected from deletion, accumulating long-term memory) and isolated **Side Chats** (on-demand parallel sub-tasks that can be created, searched, and cleaned up without polluting the main context).
* **AgentCapsule Dynamic Interaction**: Supports both a sticky top-bar status capsule and centered hero mode, displaying real-time reasoning progress, tool execution badges, and health states.

### 2. 🛡️ Deterministic Sentinel & Security Audit
* **Physical Interception Aspect**: Enforces deterministic access control directly at the execution runtime (physically intercepting destructive shell commands, unauthorized deletions, cloud metadata SSRF vectors, and loop guard circuit breakers).
* **Dynamic Suspension & Verification (Pending -> Approval -> Resume)**: High-risk operations are automatically suspended and dispatched for approval. Approvals strictly bind to the authenticated operator identity to eliminate spoofing.
* **Immutable Audit Trail**: End-to-end execution trajectories and approval decisions are persisted as structured JSONL audit logs, paired with an interactive compliance audit viewer and Grants active authorization lifecycle manager.

### 3. 📱 Dual-End Enterprise IM Collaboration
* **Feishu / Lark**: Supports official SDK, WebSocket long-polling and Webhook dual modes. High-risk approvals are dispatched via native interactive cards featuring one-click "Approve / Reject" callbacks, rich-text markdown layouts, and graceful text fallbacks.
* **Baidu Infoflow (如流)**: Supports enterprise-grade webhook signature verification, AES-256 payload encryption, multi-turn conversational collaboration, and text-based command approvals.
* **Bi-directional Synchronization**: Tasks triggered from either the Web workstation or mobile enterprise IM maintain consistent execution contexts, approval lifecycles, and streaming updates.

### 4. ⏱️ Proactive Routines & Event-Driven Automation
* **Cron Periodic Scheduling**: Built-in 5-segment standard scheduler with concurrency overlap prevention, natural language cycle parsing, and next-run preview calculations.
* **Inbound Webhook Triggers**: Real-time event ingestion for monitoring alerts and issue tracking webhooks, equipped with Bearer token authentication, 429 concurrency rate limiting, and external data boundary sanitization.
* **Resilient Execution Pipeline**: Provides one-click failure retries with live spinning indicators, full tool invocation trace inspection, and direct notification routing.

### 5. 🎯 Long-Horizon Goals Engine
* **Milestone & Step Decomposition**: Breaks down complex enterprise objectives into structured milestones with rapid inline step authoring and visual completion progress.
* **Autonomous Inspection Cadence**: Intelligently inspects goal dependencies on schedule, automatically logs progress memos, and synchronizes status back to the dashboard.

### 6. 🧠 Controlled Memory System & Skills Ecosystem
* **Dual-Track Controlled Memory**: Bridges manual "Protected Memories" and conversational "Consolidated Memories", complete with dry-run consolidation previews, full-text markdown viewers, and quota monitoring.
* **Skills Registry**: Bundles out-of-the-box system skills alongside support for one-click Zip skill package uploads, manifest validation, and dynamic sandboxed execution.

### 7. 💻 Distributed Runner Mesh & Heterogeneous Model Providers
* **Cross-Platform Runner Daemon (`apps/runner`)**: Powers distributed employee node connectivity across Linux (`systemd`), macOS (`launchd`), and Windows services, backed by bi-directional heartbeats and self-healing auto-reconnection.
* **Local Agent Probe & Cloud Routing**: Automatically detects local Ollama, vLLM, and local agent runtimes while seamlessly unifying cloud LLM providers (DeepSeek, OpenAI, Anthropic, etc.) under a centralized provider center.

### 8. 🎨 Modern React 19 Single-Page Workstation
* **8 Tailored Business Views**: Conversational Workstation (`ChatView`), Global Activity Stream (`FeedView`), Goals Board (`GoalsView`), Routines Hub (`RoutinesView`), Memory Center (`MemoryView`), Skills Library (`SkillsView`), Audit Dashboard (`AuditView`), and Artifacts Center (`ArtifactsView`).
* **Non-blocking Micro-interactions**: Eliminates disruptive native browser `confirm()` popups in favor of animated two-step inline confirmations (`.is-confirming`) and smooth skeleton loading states.

---

## 🏛️ System Architecture

```
+---------------------------------------------------------------------------------------------------+
|                                 1. Unified Access Layer (Access Layer)                            |
|   +-----------------------------------------------+   +---------------------------------------+   |
|   |         Modern Web Workstation (React 19 SPA) |   |         Enterprise IM & Webhooks      |   |
|   |  - Roster Mode (8 Core Business Views)        |   |  - Feishu (WebSocket / Webhook)       |   |
|   |  - Real-time Activity Stream & Approval Cards |   |  - Baidu Infoflow (AES-256 Encrypted) |   |
|   |  - Non-blocking Inline Interactions & A11y    |   |  - External Webhook Event Ingestion   |   |
|   +-----------------------------------------------+   +---------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ (SSE Streaming / WebSocket / RESTful API)
+---------------------------------------------------------------------------------------------------+
|                              2. Control & Relay Hub (Gateway Server)                              |
|   +-----------------------------------------+   +---------------------------------------------+   |
|   | Session & State Relay Engine            |   | Long-Horizon Goals Engine                   |   |
|   +-----------------------------------------+   +---------------------------------------------+   |
|   +-----------------------------------------+   +---------------------------------------------+   |
|   | Proactive Routine & Cron Manager        |   | Skills Registry & Package Parser            |   |
|   +-----------------------------------------+   +---------------------------------------------+   |
|   +-----------------------------------------+   +---------------------------------------------+   |
|   | Controlled Memory Store & Consolidator  |   | Digital Employee Roster & Provider Store    |   |
|   +-----------------------------------------+   +---------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ (Dynamic Risk Assessment Interception)
+---------------------------------------------------------------------------------------------------+
|                            3. Deterministic Sentinel Security Engine                              |
|   +-------------------------------------------------------------------------------------------+   |
|   | Physical Command Interception (Shell / Network / Destructive Mutation Interception)       |   |
|   | Dynamic Suspension State Machine (Pending -> Approval -> Resume)                          |   |
|   | Grants Authorization Lifecycle Management & Credential Desensitization                    |   |
|   | Immutable JSONL Compliance Audit Log Stream                                               |   |
|   +-------------------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ (Distributed Scheduling & Container IPC)
+---------------------------------------------------------------------------------------------------+
|                     4. Hybrid Execution & Compute Network (Sandbox Core & Runner Mesh)            |
|   +----------------------------------------+     +--------------------------------------------+   |
|   | Per-User Dedicated Always-on Sandbox   |     | Cross-Platform Runner Daemon (apps/runner) |   |
|   | - Linux isolation & micro-sandboxes    |     | - Linux (systemd) / macOS (launchd) / Win  |   |
|   | - Persistent login state & user volume |     | - Bi-directional heartbeat & self-healing  |   |
|   +----------------------------------------+     +--------------------------------------------+   |
|   +-------------------------------------------------------------------------------------------+   |
|   | Heterogeneous Model Provider Center (Local Ollama/vLLM Probing + Cloud LLM Dynamic Route) |   |
|   +-------------------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ (Structured Output & Archival)
+---------------------------------------------------------------------------------------------------+
|                               5. Data Assets & Learning Layer (Data & Assets)                     |
|   +-------------------------------------------+   +-------------------------------------------+   |
|   | Trajectory Exporter (Fine-tuning Datasets)|   | Artifacts Delivery & Preview Hub          |   |
|   +-------------------------------------------+   +-------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

---

## 📂 Project Directory Structure

```
MuseClaw/
├── apps/
│   ├── web/                # Modern React 19 + TypeScript + Vite SPA Workstation (8 Core Views)
│   ├── gateway/            # Central Relay Hub (Hono/Node.js, Session State, IM Gateways, Schedulers)
│   ├── runner/             # Cross-platform Distributed Runner Daemon (systemd / launchd / Windows)
│   └── sentinel/           # Deterministic Sentinel Security Service (Policy, Grants & Audit)
├── packages/
│   ├── protocol/           # End-to-end Cross-channel Protocol Standard (Data Schemas & Type Definitions)
│   └── sandbox-core/       # Sandbox Lifecycle, Micro-sandboxes, Model Router, Prober & Trajectory
├── config/
│   ├── models.json         # LLM Provider & Local Endpoint Configurations
│   └── sentinel-policy.json# Declarative Sentinel Security Rules & Interception Policies
├── docs/                   # System Documentation (Architecture, Design System, Product & Review Reports)
├── tests/                  # End-to-end Automated Test Suites & Regression Verification
├── package.json            # Monorepo Workspace Root Configuration
└── README.md
```

---

## 🧑‍💻 Local Setup & Quick Start

### 1. Prerequisites
* **Node.js**: `>= 20.0.0`
* **pnpm**: `>= 9.0.0`

### 2. Environment Configuration
Copy the environment template and populate necessary credentials:

```bash
cp .env.example .env
```

Key configuration variables:
* LLM Credentials: `DEEPSEEK_API_KEY`, etc.
* Feishu Channel (Optional): `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_ENCRYPT_KEY`, `FEISHU_VERIFICATION_TOKEN`
* Infoflow Channel (Optional): `INFOFLOW_TOKEN`, `INFOFLOW_AES_KEY`, `INFOFLOW_APP_ID`, `INFOFLOW_APP_SECRET`

### 3. Build & Run

```bash
# Install workspace dependencies
pnpm install

# 1. Build frontend production assets (hosted by gateway via apps/web/dist)
pnpm --filter @museclaw/web build

# 2. Launch the Gateway Relay Server
pnpm dev                    # Access workstation: http://localhost:8799

# (Optional) Launch Vite dev server with HMR (API calls proxied to 8799)
pnpm dev:web                # Access dev server: http://localhost:5173

# (Optional) Launch local distributed compute node / runner daemon
pnpm runner
```

### 4. Type Checking & Verification

```bash
# Run TypeScript compilation checks on web workstation
pnpm exec tsc -p apps/web/tsconfig.json --noEmit
```

### 5. Automated Verification Suites

Run core functional self-checks and regression test suites:

```bash
# Thin-Core state machine & Sentinel interception self-check
npx tsx tests/verify-thin-core.ts

# Enterprise security hardening & audit trail self-check
npx tsx tests/verify-enterprise-hardening.ts

# Main Chat & Side Chats hierarchical conversation self-check
npx tsx tests/verify-main-side-chat.ts

# Long-horizon goals engine self-check
npx tsx tests/verify-long-horizon-goals.ts

# Proactive routine & webhook scheduling self-check
npx tsx tests/verify-proactive.ts

# Controlled memory system self-check
npx tsx tests/verify-memory-system.ts

# Feishu / Infoflow enterprise channel verification
npx tsx tests/verify-feishu.ts
npx tsx tests/verify-infoflow.ts
```

---

## 🚀 Initial Development Delivery

All planned milestones for the initial development phase have been completed and verified:

- [x] **Milestone 1: Thin Core & Cross-Channel Protocol**
  - Standardized cross-channel event contracts (Task Plan, Approval Request, Stream Delta, Tool Trace).
  - Minimalist Agent Loop state machine and unified execution environment abstraction.
- [x] **Milestone 2: Deterministic Sentinel Guardrails**
  - Physical interception of destructive system calls, unauthorized file deletions, and restricted endpoints.
  - Complete suspension-approval-resume cycle (Pending -> Approval -> Resume) with tamper-proof auditing.
- [x] **Milestone 3: Enterprise IM Channels & Dual-End Closure**
  - **Feishu / Lark**: WebSocket long-connection and webhook support, encryption, interactive card callbacks, and dual-sync.
  - **Infoflow (如流)**: Signature verification, AES-256 decryption, command handling, and text approval closure.
- [x] **Milestone 4: Proactive Automation & Routines**
  - Standard 5-segment Cron scheduler, natural language cycle interpretation, and next-run predictions.
  - External Webhook real-time triggering, concurrency rate-limiting, and instant execution retry pipelines.
- [x] **Milestone 5: Roster Mode & Modern Web Workstation**
  - Built with React 19 + TypeScript + Vite modern single-page architecture.
  - 8 core business views delivered (ChatView, FeedView, GoalsView, RoutinesView, MemoryView, SkillsView, AuditView, ArtifactsView).
  - Address-book roster interface, SOUL prompt configuration editor, avatar/emoji picker, and non-blocking inline confirmations.
- [x] **Milestone 6: Long-Horizon Goals & Controlled Memory**
  - Multi-stage milestone breakdowns, rapid inline step additions, and autonomous inspection cadences.
  - Dual-track protected and consolidated memory management, dry-run consolidation preview, and quota dashboards.
- [x] **Milestone 7: Distributed Runner Mesh & Model Provider Center**
  - Cross-platform runner daemon for Linux (`systemd`), macOS (`launchd`), and Windows companion services.
  - Automatic probing for local runtimes (Ollama, vLLM) combined with unified cloud LLM routing.
- [x] **Milestone 8: Skills Ecosystem, Artifacts & Compliance Audit**
  - Skills registry with built-in skills and dynamic Zip package parsing.
  - Centralized artifacts preview/download hub and immutable JSONL compliance audit stream.

---

## 📚 Technical Documentation

Complete architectural specifications, design guidelines, and implementation reviews are available in [`docs/`](./docs):

- [System Architecture & Data Flow Specification (ARCHITECTURE.md)](./docs/ARCHITECTURE.md)
- [Product Positioning & Business Boundaries (PRODUCT.md)](./docs/PRODUCT.md)
- [Design System & UI Tokens Specification (DESIGN.md)](./docs/DESIGN.md)
- [Implementation Plan & Phase Deliverables (IMPLEMENTATION_PLAN.md)](./docs/IMPLEMENTATION_PLAN.md)
- [Workstation Refactoring Roadmap (REFACTORING_ROADMAP.md)](./docs/REFACTORING_ROADMAP.md)
- [User Experience Review & Verification Report (USER_EXPERIENCE_REVIEW.md)](./docs/USER_EXPERIENCE_REVIEW.md)
