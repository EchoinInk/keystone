UPDATE tasks
SET status = CASE status WHEN 'Todo' THEN 'To do' WHEN 'Done' THEN 'Completed' ELSE status END,
    previous_status = CASE WHEN previous_status IN ('', 'Todo', 'Done') THEN 'To do' ELSE previous_status END,
    completed_at = CASE WHEN status IN ('Done', 'Completed') THEN COALESCE(completed_at, updated_at) ELSE completed_at END
WHERE status IN ('Todo', 'Done') OR previous_status IN ('', 'Todo', 'Done')
   OR (status = 'Completed' AND completed_at IS NULL);
--> statement-breakpoint
UPDATE sprint_objectives
SET status = CASE status WHEN 'Todo' THEN 'To do' WHEN 'Done' THEN 'Completed' END
WHERE status IN ('Todo', 'Done');
