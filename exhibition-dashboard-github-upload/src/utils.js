export const today = () => {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
};

export const uid = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const isoNow = () => new Date().toISOString();

export const clampProgress = (value) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
};

export const daysUntil = (dateText) => {
  if (!dateText) return null;
  const target = new Date(`${dateText}T00:00:00`);
  const difference = target.getTime() - today().getTime();
  return Math.ceil(difference / 86400000);
};

export const isOverdue = (dateText, status) => {
  if (!dateText || ["Completed", "Cancelled"].includes(status)) return false;
  return new Date(`${dateText}T00:00:00`) < today();
};

export const formatDate = (dateText) => {
  if (!dateText) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateText));
};

export const average = (items, accessor) => {
  if (!items.length) return 0;
  const total = items.reduce((sum, item) => sum + Number(accessor(item) || 0), 0);
  return Math.round(total / items.length);
};

export const getUserName = (users, id) =>
  users.find((user) => user.id === id)?.name || "Unassigned";

export const getCategory = (categories, id) =>
  categories.find((category) => category.id === id) || {
    id: "",
    name: "Uncategorized",
    color: "#64748b",
  };

export const canManageProjects = (role) =>
  ["Admin", "Project Manager"].includes(role);

export const canManageTasks = (role) =>
  ["Admin", "Project Manager"].includes(role);

export const canUpdateAssignedTask = (role) =>
  ["Admin", "Project Manager", "Team Member"].includes(role);

export const canManageUsers = (role) => role === "Admin";

export const normalizeSubTask = (task) => {
  const progress = task.status === "Completed" ? 100 : clampProgress(task.progress);
  return {
    ...task,
    progress,
    status: progress === 100 ? "Completed" : task.status,
  };
};

export const calculateMainTask = (mainTask, subTasks) => {
  const children = subTasks.filter((task) => task.main_task_id === mainTask.id);
  if (!children.length) return mainTask;
  const progress = average(children, (task) => task.progress);
  const allCompleted = children.every((task) => task.status === "Completed");
  const anyInProgress = children.some((task) => task.status === "In Progress");
  const status = allCompleted
    ? "Completed"
    : anyInProgress
      ? "In Progress"
      : mainTask.status;
  return { ...mainTask, progress, status };
};

export const calculateProjectProgress = (projectId, subTasks) =>
  average(
    subTasks.filter((task) => task.project_id === projectId),
    (task) => task.progress,
  );

export const makeCsv = (rows) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
};

export const downloadCsv = (filename, rows) => {
  const csv = makeCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
