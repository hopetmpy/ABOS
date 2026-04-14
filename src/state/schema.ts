/**
 * Automaton SQLite Schema
 *
 * All tables for the automaton's persistent state.
 * The database IS the automaton's memory.
 */

export const SCHEMA_VERSION = 21;

export const CREATE_TABLES = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Core identity key-value store
  CREATE TABLE IF NOT EXISTS identity (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Agent reasoning turns (the thinking/action log)
  -- Application-level validation: state must be a valid AgentState ('setup','waking','running','sleeping','low_compute','critical','dead')
  CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    state TEXT NOT NULL,
    input TEXT,
    input_source TEXT,
    thinking TEXT NOT NULL,
    tool_calls TEXT NOT NULL DEFAULT '[]',
    token_usage TEXT NOT NULL DEFAULT '{}',
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Tool call results (denormalized for fast lookup)
  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES turns(id),
    name TEXT NOT NULL,
    arguments TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Heartbeat configuration entries
  -- Application-level validation: enabled must be 0 or 1 (boolean integer)
  CREATE TABLE IF NOT EXISTS heartbeat_entries (
    name TEXT PRIMARY KEY,
    schedule TEXT NOT NULL,
    task TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    next_run TEXT,
    params TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Financial transaction log
  -- Application-level validation: type must be one of 'transfer_out','transfer_in','credit_purchase','topup','x402_payment','inference'
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    amount_cents INTEGER,
    balance_after_cents INTEGER,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Installed tools and MCP servers
  CREATE TABLE IF NOT EXISTS installed_tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled INTEGER NOT NULL DEFAULT 1
  );

  -- Self-modification audit log (append-only)
  CREATE TABLE IF NOT EXISTS modifications (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    file_path TEXT,
    diff TEXT,
    reversible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- General key-value store for arbitrary state
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Installed skills
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    auto_activate INTEGER NOT NULL DEFAULT 1,
    requires TEXT DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'builtin',
    path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Spawned child automatons
  -- Application-level validation: status must be one of 'spawning','running','sleeping','dead','unknown'
  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    genesis_prompt TEXT NOT NULL,
    creator_message TEXT,
    funded_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT
  );

  -- ERC-8004 registration state
  CREATE TABLE IF NOT EXISTS registry (
    agent_id TEXT PRIMARY KEY,
    agent_uri TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'eip155:8453',
    contract_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Reputation feedback received and given
  -- Application-level validation: score must be 1-5
  CREATE TABLE IF NOT EXISTS reputation (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indices for common queries
  CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
  CREATE INDEX IF NOT EXISTS idx_turns_state ON turns(state);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_modifications_type ON modifications(type);
  CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
  CREATE INDEX IF NOT EXISTS idx_reputation_to ON reputation(to_agent);

  -- Inbox messages table
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    reply_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;
`;

export const MIGRATION_V3 = `
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    reply_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;
`;

export const MIGRATION_V4 = `
  -- Policy decisions table
  CREATE TABLE IF NOT EXISTS policy_decisions (
    id TEXT PRIMARY KEY,
    turn_id TEXT,
    tool_name TEXT NOT NULL,
    tool_args_hash TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK(risk_level IN ('safe','caution','dangerous','forbidden')),
    decision TEXT NOT NULL CHECK(decision IN ('allow','deny','quarantine')),
    rules_evaluated TEXT NOT NULL DEFAULT '[]',
    rules_triggered TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_policy_decisions_turn ON policy_decisions(turn_id);
  CREATE INDEX IF NOT EXISTS idx_policy_decisions_tool ON policy_decisions(tool_name);
  CREATE INDEX IF NOT EXISTS idx_policy_decisions_decision ON policy_decisions(decision);

  -- Spend tracking table
  CREATE TABLE IF NOT EXISTS spend_tracking (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    recipient TEXT,
    domain TEXT,
    category TEXT NOT NULL CHECK(category IN ('transfer','x402','inference','other')),
    window_hour TEXT NOT NULL,
    window_day TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_spend_hour ON spend_tracking(category, window_hour);
  CREATE INDEX IF NOT EXISTS idx_spend_day ON spend_tracking(category, window_day);

  -- Heartbeat schedule (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_schedule (
    task_name TEXT PRIMARY KEY,
    cron_expression TEXT NOT NULL,
    interval_ms INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    max_retries INTEGER NOT NULL DEFAULT 1,
    tier_minimum TEXT NOT NULL DEFAULT 'dead'
      CHECK(tier_minimum IN ('dead','critical','low_compute','normal','high')),
    last_run_at TEXT,
    next_run_at TEXT,
    last_result TEXT CHECK(last_result IN ('success','failure','timeout','skipped') OR last_result IS NULL),
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Heartbeat history (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_history (
    id TEXT PRIMARY KEY,
    task_name TEXT NOT NULL REFERENCES heartbeat_schedule(task_name),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    result TEXT NOT NULL CHECK(result IN ('success','failure','timeout','skipped')),
    duration_ms INTEGER,
    error TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hb_history_task ON heartbeat_history(task_name, started_at);

  -- Wake events (Phase 1.1)
  CREATE TABLE IF NOT EXISTS wake_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wake_unconsumed ON wake_events(created_at) WHERE consumed_at IS NULL;

  -- Heartbeat dedup (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_dedup (
    dedup_key TEXT PRIMARY KEY,
    task_name TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_dedup_expires ON heartbeat_dedup(expires_at);

  -- Data migration: heartbeat_entries -> heartbeat_schedule
  INSERT OR IGNORE INTO heartbeat_schedule (task_name, cron_expression, enabled, last_run_at, next_run_at)
  SELECT name, schedule, enabled, last_run, next_run FROM heartbeat_entries;
`;

// Inbox modifications for V4 (ALTER TABLE must be run separately from CREATE TABLE)
export const MIGRATION_V4_ALTER = `
  ALTER TABLE inbox_messages ADD COLUMN to_address TEXT;
`;

export const MIGRATION_V4_ALTER2 = `
  ALTER TABLE inbox_messages ADD COLUMN raw_content TEXT;
`;

// Inbox state machine columns (Phase 1.2)
// Note: SQLite ALTER TABLE ADD COLUMN cannot include CHECK constraints,
// so status validation is enforced at the application level.
export const MIGRATION_V4_ALTER_INBOX_STATUS = `
  ALTER TABLE inbox_messages ADD COLUMN status TEXT DEFAULT 'received';
`;

export const MIGRATION_V4_ALTER_INBOX_RETRY = `
  ALTER TABLE inbox_messages ADD COLUMN retry_count INTEGER DEFAULT 0;
`;

export const MIGRATION_V4_ALTER_INBOX_MAX_RETRIES = `
  ALTER TABLE inbox_messages ADD COLUMN max_retries INTEGER DEFAULT 3;
`;

export const MIGRATION_V2 = `
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    auto_activate INTEGER NOT NULL DEFAULT 1,
    requires TEXT DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'builtin',
    path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    genesis_prompt TEXT NOT NULL,
    creator_message TEXT,
    funded_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT
  );

  CREATE TABLE IF NOT EXISTS registry (
    agent_id TEXT PRIMARY KEY,
    agent_uri TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'eip155:8453',
    contract_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reputation (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
  CREATE INDEX IF NOT EXISTS idx_reputation_to ON reputation(to_agent);
`;

// === Phase 2.1 + 2.2: Soul + Memory Tables ===

export const MIGRATION_V5 = `
  -- === Phase 2.1: Soul System ===

  CREATE TABLE IF NOT EXISTS soul_history (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    change_source TEXT NOT NULL CHECK(change_source IN ('agent','human','system','genesis','reflection')),
    change_reason TEXT,
    previous_version_id TEXT REFERENCES soul_history(id),
    approved_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_soul_version ON soul_history(version);

  -- === Phase 2.2: Memory System ===

  CREATE TABLE IF NOT EXISTS working_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN ('goal','observation','plan','reflection','task','decision','note','summary')),
    priority REAL NOT NULL DEFAULT 0.5,
    token_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    source_turn TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wm_session ON working_memory(session_id, priority);

  CREATE TABLE IF NOT EXISTS episodic_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    outcome TEXT CHECK(outcome IN ('success','failure','partial','neutral') OR outcome IS NULL),
    importance REAL NOT NULL DEFAULT 0.5,
    embedding_key TEXT,
    token_count INTEGER NOT NULL DEFAULT 0,
    accessed_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    classification TEXT NOT NULL DEFAULT 'maintenance' CHECK(classification IN ('strategic','productive','communication','maintenance','idle','error')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(event_type);
  CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance);
  CREATE INDEX IF NOT EXISTS idx_episodic_classification ON episodic_memory(classification);

  CREATE TABLE IF NOT EXISTS session_summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    key_decisions TEXT NOT NULL DEFAULT '[]',
    tools_used TEXT NOT NULL DEFAULT '[]',
    outcomes TEXT NOT NULL DEFAULT '[]',
    turn_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS semantic_memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK(category IN ('self','environment','financial','agent','domain','procedural_ref','creator')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL,
    embedding_key TEXT,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(category, key)
  );

  CREATE INDEX IF NOT EXISTS idx_semantic_category ON semantic_memory(category);

  CREATE TABLE IF NOT EXISTS procedural_memory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    steps TEXT NOT NULL,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS relationship_memory (
    id TEXT PRIMARY KEY,
    entity_address TEXT NOT NULL UNIQUE,
    entity_name TEXT,
    relationship_type TEXT NOT NULL,
    trust_score REAL NOT NULL DEFAULT 0.5,
    interaction_count INTEGER NOT NULL DEFAULT 0,
    last_interaction_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rel_trust ON relationship_memory(trust_score);
`;

// === Phase 2.3: Inference & Model Strategy Tables ===

export const MIGRATION_V6 = `
  -- === Phase 2.3: Inference & Model Strategy ===

  CREATE TABLE IF NOT EXISTS inference_costs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK(task_type IN ('agent_turn','heartbeat_triage','safety_check','summarization','planning')),
    cache_hit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_inf_session ON inference_costs(session_id);
  CREATE INDEX IF NOT EXISTS idx_inf_model ON inference_costs(model);
  CREATE INDEX IF NOT EXISTS idx_inf_created ON inference_costs(created_at);
  CREATE INDEX IF NOT EXISTS idx_inf_task ON inference_costs(task_type);

  CREATE TABLE IF NOT EXISTS model_registry (
    model_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    tier_minimum TEXT NOT NULL DEFAULT 'normal',
    cost_per_1k_input INTEGER NOT NULL DEFAULT 0,
    cost_per_1k_output INTEGER NOT NULL DEFAULT 0,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    context_window INTEGER NOT NULL DEFAULT 128000,
    supports_tools INTEGER NOT NULL DEFAULT 1,
    supports_vision INTEGER NOT NULL DEFAULT 0,
    parameter_style TEXT NOT NULL DEFAULT 'max_tokens' CHECK(parameter_style IN ('max_tokens','max_completion_tokens')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// === Phase 3: Replication + Social ===

export const MIGRATION_V7 = `
  -- === Phase 3.1: Replication Lifecycle ===

  CREATE TABLE IF NOT EXISTS child_lifecycle_events (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL CHECK(to_state IN (
      'requested','sandbox_created','runtime_ready','wallet_verified',
      'funded','starting','healthy','unhealthy','stopped','failed','cleaned_up'
    )),
    reason TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_child_events ON child_lifecycle_events(child_id, created_at);

  -- === Phase 3.2: Social & Registry ===

  CREATE TABLE IF NOT EXISTS discovered_agents_cache (
    agent_address TEXT PRIMARY KEY,
    agent_card TEXT NOT NULL,
    fetched_from TEXT NOT NULL,
    card_hash TEXT NOT NULL,
    valid_until TEXT,
    fetch_count INTEGER NOT NULL DEFAULT 1,
    last_fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onchain_transactions (
    id TEXT PRIMARY KEY,
    tx_hash TEXT NOT NULL UNIQUE,
    chain TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    gas_used INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_onchain_status ON onchain_transactions(status);
`;

// === Phase 4.1: Observability ===

export const MIGRATION_V8 = `
  -- === Phase 4.1: Observability ===

  CREATE TABLE IF NOT EXISTS metric_snapshots (
    id TEXT PRIMARY KEY,
    snapshot_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '[]',
    alerts_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_metric_snapshots_at ON metric_snapshots(snapshot_at);
`;

// === Plan A: Orchestration + Memory ===

export const MIGRATION_V9 = `
  -- Schema version: 9
  -- Tables: goals, task_graph, event_stream

  CREATE TABLE goals (
    id TEXT PRIMARY KEY,                    -- ULID
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',  -- active|completed|failed|paused
    strategy TEXT,
    expected_revenue_cents INTEGER DEFAULT 0,
    actual_revenue_cents INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    deadline TEXT,
    completed_at TEXT
  );

  CREATE TABLE task_graph (
    id TEXT PRIMARY KEY,                    -- ULID
    parent_id TEXT,                         -- parent task (decomposition)
    goal_id TEXT NOT NULL REFERENCES goals(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending|assigned|running|completed|failed|blocked|cancelled
    assigned_to TEXT,                       -- agent wallet address (0x...)
    agent_role TEXT,                        -- predefined role name
    priority INTEGER DEFAULT 50,           -- 0-100
    dependencies TEXT DEFAULT '[]',        -- JSON array of task IDs
    result TEXT,                           -- JSON TaskResult
    estimated_cost_cents INTEGER DEFAULT 0,
    actual_cost_cents INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    retry_count INTEGER DEFAULT 0,
    timeout_ms INTEGER DEFAULT 300000,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX idx_task_graph_goal ON task_graph(goal_id);
  CREATE INDEX idx_task_graph_status ON task_graph(status);
  CREATE INDEX idx_task_graph_assigned ON task_graph(assigned_to);

  CREATE TABLE event_stream (
    id TEXT PRIMARY KEY,                    -- ULID
    type TEXT NOT NULL,                     -- EventType enum
    agent_address TEXT NOT NULL,
    goal_id TEXT,
    task_id TEXT,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    compacted_to TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX idx_events_agent ON event_stream(agent_address, created_at);
  CREATE INDEX idx_events_goal ON event_stream(goal_id, created_at);
  CREATE INDEX idx_events_type ON event_stream(type, created_at);
`;

// Role column for children table (must be separate statement for SQLite ALTER)
export const MIGRATION_V9_ALTER_CHILDREN_ROLE = `
  ALTER TABLE children ADD COLUMN role TEXT DEFAULT 'generalist';
`;

// === Solana Integration: Chain Type Column ===

export const MIGRATION_V11 = `
  -- Schema version: 11
  -- Add chain_type column to children table for multi-chain support
  ALTER TABLE children ADD COLUMN chain_type TEXT DEFAULT 'evm';
`;

export const MIGRATION_V10 = `
  -- Schema version: 10
  -- Tables: knowledge_store

  CREATE TABLE knowledge_store (
    id TEXT PRIMARY KEY,                    -- ULID
    category TEXT NOT NULL,                 -- market|technical|social|financial|operational
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,                   -- agent address that contributed
    confidence REAL DEFAULT 1.0,
    last_verified TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    token_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX idx_knowledge_category ON knowledge_store(category);
  CREATE INDEX idx_knowledge_key ON knowledge_store(key);
`;

// === Sales & Marketing: Prospect Pipeline + Campaigns ===

export const MIGRATION_V12 = `
  -- Schema version: 12
  -- Tables: prospect_pipeline, campaigns

  CREATE TABLE IF NOT EXISTS prospect_pipeline (
    id TEXT PRIMARY KEY,
    entity_address TEXT NOT NULL,
    prospect_name TEXT,
    company TEXT,
    title TEXT,
    email TEXT,
    stage TEXT NOT NULL DEFAULT 'cold' CHECK(stage IN ('cold','contacted','engaged','qualified','negotiating','won','lost','nurture')),
    source TEXT,
    deal_value_cents INTEGER DEFAULT 0,
    expected_close_date TEXT,
    segment TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_prospect_stage ON prospect_pipeline(stage);
  CREATE INDEX IF NOT EXISTS idx_prospect_entity ON prospect_pipeline(entity_address);
  CREATE INDEX IF NOT EXISTS idx_prospect_company ON prospect_pipeline(company);

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    campaign_type TEXT NOT NULL DEFAULT 'outreach' CHECK(campaign_type IN ('outreach','nurture','content','event','competitive_intel')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed','cancelled')),
    target_segment TEXT,
    goal_id TEXT,
    total_sent INTEGER DEFAULT 0,
    total_opened INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    total_replied INTEGER DEFAULT 0,
    total_converted INTEGER DEFAULT 0,
    cost_cents INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns(status);
  CREATE INDEX IF NOT EXISTS idx_campaign_type ON campaigns(campaign_type);
`;

// === Tier 1: Email Sequences, Auth, Enrichment, Lead Scoring, Activity Log ===

export const MIGRATION_V13 = `
  -- Schema version: 13
  -- Tier 1 critical gaps: email sequences, auth, enrichment, lead scoring, activity timeline

  -- Email templates (reusable email content with A/B variants)
  CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    variant_label TEXT DEFAULT 'A',
    campaign_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Email sequences (multi-step cadences)
  CREATE TABLE IF NOT EXISTS email_sequences (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    campaign_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed')),
    steps TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Email events (deliverability tracking: sent, delivered, opened, clicked, bounced, replied, complained)
  CREATE TABLE IF NOT EXISTS email_events (
    id TEXT PRIMARY KEY,
    prospect_id TEXT,
    template_id TEXT,
    sequence_id TEXT,
    campaign_id TEXT,
    event_type TEXT NOT NULL CHECK(event_type IN ('sent','delivered','opened','clicked','bounced','replied','complained','unsubscribed')),
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_email_events_prospect ON email_events(prospect_id);
  CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_email_events_campaign ON email_events(campaign_id);

  -- Enrichment queue (dashboard queues requests, agent fulfills via Apollo MCP)
  CREATE TABLE IF NOT EXISTS enrichment_queue (
    id TEXT PRIMARY KEY,
    prospect_id TEXT NOT NULL,
    entity_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_enrichment_status ON enrichment_queue(status);

  -- Lead scoring configuration (weighted criteria)
  CREATE TABLE IF NOT EXISTS lead_score_rules (
    id TEXT PRIMARY KEY,
    field TEXT NOT NULL,
    operator TEXT NOT NULL CHECK(operator IN ('equals','contains','greater_than','less_than','exists','not_empty')),
    value TEXT,
    points INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Activity log (unified timeline per prospect)
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    prospect_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata TEXT,
    actor TEXT DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activity_prospect ON activity_log(prospect_id, created_at);

  -- Dashboard auth tokens
  CREATE TABLE IF NOT EXISTS dashboard_auth (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT DEFAULT 'default',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
`;

// === SMTP Email Adapter ===

export const MIGRATION_V14 = `
  -- Schema version: 14
  -- SMTP email adapter: accounts, send queue, sent log

  CREATE TABLE IF NOT EXISTS email_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email_address TEXT NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_secure INTEGER NOT NULL DEFAULT 0,
    smtp_user TEXT NOT NULL,
    smtp_pass TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    daily_limit INTEGER NOT NULL DEFAULT 50,
    sent_today INTEGER NOT NULL DEFAULT 0,
    sent_today_reset TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','error')),
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_send_queue (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    prospect_id TEXT,
    campaign_id TEXT,
    sequence_id TEXT,
    template_id TEXT,
    to_email TEXT NOT NULL,
    to_name TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','cancelled')),
    scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT,
    error TEXT,
    message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_send_queue_status ON email_send_queue(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_send_queue_prospect ON email_send_queue(prospect_id);
`;

// === LinkedIn Outreach + Humantic AI Personality ===

export const MIGRATION_V15 = `
  -- Schema version: 15
  -- LinkedIn outreach queue + Humantic AI personality profiles

  CREATE TABLE IF NOT EXISTS humantic_profiles (
    id TEXT PRIMARY KEY,
    prospect_id TEXT NOT NULL,
    linkedin_url TEXT,
    disc_type TEXT,
    disc_dominance REAL,
    disc_influence REAL,
    disc_steadiness REAL,
    disc_conscientiousness REAL,
    ocean_openness REAL,
    ocean_conscientiousness REAL,
    ocean_extraversion REAL,
    ocean_agreeableness REAL,
    ocean_neuroticism REAL,
    communication_style TEXT,
    dos TEXT,
    donts TEXT,
    buyer_persona TEXT,
    confidence REAL DEFAULT 0,
    raw_response TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_humantic_prospect ON humantic_profiles(prospect_id);

  CREATE TABLE IF NOT EXISTS linkedin_outreach_queue (
    id TEXT PRIMARY KEY,
    prospect_id TEXT NOT NULL,
    prospect_name TEXT,
    company TEXT,
    title TEXT,
    linkedin_url TEXT,
    message TEXT NOT NULL,
    personality_context TEXT,
    disc_type TEXT,
    campaign_id TEXT,
    status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','copied','sent','skipped')),
    sent_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_linkedin_queue_status ON linkedin_outreach_queue(status);
`;

// === AI Content Generation, Brand Knowledge, A/B Testing ===

export const MIGRATION_V16 = `
  -- Schema version: 16
  -- AI providers, brand knowledge base, generated content history, A/B tests

  -- AI provider API keys (OpenAI, Claude, Gemini, Grok)
  CREATE TABLE IF NOT EXISTS ai_providers (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL UNIQUE CHECK(provider IN ('openai','anthropic','google','xai')),
    api_key TEXT NOT NULL,
    default_model TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Brand knowledge base
  CREATE TABLE IF NOT EXISTS brand_knowledge (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK(category IN ('company','product','pricing','icp','voice','case_study','competitor','faq')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_brand_category ON brand_knowledge(category);

  -- Generated content history
  CREATE TABLE IF NOT EXISTS generated_content (
    id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL CHECK(content_type IN ('email_subject','email_body','linkedin_message','whatsapp_message','social_post','ad_copy','landing_page','blog_outline','image','custom')),
    channel TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    output TEXT NOT NULL,
    prospect_id TEXT,
    campaign_id TEXT,
    ab_test_id TEXT,
    variant_label TEXT,
    disc_type TEXT,
    brand_context_used INTEGER NOT NULL DEFAULT 0,
    saved_as_template INTEGER NOT NULL DEFAULT 0,
    rating INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_generated_type ON generated_content(content_type);
  CREATE INDEX IF NOT EXISTS idx_generated_prospect ON generated_content(prospect_id);

  -- A/B tests
  CREATE TABLE IF NOT EXISTS ab_tests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('email','linkedin','whatsapp','other')),
    test_field TEXT NOT NULL CHECK(test_field IN ('subject','body','full_message')),
    campaign_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','completed','cancelled')),
    variant_a_content TEXT NOT NULL,
    variant_a_label TEXT NOT NULL DEFAULT 'A',
    variant_b_content TEXT NOT NULL,
    variant_b_label TEXT NOT NULL DEFAULT 'B',
    variant_a_sent INTEGER NOT NULL DEFAULT 0,
    variant_a_replies INTEGER NOT NULL DEFAULT 0,
    variant_b_sent INTEGER NOT NULL DEFAULT 0,
    variant_b_replies INTEGER NOT NULL DEFAULT 0,
    min_sample_size INTEGER NOT NULL DEFAULT 200,
    auto_declare_after_hours INTEGER NOT NULL DEFAULT 48,
    winner TEXT CHECK(winner IN ('A','B',NULL)),
    winner_declared_at TEXT,
    started_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ab_status ON ab_tests(status);
`;

// === Tier 1: Autonomous Goals, Microsites ===

export const MIGRATION_V17 = `
  -- Schema version: 17
  -- Autonomous goal execution + campaign microsites

  -- Add auto-execute and plan fields to goals (ALTER TABLE for existing table)
  -- These may fail if columns already exist, which is fine
  ALTER TABLE goals ADD COLUMN auto_execute_at TEXT;
  ALTER TABLE goals ADD COLUMN plan_json TEXT;

  -- Add landing page fields to campaigns
  ALTER TABLE campaigns ADD COLUMN landing_page_url TEXT;
  ALTER TABLE campaigns ADD COLUMN landing_page_html TEXT;
`;

// === Phase 1: Email Deliverability Infrastructure ===

export const MIGRATION_V18 = `
  -- Schema version: 18
  -- Email deliverability: suppression list, warm-up schedules, inbox placement, bounce classification

  CREATE TABLE IF NOT EXISTS email_suppressions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL CHECK(reason IN ('hard_bounce','complaint','unsubscribed','invalid','manual')),
    bounce_count INTEGER DEFAULT 1,
    suppressed_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_suppression_email ON email_suppressions(email);

  CREATE TABLE IF NOT EXISTS email_warmup_schedules (
    account_id TEXT NOT NULL PRIMARY KEY,
    start_date TEXT NOT NULL,
    current_day INTEGER NOT NULL DEFAULT 0,
    target_daily_limit INTEGER NOT NULL DEFAULT 50,
    config TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','paused')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_inbox_tracking (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    recipient_domain TEXT NOT NULL,
    placement TEXT CHECK(placement IN ('inbox','spam','promotions','other')),
    spf_pass INTEGER,
    dkim_pass INTEGER,
    dmarc_pass INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_tracking_account ON email_inbox_tracking(account_id);
`;

// === Phase 2: Sequence Engine + Open/Click Tracking ===

export const MIGRATION_V19 = `
  -- Schema version: 19
  -- Sequence enrollments, open/click tracking

  CREATE TABLE IF NOT EXISTS sequence_enrollments (
    id TEXT PRIMARY KEY,
    sequence_id TEXT NOT NULL,
    prospect_id TEXT NOT NULL,
    campaign_id TEXT,
    account_id TEXT,
    current_step INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','replied','bounced','unsubscribed')),
    next_send_at TEXT,
    last_sent_at TEXT,
    last_opened_at TEXT,
    last_clicked_at TEXT,
    last_replied_at TEXT,
    timezone TEXT DEFAULT 'UTC',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_enrollment_sequence ON sequence_enrollments(sequence_id, status);
  CREATE INDEX IF NOT EXISTS idx_enrollment_prospect ON sequence_enrollments(prospect_id);
  CREATE INDEX IF NOT EXISTS idx_enrollment_next_send ON sequence_enrollments(status, next_send_at);

  CREATE TABLE IF NOT EXISTS open_click_tracking (
    id TEXT PRIMARY KEY,
    tracking_type TEXT NOT NULL CHECK(tracking_type IN ('open','click')),
    enrollment_id TEXT,
    prospect_id TEXT,
    campaign_id TEXT,
    sequence_step INTEGER,
    original_url TEXT,
    user_agent TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tracking_enrollment ON open_click_tracking(enrollment_id);
  CREATE INDEX IF NOT EXISTS idx_tracking_type ON open_click_tracking(tracking_type);
`;

// === Phase 3: Reply Detection & Unified Inbox ===

export const MIGRATION_V20 = `
  -- Schema version: 20
  -- Email replies table for unified inbox, sentiment classification, prospect linking

  CREATE TABLE IF NOT EXISTS email_replies (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    from_email TEXT NOT NULL,
    from_name TEXT,
    to_email TEXT NOT NULL,
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    in_reply_to TEXT,
    message_id TEXT UNIQUE,
    prospect_id TEXT,
    enrollment_id TEXT,
    sentiment TEXT CHECK(sentiment IN ('interested','not_interested','out_of_office','bounce','unsubscribe','neutral')),
    sentiment_confidence REAL,
    is_read INTEGER DEFAULT 0,
    replied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_replies_prospect ON email_replies(prospect_id);
  CREATE INDEX IF NOT EXISTS idx_replies_sentiment ON email_replies(sentiment);
  CREATE INDEX IF NOT EXISTS idx_replies_read ON email_replies(is_read);
  CREATE INDEX IF NOT EXISTS idx_replies_message_id ON email_replies(message_id);
`;

// === LinkedIn + Email Pipeline: DISC Effectiveness ===

export const MIGRATION_V21 = `
  -- Schema version: 21
  -- DISC effectiveness tracking for LinkedIn + Email outreach

  CREATE TABLE IF NOT EXISTS disc_effectiveness (
    id TEXT PRIMARY KEY,
    disc_type TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('email','linkedin','both')),
    message_style TEXT,
    sent INTEGER DEFAULT 0,
    opened INTEGER DEFAULT 0,
    clicked INTEGER DEFAULT 0,
    replied INTEGER DEFAULT 0,
    converted INTEGER DEFAULT 0,
    open_rate REAL DEFAULT 0,
    reply_rate REAL DEFAULT 0,
    period TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_disc_eff_type ON disc_effectiveness(disc_type);
  CREATE INDEX IF NOT EXISTS idx_disc_eff_channel ON disc_effectiveness(channel);
`;
