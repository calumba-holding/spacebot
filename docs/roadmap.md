# MVP Roadmap

Tracking progress toward a working Spacebot that can hold a conversation, delegate work, manage memory, and connect to at least one messaging platform.

For each piece: reference IronClaw, OpenClaw, Nanobot, and Rig for inspiration, but make design decisions that align with Spacebot's architecture. Don't copy patterns that assume a monolithic session model.

---

## Current State

**Project compiles cleanly** (26 warnings, 0 errors). All core abstractions have real implementations backed by Rig framework integration, direct HTTP LLM calls, and database queries. The full message-in → LLM → response-out pipeline is wired end-to-end. The system starts messaging adapters, routes inbound messages to agent channels via binding resolution, runs real Rig agent loops for channels/branches/workers, and routes outbound responses back through the messaging layer.

**What exists and compiles:**
- Project structure — all modules declared, module root pattern (`src/memory.rs` not `mod.rs`)
- Error hierarchy — thiserror domain enums (`ConfigError`, `DbError`, `LlmError`, `MemoryError`, `AgentError`, `SecretsError`) wrapped by top-level `Error` with `#[from]`
- Config — hierarchical TOML config with `Config` (instance-level), `AgentConfig` (per-agent overrides), `ResolvedAgentConfig` (merged), `Binding` (messaging routing with `matches()` and `resolve_agent_for_message()`), `MessagingConfig`. Supports `env:` prefix for secret references. Falls back to env-only loading when no config file exists.
- Multi-agent — `AgentId` type, `Agent` struct (bundles db + deps + identity + prompts per agent), `agent_id` on all `ProcessEvent` variants, `AgentDeps` (with `broadcast::Sender` event bus and `RoutingConfig`), per-agent database isolation. `main.rs` initializes each agent independently with its own Db, MemorySearch, event bus, and ToolServer.
- Database connections — SQLite (sqlx) + LanceDB + redb, per-agent. SQLite migrations for all tables (memories, associations, conversations, heartbeats). Migration runner in `db.rs`.
- LLM — `SpacebotModel` implements Rig's `CompletionModel` trait. Routes through `LlmManager` via direct HTTP to Anthropic, OpenAI, and OpenRouter. Full request/response marshaling with tool definitions and tool calls.
- Model routing — `RoutingConfig` with per-process-type model selection, task-type overrides, fallback chains with retriable error detection (429/502/503/504) and rate limit cooldowns.
- Memory — types, SQLite store (full CRUD + associations), LanceDB embedding storage + vector search + FTS, fastembed (all-MiniLM-L6-v2, 384 dims, shared via `Arc`), hybrid search (vector + FTS + graph traversal + RRF fusion), `MemorySearch` bundles store + lance + embedder. Maintenance (decay + prune implemented, merge stubbed).
- Identity — `Identity` struct loads SOUL.md, IDENTITY.md, USER.md from agent workspace with `render()` for prompt injection. `Prompts` struct loads with fallback chain: agent workspace override → shared prompts dir → relative prompts/. Identity context is injected into channel system prompts.
- Agent loops — all three process types run real Rig agent loops:
  - **Channel** — `AgentBuilder::new(model).preamble(identity + prompt + status).tool_server_handle(shared).build()`, called per-turn via `agent.prompt().with_history().with_hook()`. Per-turn tool registration/teardown via `add_channel_tools()`/`remove_channel_tools()`. `ChannelState` bundle gives tools (branch, spawn_worker, route, cancel, skip, react) direct access to channel state via `Arc<RwLock<_>>`.
  - **Branch** — forks channel history, runs `agent.prompt().with_history().with_hook()` with shared ToolServer (memory_recall, memory_save), `max_turns(10)`. Sends `BranchResult` event on completion. Handles `MaxTurnsError` with partial conclusion extraction.
  - **Worker** — fresh history, per-worker ToolServer (shell, file, exec, set_status), `max_turns(50)`. Interactive mode with follow-up loop on `input_rx`. State machine transitions on completion/failure.
- StatusBlock — event-driven updates from `ProcessEvent`, renders to context string
- SpacebotHook — implements `PromptHook<M>` with `agent_id`, tool call/result event emission, leak detection (regex scanning for API keys/PEM keys)
- CortexHook — implements `PromptHook<M>` for system observation
- Messaging — `Messaging` trait with RPITIT + `MessagingDyn` companion + blanket impl. `MessagingManager` with adapter registry, fan-in stream merging, response routing (Arc-wrapped for shared outbound access). Discord adapter fully implemented (serenity — message handling, streaming via edit, typing indicators, guild filter). Telegram and Webhook adapters are stubs.
- Tools — 11 tools implement Rig's `Tool` trait with real logic. Channel tools (branch, spawn_worker, route, cancel) hold `ChannelState` and actually create/manage Branch/Worker processes. ToolServer topology: shared server for channel/branch with dynamic per-turn registration, per-worker isolated servers, cortex server.
- Message routing — `main.rs` runs a full event loop: starts messaging adapters, consumes merged inbound stream, resolves agent via binding rules, creates channels per conversation (with event bus subscription and outbound response routing task), forwards messages to channel event loops.
- System prompts — 5 prompt files in `prompts/` (CHANNEL.md, BRANCH.md, WORKER.md, COMPACTOR.md, CORTEX.md)
- Conversation — `HistoryStore` with turn CRUD, sequence numbering, compaction summary storage. Context assembly (prompt + identity + memories + status block).
- Heartbeat — scheduler with timer management, active hours filtering, circuit breaker (3 failures → disable). `HeartbeatStore` CRUD in SQLite.

