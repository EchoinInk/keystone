import { TASK_STATUSES } from "./record-fields";

// Historical workspaces can contain the original task status labels.
export function taskStatus(value: unknown): string {
  if (value === "Done") return "Completed";
  if (!value || value === "Todo") return "To do";
  return String(value);
}

export function reopenStatus(value: unknown) {
  const status = taskStatus(value);
  return status !== "Completed" && TASK_STATUSES.includes(status) ? status : "To do";
}

export function activeSprint<T extends Record<string, unknown>>(sprints: T[] = []) {
  const active = sprints.filter(sprint => sprint.status === "Active");
  return active.length === 1 ? active[0] : undefined;
}

export function sprintDays(start: string, end: string) {
  return 1 + (Date.parse(end) - Date.parse(start)) / 86400000;
}

export function sprintEnd(start: string, days: number) {
  return new Date(Date.parse(start) + (days - 1) * 86400000).toISOString().slice(0, 10);
}

type Row = Record<string, unknown>;

// Some earlier records link from the objective only. Respect an unambiguous
// reverse link until the founder explicitly assigns or removes it on the task.
function inheritedParent(objectives: Row[], parent: "id" | "sprintId") {
  const parents = new Map<unknown, unknown>();
  for (const objective of objectives) {
    if (!objective.taskId) continue;
    const id = objective.taskId, value = objective[parent];
    parents.set(id, parents.has(id) && parents.get(id) !== value ? null : value);
  }
  return parents;
}

export function projectWorkflows(data: Record<string, Row[]>) {
  const launch = inheritedParent(data.launchObjectives, "id");
  const sprints = inheritedParent(data.sprintObjectives, "sprintId");
  const tasks = data.tasks.map(task => ({
    ...task, id: task.id, projectId: task.projectId, status: taskStatus(task.status),
    previousStatus: reopenStatus(task.previousStatus),
    sprintId: task.sprintId || sprints.get(task.id) || null,
    objectiveId: task.objectiveId || launch.get(task.id) || null,
  }));
  const byId = new Map(tasks.map(task => [task.id, task]));
  data.tasks = tasks;
  data.sprintObjectives = data.sprintObjectives.map(objective => ({
    ...objective, status: byId.get(objective.taskId)?.status ?? taskStatus(objective.status),
  }));
  const countable = tasks.filter(task => task.status !== "Cancelled");
  const complete = (rows: Row[]) => rows.filter(row => row.status === "Completed").length;
  const percent = (done: number, total: number) => total ? Math.round(100 * done / total) : 0;
  data.launchObjectives = data.launchObjectives.map(objective => {
    const work = countable.filter(task => task.objectiveId === objective.id);
    const done = complete(work);
    const status = work.length && done === work.length ? "Completed" : work.some(t => t.status === "Blocked") ? "Blocked"
      : work.some(t => ["In progress", "In review", "Completed"].includes(t.status)) ? "In progress" : "Not started";
    return { ...objective, status, taskCount: work.length, completedTaskCount: done,
      remainingTaskCount: work.length - done, progressPercentage: percent(done, work.length) };
  });
  data.sprints = data.sprints.map(sprint => {
    const work = [...countable.filter(task => task.sprintId === sprint.id),
      ...data.sprintObjectives.filter(o => o.sprintId === sprint.id && !o.taskId && o.status !== "Cancelled")];
    const done = complete(work);
    return { ...sprint, objectiveCount: work.length, completedObjectives: done, completionPercentage: percent(done, work.length) };
  });
  data.projects = data.projects.map(project => {
    const related = tasks.filter(task => task.projectId === project.id);
    const work = related.filter(task => task.status !== "Cancelled");
    return related.length ? { ...project, progress: percent(complete(work), work.length) } : project;
  });
  return data;
}
