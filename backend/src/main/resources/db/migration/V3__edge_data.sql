-- 矢印の描画属性（曲げオフセットなど）を保持する
ALTER TABLE edges ADD COLUMN data JSONB NOT NULL DEFAULT '{}'::jsonb;
