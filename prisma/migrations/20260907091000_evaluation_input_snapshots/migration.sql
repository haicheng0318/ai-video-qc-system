CREATE TABLE evaluation_input_snapshots (
  id UUID PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version VARCHAR(30) NOT NULL DEFAULT 'benchmark-v1',
  benchmark_ids UUID[] NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX evaluation_input_snapshots_video_id_idx ON evaluation_input_snapshots(video_id);
CREATE FUNCTION reject_evaluation_input_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evaluation input snapshots are immutable';
END;
$$;
CREATE TRIGGER evaluation_input_snapshots_immutable BEFORE UPDATE ON evaluation_input_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_evaluation_input_snapshot_update();
