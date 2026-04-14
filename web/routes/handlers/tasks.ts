import type { IncomingMessage, ServerResponse } from "http";
import { json, taskScheduler, ReqContext } from "../shared.ts";

export async function handleTasks(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: ReqContext,
): Promise<boolean> {
  // ================================================================
  // Task Scheduler API
  // ================================================================
  if (path === "/api/tasks" && method === "GET") {
    json(res, 200, { success: true, data: taskScheduler.getAllTasks() }, ctx);
    return true;
  }
  const taskTriggerMatch = path.match(/^\/api\/tasks\/([^/]+)\/trigger$/);
  if (taskTriggerMatch && method === "POST") {
    const taskId = taskTriggerMatch[1];
    try {
      const result = await taskScheduler.triggerTask(taskId);
      json(res, 200, { success: true, data: result }, ctx);
    } catch (e) {
      json(res, 500, { success: false, error: { message: String(e) } }, ctx);
    }
    return true;
  }
  const taskToggleMatch = path.match(/^\/api\/tasks\/([^/]+)\/toggle$/);
  if (taskToggleMatch && method === "POST") {
    const taskId = taskToggleMatch[1];
    const task = taskScheduler.getAllTasks().find((t) => t.id === taskId);
    if (!task) {
      json(res, 404, { success: false, error: { message: "Task not found" } }, ctx);
      return true;
    }
    const wasEnabled = task.options.enabled !== false;
    if (wasEnabled) {
      taskScheduler.disableTask(taskId);
    } else {
      taskScheduler.enableTask(taskId);
    }
    json(res, 200, { success: true, data: { enabled: !wasEnabled } }, ctx);
    return true;
  }
  const taskDeleteMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskDeleteMatch && method === "DELETE") {
    const taskId = taskDeleteMatch[1];
    taskScheduler.deleteTask(taskId);
    json(res, 200, { success: true }, ctx);
    return true;
  }

  return false;
}
