-- Allow one homepage or repository link to belong to several categories.
CREATE TABLE IF NOT EXISTS link_category_assignments (
  link_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_link_category_assignments_category
  ON link_category_assignments(category_id);