**What's stubbed or missing:**
- Compactor — threshold monitoring works, `run_compaction_worker()` is a placeholder, `emergency_truncate()` just logs
- Cortex — signal buffering works, `run_consolidation()` just logs
- Heartbeat execution — scheduler fires, but `run_heartbeat()` doesn't create channels
- RouteTool — validates worker exists and is interactive, but `input_tx` isn't stored accessibly after spawn
- Conversation persistence — history lives in-memory only, `HistoryStore` exists but isn't called from the message flow
- Streaming not implemented (`SpacebotModel.stream()` returns error)
- Secrets and settings stores are empty structs
- Telegram and Webhook adapters are empty structs

**Known bugs:**
- Arrow version mismatch in Cargo.toml: `arrow = "54"` vs `arrow-array`/`arrow-schema` at `"57.3.0"` — should align or drop the `arrow` meta-crate
- `lance.rs` casts `_distance`/`_score` columns as `Float64Type` — LanceDB returns `Float32`, will panic at runtime on any memory search
- `definition()` on all tools hand-writes JSON schemas instead of using the `JsonSchema` derive on `Args` types. Dual maintenance burden. Low priority cleanup.

---

## ~~Phase 1: Migrations and LanceDB~~ Done

- [x] SQLite migrations for all tables (memories, associations, conversations, heartbeats)
- [x] Inline DDL removed from `memory/store.rs`, `conversation/history.rs`, `heartbeat/store.rs`
- [x] `memory/lance.rs` — LanceDB table with Arrow schema, embedding insert, vector search (cosine), FTS (Tantivy), index creation
- [x] Embedding generation wired into memory save flow (`memory_save.rs` generates + stores)
- [x] Vector + FTS results connected into hybrid search via `MemorySearch` struct
- [x] `MemorySearch` bundles `MemoryStore` + `EmbeddingTable` + `EmbeddingModel`, replaces `memory_store` in `AgentDeps`

---

## ~~Phase 2: Wire Tools to Rig~~ Done

- [x] All 11 tools implement Rig's `Tool` trait
- [x] `AgentDeps.tool_server` uses `rig::tool::server::ToolServerHandle` directly
- [x] `PromptHook<M>` on `SpacebotHook` and `CortexHook`
- [x] `agent_id: AgentId` threaded through SpacebotHook, SetStatusTool, all ProcessEvent variants
- [x] `MemorySaveTool` — `channel_id` field added to `MemorySaveArgs`, wired into `Memory::with_channel_id()`
- [x] `ReplyTool` — replaced `Arc<InboundMessage>` with `mpsc::Sender<OutboundResponse>` for ToolServer compatibility
- [x] `EmbeddingModel` — fixed `embed_one()` to share model via `Arc` instead of creating new instance per call

---

## ~~Phase 3: System Prompts, Identity, and Multi-Agent~~ Done

- [x] `prompts/` directory with all 5 prompt files (CHANNEL.md, BRANCH.md, WORKER.md, COMPACTOR.md, CORTEX.md)
- [x] `identity/files.rs` — `Identity` struct (SOUL.md, IDENTITY.md, USER.md), `Prompts` struct with workspace-aware fallback loading
- [x] `conversation/context.rs` — `build_channel_context()`, `build_branch_context()`, `build_worker_context()`
- [x] `conversation/history.rs` — `HistoryStore` with save_turn, load_recent, compaction summaries
- [x] Multi-agent config — hierarchical TOML with `AgentConfig`, `DefaultsConfig`, `ResolvedAgentConfig`, `Binding`, `MessagingConfig`
- [x] Per-agent database isolation — each agent gets its own SQLite, LanceDB, redb in `agents/{id}/data/`
- [x] `Agent` struct bundles db + deps + identity + prompts per agent
- [x] `main.rs` per-agent initialization loop with shared LlmManager + EmbeddingModel
- [x] Prompt resolution fallback chain (agent workspace → shared prompts → relative)

---

## ~~Phase 4: The Channel (MVP Core)~~ Done

