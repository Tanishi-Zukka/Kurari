CREATE TABLE edges (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  board_id UUID NOT NULL,
  source_node_id UUID NOT NULL,
  target_node_id UUID NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_edges_ws ON edges(workspace_id);
CREATE INDEX idx_edges_board ON edges(board_id);
CREATE INDEX idx_edges_source ON edges(source_node_id);
CREATE INDEX idx_edges_target ON edges(target_node_id);
