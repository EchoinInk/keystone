CREATE TABLE `file_transfers` (
	`object_key` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`retry_at` integer NOT NULL,
	`sha256` text,
	`etag` text
);
--> statement-breakpoint
CREATE INDEX `file_transfers_due` ON `file_transfers` (`state`,`retry_at`,`object_key`);
--> statement-breakpoint
CREATE INDEX `documents_object_key` ON `documents` (`object_key`);
--> statement-breakpoint
CREATE TRIGGER queue_revoked_workspace_file
AFTER DELETE ON workspace_files
WHEN OLD.object_key GLOB 'workspaces/*/*'
 AND NOT EXISTS (SELECT 1 FROM documents WHERE object_key=OLD.object_key)
BEGIN
  INSERT INTO file_transfers(object_key,state,retry_at,etag)
  VALUES(OLD.object_key,'retired',0,OLD.etag)
  ON CONFLICT(object_key) DO UPDATE SET state='retired',retry_at=0,etag=excluded.etag;
END;
