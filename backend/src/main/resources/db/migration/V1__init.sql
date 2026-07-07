CREATE TABLE nodes (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  parent_id UUID REFERENCES nodes(id),
  type VARCHAR(32) NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  order_key TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_nodes_parent ON nodes(parent_id);
CREATE INDEX idx_nodes_ws_type ON nodes(workspace_id, type);

CREATE TABLE ai_jobs (
  id UUID PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  context TEXT,
  result TEXT,
  error TEXT,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_jobs_status ON ai_jobs(status, created_at);
