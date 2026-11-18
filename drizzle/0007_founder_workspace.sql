CREATE TABLE `workspace_files` (
	`object_key` text PRIMARY KEY NOT NULL,
	`etag` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_owner` (
	`slot` integer PRIMARY KEY NOT NULL,
	`site_origin` text NOT NULL,
	`subject` text NOT NULL,
	CONSTRAINT "single_workspace_owner" CHECK("workspace_owner"."slot" = 1)
);
--> statement-breakpoint
CREATE TRIGGER documents_require_file_on_insert
BEFORE INSERT ON documents
WHEN NOT EXISTS (SELECT 1 FROM workspace_files WHERE object_key = NEW.object_key)
BEGIN
  SELECT RAISE(ABORT, 'Unregistered attachment');
END;
--> statement-breakpoint
CREATE TRIGGER documents_require_file_on_replace
BEFORE UPDATE OF object_key ON documents
WHEN OLD.object_key <> NEW.object_key AND NOT EXISTS (SELECT 1 FROM workspace_files WHERE object_key = NEW.object_key)
BEGIN
  SELECT RAISE(ABORT, 'Unregistered attachment');
END;
--> statement-breakpoint
CREATE TRIGGER documents_revoke_file_on_delete
AFTER DELETE ON documents
WHEN NOT EXISTS (SELECT 1 FROM documents WHERE object_key = OLD.object_key)
BEGIN
  DELETE FROM workspace_files WHERE object_key = OLD.object_key;
END;
--> statement-breakpoint
CREATE TRIGGER documents_revoke_file_on_replace
AFTER UPDATE OF object_key ON documents
WHEN OLD.object_key <> NEW.object_key AND NOT EXISTS (SELECT 1 FROM documents WHERE object_key = OLD.object_key)
BEGIN
  DELETE FROM workspace_files WHERE object_key = OLD.object_key;
END;