- [x] `RoutingConfig` — process-type defaults, task-type overrides, fallback chains
- [x] Fallback logic in `SpacebotModel` — retry with next model in chain on 429/502/503/504
- [x] Rate limit tracking — deprioritize 429'd models for configurable cooldown
- [x] Shared ToolServer for channel/branch tools (memory_save, memory_recall at startup; reply, branch, spawn_worker, route, cancel, skip, react added per-turn)
- [x] Per-worker ToolServer factory (shell, file, exec, set_status)
- [x] Real Rig agent loop: `AgentBuilder::new(model).preamble().tool_server_handle().build()` → `agent.prompt().with_history().with_hook().await`
- [x] Status block injection — prepend rendered status to each prompt call
- [x] Identity injection — prepend identity context (SOUL/IDENTITY/USER) to system prompt
- [x] Discord adapter — full serenity implementation (message handling, streaming via edit, typing indicators, guild filter)
- [x] `ChannelState` bundle — shared state for channel tools with `Arc<RwLock<_>>` access to history, active branches/workers, status block

---

## ~~Phase 5: Branches and Workers~~ Done

- [x] Branch: real Rig agent loop with `max_turns(10)`, shared ToolServer, history fork
- [x] Branch result injection — conclusion returned via `ProcessEvent::BranchResult`
- [x] Branch concurrency limit enforcement
- [x] Worker: real Rig agent loop with `max_turns(50)`, per-worker ToolServer, fresh history
- [x] Worker state machine with transition validation
- [x] Worker status reporting via set_status tool → StatusBlock updates
- [x] Interactive worker follow-up loop on `input_rx`
- [x] `MaxTurnsError` / `PromptCancelled` handling with partial result extraction
- [x] `BranchTool` actually creates and spawns Branch processes
- [x] `SpawnWorkerTool` actually creates and spawns Worker processes
- [x] `CancelTool` actually aborts branches and removes workers

---

## ~~Phase 6: Messaging Routing~~ Done

- [x] Binding resolver — `Binding::matches()` checks platform + guild_id/chat_id, `resolve_agent_for_message()` with default fallback
- [x] Message routing loop in `main.rs` — consumes merged inbound stream, resolves agent, creates/reuses channels
- [x] Channel lifecycle — create on first message per conversation, spawn `Channel::run()` as tokio task
- [x] Outbound response routing — per-channel task reads from `response_rx`, calls `messaging_manager.respond()`
- [x] Event bus — `broadcast::Sender<ProcessEvent>` in `AgentDeps`, channels subscribe via `.subscribe()`
- [x] `MessagingManager` Arc-wrapped for shared outbound access
- [x] Graceful shutdown — drop channels, shutdown adapters, close DBs

---

## Phase 7: First Test and Bug Fixes

Get a real end-to-end response working. Fix the known runtime bugs.

- [ ] Fix Arrow type mismatch — `lance.rs` casts `_distance`/`_score` as `Float64Type` but LanceDB returns `Float32`
- [ ] Fix arrow version mismatch in `Cargo.toml`
- [ ] Store worker `input_tx` accessibly so `RouteTool` can deliver follow-up messages
- [ ] Test: send a message via Discord, get a real LLM response back
- [ ] Test: trigger a branch (message that requires memory recall), verify branch result incorporation
- [ ] Test: trigger a worker (ask for a file operation), verify worker completion

---

## Phase 8: Conversation Persistence and Compaction

- [ ] Wire `HistoryStore::save_turn()` into channel message flow (fire-and-forget DB writes)
- [ ] Load conversation history from DB on channel creation (resume across restarts)
- [ ] Implement compaction worker — summarize old turns + extract memories via LLM
- [ ] Emergency truncation — drop oldest turns without LLM, keep N recent
- [ ] Pre-compaction archiving — write raw transcript to conversation_archives table

---

## Phase 9: Webhook Adapter

HTTP adapter for testing and programmatic access without Discord.

- [ ] Implement WebhookAdapter (axum) — POST endpoint for `InboundMessage`, response routing
- [ ] Optional sync mode (`"wait": true` blocks until agent responds)
- [ ] Test: `curl -X POST` a message, get a response back

---

## Post-MVP

Not blocking the first working version, but next in line.

- **Streaming** — implement `SpacebotModel.stream()` with SSE parsing, wire through messaging adapters with block coalescing (see `docs/messaging.md`)
- **Cortex** — system-level observer, memory consolidation, decay management. See `docs/cortex.md`.
- **Heartbeats** — wire `run_heartbeat()` to create fresh channels. Scheduler and circuit breaker already work.
- **Telegram adapter** — teloxide, long polling mode.
- **Secrets store** — AES-256-GCM encrypted credentials in redb.
- **Settings store** — redb key-value with env > DB > default resolution.
- **Memory graph traversal during recall** — walk typed edges (Updates, Contradicts, CausedBy) during search.
- **Agent CLI** — `spacebot agents list/create/delete`, identity template bootstrapping.
- **Cross-agent communication** — routing between agents, shared observations.
- **Tool nudging** — inject "use your tools" in `SpacebotHook.on_completion_response()` when LLM responds with text in early iterations.
