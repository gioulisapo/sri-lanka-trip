CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  section TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX comments_section_id ON comments (section, id);
