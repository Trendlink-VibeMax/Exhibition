import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Edit3,
  Filter,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import {
  blockerCategories,
  blockerSeverityOptions,
  initialState,
  priorityOptions,
  roles,
  statusOptions,
} from "./data";
import {
  hasSupabaseConfig,
  supabase,
  supabaseConfigError,
} from "./supabaseClient";
import {
  calculateMainTask,
  calculateProjectProgress,
  canManageProjects,
  canManageTasks,
  canManageUsers,
  canUpdateAssignedTask,
  daysUntil,
  downloadCsv,
  formatDate,
  getCategory,
  getUserName,
  isOverdue,
  isoNow,
  normalizeSubTask,
  uid,
} from "./utils";

const storageKey = "exhibition-project-tracker-v1";
const sharedStateId = "exhibition-dashboard-default";

const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const views = [
  { id: "summary", label: "Summary", icon: LayoutDashboard },
  { id: "project", label: "Project Detail", icon: FolderKanban },
  { id: "main", label: "Main Tasks", icon: ListChecks },
  { id: "sub", label: "Sub Tasks", icon: Check },
  { id: "categories", label: "Categories", icon: Filter },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "overdue", label: "Overdue", icon: Clock3 },
  { id: "urgent", label: "Urgent", icon: AlertTriangle },
  { id: "blockers", label: "Blockers", icon: ShieldAlert },
  { id: "users", label: "Team & Roles", icon: UserCog },
];

const statusStyles = {
  "Not Started": "bg-slate-100 text-slate-700 ring-slate-200",
  "In Progress": "bg-blue-100 text-blue-700 ring-blue-200",
  Pending: "bg-amber-100 text-amber-800 ring-amber-200",
  "On Hold": "bg-zinc-100 text-zinc-700 ring-zinc-200",
  Completed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  Cancelled: "bg-neutral-800 text-white ring-neutral-700",
};

const priorityStyles = {
  Low: "bg-slate-100 text-slate-700",
  Medium: "bg-sky-100 text-sky-700",
  High: "bg-orange-100 text-orange-700",
  Urgent: "bg-red-100 text-red-700",
};

const emptyTask = {
  title: "",
  category_id: "",
  owner_id: "",
  status: "Not Started",
  due_date: "",
  progress: 0,
  notes: "",
};

const emptySubTask = {
  title: "",
  main_task_id: "",
  project_id: "",
  category_id: "",
  owner_id: "",
  status: "Not Started",
  priority: "Medium",
  due_date: "",
  progress: 0,
  latest_update: "",
  attachment_url: "",
  blocker_status: "No",
  blocker_detail: "",
  blocker_category: "",
  blocker_owner_id: "",
  blocker_expected_resolution_date: "",
  blocker_severity: "",
};

const readInitialState = () => {
  try {
    const saved = localStorage.getItem(storageKey);
    const parsed = saved ? JSON.parse(saved) : initialState;
    return isDashboardState(parsed) ? parsed : initialState;
  } catch {
    return initialState;
  }
};

const isDashboardState = (value) =>
  Boolean(
    value &&
      Array.isArray(value.users) &&
      Array.isArray(value.categories) &&
      Array.isArray(value.projects) &&
      Array.isArray(value.mainTasks) &&
      Array.isArray(value.subTasks) &&
      Array.isArray(value.updates),
  );

const persistDashboardState = async (next, setSyncStatus) => {
  localStorage.setItem(storageKey, JSON.stringify(next));

  if (!hasSupabaseConfig || !supabase) return;

  const { error } = await supabase.from("dashboard_state").upsert({
    id: sharedStateId,
    data: next,
    updated_at: isoNow(),
  });

  setSyncStatus(error ? "Team sync setup needed" : "Team sync live");
};

function App() {
  const [state, setState] = useState(readInitialState);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(
    state.projects[0]?.id || "",
  );
  const [activeView, setActiveView] = useState("summary");
  const [dateKey, setDateKey] = useState(getLocalDateKey);
  const [filters, setFilters] = useState({
    search: "",
    category: "",
    owner: "",
    status: "",
    priority: "",
    due: "",
    overdueOnly: false,
    urgentOnly: false,
    blockerOnly: false,
    sort: "due_date",
  });
  const [modal, setModal] = useState(null);
  const [syncStatus, setSyncStatus] = useState(
    supabaseConfigError
      ? supabaseConfigError
      : hasSupabaseConfig
        ? "Connecting team sync"
        : "Local demo mode",
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDateKey(getLocalDateKey());
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (supabaseConfigError) {
      setSyncStatus(supabaseConfigError);
      return undefined;
    }

    if (!hasSupabaseConfig || !supabase) return undefined;

    let cancelled = false;

    const loadSharedState = async () => {
      setSyncStatus("Loading shared team data");
      const { data, error } = await supabase
        .from("dashboard_state")
        .select("data, updated_at")
        .eq("id", sharedStateId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setSyncStatus("Team sync setup needed");
        return;
      }

      if (data?.data && isDashboardState(data.data)) {
        setState(data.data);
        localStorage.setItem(storageKey, JSON.stringify(data.data));
        setSyncStatus("Team sync live");
        return;
      }

      const { error: seedError } = await supabase.from("dashboard_state").upsert({
        id: sharedStateId,
        data: initialState,
        updated_at: isoNow(),
      });

      if (cancelled) return;

      setSyncStatus(seedError ? "Team sync setup needed" : "Team sync live");
    };

    loadSharedState();

    const channel = supabase
      .channel("dashboard-state-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dashboard_state",
          filter: `id=eq.${sharedStateId}`,
        },
        (payload) => {
          const next = payload.new?.data;
          if (!isDashboardState(next)) return;
          setState(next);
          localStorage.setItem(storageKey, JSON.stringify(next));
          setSyncStatus("Team sync live");
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setSyncStatus("Team sync live");
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const persist = (updater) => {
    setState((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      window.queueMicrotask(() => persistDashboardState(next, setSyncStatus));
      return next;
    });
  };

  const hydratedMainTasks = useMemo(
    () =>
      state.mainTasks.map((task) =>
        calculateMainTask(
          task,
          state.subTasks.map(normalizeSubTask),
        ),
      ),
    [state.mainTasks, state.subTasks],
  );

  const hydratedSubTasks = useMemo(
    () => state.subTasks.map(normalizeSubTask),
    [state.subTasks],
  );

  const selectedProject =
    state.projects.find((project) => project.id === selectedProjectId) ||
    state.projects[0];

  const role = currentUser?.role || "Viewer";
  const canEditProjects = canManageProjects(role);
  const canEditTasks = canManageTasks(role);
  const canUpdateTasks = canUpdateAssignedTask(role);
  const canEditUsers = canManageUsers(role);

  const metrics = useMemo(
    () =>
      state.projects.map((project) =>
        buildProjectMetrics(project, hydratedMainTasks, hydratedSubTasks),
      ),
    [state.projects, hydratedMainTasks, hydratedSubTasks, dateKey],
  );

  const blockers = useMemo(
    () =>
      hydratedSubTasks
        .filter((task) => task.blocker_status === "Yes")
        .sort((a, b) => {
          const critical = Number(b.blocker_severity === "Critical") -
            Number(a.blocker_severity === "Critical");
          if (critical) return critical;
          return (
            new Date(a.blocker_expected_resolution_date || "2999-01-01") -
            new Date(b.blocker_expected_resolution_date || "2999-01-01")
          );
        }),
    [hydratedSubTasks],
  );

  if (!currentUser) {
    return (
      <LoginScreen
        users={state.users}
        onLogin={(userId) => setCurrentUser(state.users.find((user) => user.id === userId))}
      />
    );
  }

  const addProject = (form) => {
    const project = {
      ...form,
      id: uid("project"),
      owner_id: form.owner_id || currentUser.id,
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    persist((previous) => ({
      ...previous,
      projects: [...previous.projects, project],
    }));
    setSelectedProjectId(project.id);
  };

  const saveProject = (form) => {
    persist((previous) => ({
      ...previous,
      projects: previous.projects.map((project) =>
        project.id === form.id ? { ...project, ...form, updated_at: isoNow() } : project,
      ),
    }));
  };

  const deleteProject = (projectId) => {
    persist((previous) => ({
      ...previous,
      projects: previous.projects.filter((project) => project.id !== projectId),
      mainTasks: previous.mainTasks.filter((task) => task.project_id !== projectId),
      subTasks: previous.subTasks.filter((task) => task.project_id !== projectId),
    }));
    setSelectedProjectId(state.projects.find((project) => project.id !== projectId)?.id || "");
  };

  const saveMainTask = (form) => {
    const payload = {
      ...form,
      project_id: form.project_id || selectedProject.id,
      progress: Number(form.progress || 0),
      updated_at: isoNow(),
    };
    persist((previous) => ({
      ...previous,
      mainTasks: payload.id
        ? previous.mainTasks.map((task) => (task.id === payload.id ? payload : task))
        : [
            ...previous.mainTasks,
            { ...payload, id: uid("main"), created_at: isoNow() },
          ],
    }));
  };

  const deleteMainTask = (taskId) => {
    persist((previous) => ({
      ...previous,
      mainTasks: previous.mainTasks.filter((task) => task.id !== taskId),
      subTasks: previous.subTasks.filter((task) => task.main_task_id !== taskId),
    }));
  };

  const saveSubTask = (form) => {
    const mainTask = state.mainTasks.find((task) => task.id === form.main_task_id);
    const payload = normalizeSubTask({
      ...form,
      project_id: form.project_id || mainTask?.project_id || selectedProject.id,
      progress: Number(form.progress || 0),
      updated_at: isoNow(),
    });
    persist((previous) => ({
      ...previous,
      subTasks: payload.id
        ? previous.subTasks.map((task) => (task.id === payload.id ? payload : task))
        : [
            ...previous.subTasks,
            { ...payload, id: uid("sub"), created_at: isoNow() },
          ],
    }));
  };

  const deleteSubTask = (taskId) => {
    persist((previous) => ({
      ...previous,
      subTasks: previous.subTasks.filter((task) => task.id !== taskId),
      updates: previous.updates.filter((update) => update.sub_task_id !== taskId),
    }));
  };

  const addUpdate = (subTaskId, form) => {
    persist((previous) => ({
      ...previous,
      updates: [
        {
          id: uid("update"),
          sub_task_id: subTaskId,
          update_detail: form.update_detail,
          next_action: form.next_action,
          blocker: form.blocker,
          updated_by: currentUser.id,
          created_at: isoNow(),
        },
        ...previous.updates,
      ],
      subTasks: previous.subTasks.map((task) =>
        task.id === subTaskId
          ? { ...task, latest_update: form.update_detail, updated_at: isoNow() }
          : task,
      ),
    }));
  };

  const saveCategory = (form) => {
    persist((previous) => ({
      ...previous,
      categories: form.id
        ? previous.categories.map((category) =>
            category.id === form.id ? { ...category, ...form } : category,
          )
        : [
            ...previous.categories,
            { ...form, id: uid("cat"), created_at: isoNow() },
          ],
    }));
  };

  const deleteCategory = (categoryId) => {
    persist((previous) => ({
      ...previous,
      categories: previous.categories.filter((category) => category.id !== categoryId),
    }));
  };

  const saveUser = (form) => {
    persist((previous) => ({
      ...previous,
      users: form.id
        ? previous.users.map((user) => (user.id === form.id ? { ...user, ...form } : user))
        : [...previous.users, { ...form, id: uid("user"), created_at: isoNow() }],
    }));
  };

  const filteredSubTasks = filterAndSortSubTasks(
    hydratedSubTasks,
    selectedProject?.id,
    filters,
  );

  const currentProjectMainTasks = hydratedMainTasks.filter(
    (task) => task.project_id === selectedProject?.id,
  );

  const allTaskRows = hydratedSubTasks.map((task) =>
    csvTaskRow(task, state, hydratedMainTasks),
  );
  const blockerRows = blockers.map((task) => csvTaskRow(task, state, hydratedMainTasks));

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f6f8fb_0%,#eef6f2_46%,#fff7ed_100%)] text-slate-900">
      <Header
        currentUser={currentUser}
        users={state.users}
        onLogout={() => setCurrentUser(null)}
        onSwitchUser={setCurrentUser}
        syncStatus={syncStatus}
      />
      <main className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 lg:h-[calc(100vh-82px)] lg:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden">
        <Sidebar
          views={views}
          activeView={activeView}
          setActiveView={setActiveView}
          projects={state.projects}
          selectedProjectId={selectedProject?.id}
          setSelectedProjectId={setSelectedProjectId}
          metrics={metrics}
          canEditProjects={canEditProjects}
          canEditUsers={canEditUsers}
          onAddProject={() =>
            setModal({
              type: "project",
              item: {
                name: "",
                description: "",
                start_date: "",
                owner_id: currentUser.id,
              },
            })
          }
        />
        <section className="min-h-0 space-y-5 lg:overflow-y-auto lg:pr-1">
          {activeView === "summary" && (
            <SummaryDashboard
              metrics={metrics}
              projects={state.projects}
              users={state.users}
              mainTasks={hydratedMainTasks}
              subTasks={hydratedSubTasks}
              blockers={blockers}
              onSelectProject={(id) => {
                setSelectedProjectId(id);
                setActiveView("project");
              }}
              onExportPdf={() => window.print()}
              onExportTasks={() => downloadCsv("exhibition-task-list.csv", allTaskRows)}
              onExportBlockers={() =>
                downloadCsv("exhibition-blocker-list.csv", blockerRows)
              }
            />
          )}

          {activeView === "project" && selectedProject && (
            <ProjectDetail
              project={selectedProject}
              users={state.users}
              metrics={metrics.find((item) => item.id === selectedProject.id)}
              mainTasks={currentProjectMainTasks}
              subTasks={hydratedSubTasks.filter((task) => task.project_id === selectedProject.id)}
              categories={state.categories}
              canEdit={canEditProjects}
              onEdit={() => setModal({ type: "project", item: selectedProject })}
              onDelete={() => deleteProject(selectedProject.id)}
            />
          )}

          {activeView === "main" && selectedProject && (
            <MainTaskList
              project={selectedProject}
              tasks={currentProjectMainTasks}
              subTasks={hydratedSubTasks}
              categories={state.categories}
              users={state.users}
              canEdit={canEditTasks}
              onAdd={() =>
                setModal({
                  type: "main",
                  item: {
                    ...emptyTask,
                    project_id: selectedProject.id,
                    category_id: state.categories[0]?.id || "",
                    owner_id: currentUser.id,
                  },
                })
              }
              onEdit={(item) => setModal({ type: "main", item })}
              onDelete={deleteMainTask}
            />
          )}

          {activeView === "sub" && selectedProject && (
            <SubTaskList
              title="Sub Task List"
              tasks={filteredSubTasks}
              filters={filters}
              setFilters={setFilters}
              categories={state.categories}
              users={state.users}
              mainTasks={hydratedMainTasks}
              canEdit={canEditTasks}
              canUpdate={canUpdateTasks}
              onAdd={() =>
                setModal({
                  type: "sub",
                  item: {
                    ...emptySubTask,
                    project_id: selectedProject.id,
                    main_task_id: currentProjectMainTasks[0]?.id || "",
                    category_id: state.categories[0]?.id || "",
                    owner_id: currentUser.id,
                  },
                })
              }
              onEdit={(item) => setModal({ type: "sub", item })}
              onDelete={deleteSubTask}
              onHistory={(item) => setModal({ type: "history", item })}
            />
          )}

          {activeView === "categories" && (
            <CategoryView
              categories={state.categories}
              subTasks={hydratedSubTasks}
              users={state.users}
              canEdit={canEditTasks}
              onAdd={() => setModal({ type: "category", item: { name: "", color: "#2563eb" } })}
              onEdit={(item) => setModal({ type: "category", item })}
              onDelete={deleteCategory}
            />
          )}

          {activeView === "calendar" && (
            <TaskTimeline
              title="Calendar / Due Date View"
              tasks={hydratedSubTasks.filter((task) => task.project_id === selectedProject?.id)}
              categories={state.categories}
              users={state.users}
              mainTasks={hydratedMainTasks}
            />
          )}

          {activeView === "overdue" && (
            <TaskTimeline
              title="Overdue Task View"
              tasks={hydratedSubTasks.filter((task) => isOverdue(task.due_date, task.status))}
              categories={state.categories}
              users={state.users}
              mainTasks={hydratedMainTasks}
            />
          )}

          {activeView === "urgent" && (
            <TaskTimeline
              title="Urgent Task View"
              tasks={hydratedSubTasks.filter((task) => task.priority === "Urgent")}
              categories={state.categories}
              users={state.users}
              mainTasks={hydratedMainTasks}
            />
          )}

          {activeView === "blockers" && (
            <BlockerDashboard
              blockers={blockers}
              projects={state.projects}
              categories={state.categories}
              users={state.users}
              mainTasks={hydratedMainTasks}
              onExport={() => downloadCsv("exhibition-blocker-list.csv", blockerRows)}
              onOpen={(item) => setModal({ type: "sub", item })}
            />
          )}

          {activeView === "users" && (
            <UserManagement
              users={state.users}
              canEdit={canEditUsers}
              onAdd={() =>
                setModal({
                  type: "user",
                  item: { name: "", email: "", role: "Team Member" },
                })
              }
              onEdit={(item) => setModal({ type: "user", item })}
            />
          )}
        </section>
      </main>

      {modal?.type === "project" && (
        <ProjectModal
          item={modal.item}
          users={state.users}
          onClose={() => setModal(null)}
          onSave={(form) => {
            form.id ? saveProject(form) : addProject(form);
            setModal(null);
          }}
        />
      )}
      {modal?.type === "main" && (
        <MainTaskModal
          item={modal.item}
          categories={state.categories}
          users={state.users}
          projects={state.projects}
          onClose={() => setModal(null)}
          onSave={(form) => {
            saveMainTask(form);
            setModal(null);
          }}
        />
      )}
      {modal?.type === "sub" && (
        <SubTaskModal
          item={modal.item}
          categories={state.categories}
          users={state.users}
          mainTasks={hydratedMainTasks}
          onClose={() => setModal(null)}
          onSave={(form) => {
            saveSubTask(form);
            setModal(null);
          }}
        />
      )}
      {modal?.type === "history" && (
        <HistoryModal
          item={modal.item}
          updates={state.updates.filter((update) => update.sub_task_id === modal.item.id)}
          users={state.users}
          canUpdate={canUpdateTasks}
          onClose={() => setModal(null)}
          onSave={(form) => addUpdate(modal.item.id, form)}
        />
      )}
      {modal?.type === "category" && (
        <CategoryModal
          item={modal.item}
          onClose={() => setModal(null)}
          onSave={(form) => {
            saveCategory(form);
            setModal(null);
          }}
        />
      )}
      {modal?.type === "user" && (
        <UserModal
          item={modal.item}
          onClose={() => setModal(null)}
          onSave={(form) => {
            saveUser(form);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function LoginScreen({ users, onLogin }) {
  const [userId, setUserId] = useState(users[0]?.id || "");

  return (
    <main className="grid min-h-screen place-items-center bg-[linear-gradient(135deg,#f8fafc,#eef6f2_48%,#fff7ed)] px-4">
      <div className="w-full max-w-md rounded-[8px] border border-white/80 bg-white/90 p-7 shadow-soft backdrop-blur">
        <div className="mb-7 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-[8px] bg-slate-900 text-white">
            <Lock size={22} />
          </div>
          <div>
            <p className="text-sm font-semibold text-teal-700">Exhibition project tracker</p>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950">Team login</h1>
          </div>
        </div>
        <label className="label">Demo team member / role</label>
        <select className="field" value={userId} onChange={(event) => setUserId(event.target.value)}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} - {user.role}
            </option>
          ))}
        </select>
        <button className="primary-button mt-5 w-full" onClick={() => onLogin(userId)}>
          <ShieldAlert size={18} />
          Enter dashboard
        </button>
      </div>
    </main>
  );
}

function Header({ currentUser, users, onLogout, onSwitchUser, syncStatus }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-700">Collaborative exhibition workspace</p>
          <h1 className="text-xl font-semibold tracking-normal text-slate-950 sm:text-2xl">
            Exhibition Project Tracking Dashboard
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[8px] bg-white px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            {syncStatus}
          </span>
          <select
            className="field compact"
            value={currentUser.id}
            onChange={(event) =>
              onSwitchUser(users.find((user) => user.id === event.target.value))
            }
            aria-label="Switch current team member"
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} - {user.role}
              </option>
            ))}
          </select>
          <button className="icon-button" onClick={onLogout} title="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

function Sidebar({
  views,
  activeView,
  setActiveView,
  projects,
  selectedProjectId,
  setSelectedProjectId,
  metrics,
  canEditProjects,
  canEditUsers,
  onAddProject,
}) {
  return (
    <aside className="space-y-4 lg:min-h-0 lg:overflow-y-auto">
      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Projects</h2>
          {canEditProjects && (
            <button className="icon-button" onClick={onAddProject} title="Add project">
              <Plus size={17} />
            </button>
          )}
        </div>
        <div className="space-y-2">
          {projects.map((project) => {
            const metric = metrics.find((item) => item.id === project.id);
            return (
              <button
                key={project.id}
                className={`project-tab ${selectedProjectId === project.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedProjectId(project.id);
                  setActiveView("project");
                }}
              >
                <span className="font-semibold">{project.name}</span>
                <span className="sidebar-countdown">
                  <Clock3 size={15} />
                  {metric?.countdownText}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {metric?.progress || 0}% complete
                </span>
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel>
        <h2 className="section-title mb-3">Views</h2>
        <nav className="grid gap-1">
          {views
            .filter((view) => view.id !== "users" || canEditUsers)
            .map((view) => {
              const Icon = view.icon;
              return (
                <button
                  key={view.id}
                  className={`nav-button ${activeView === view.id ? "active" : ""}`}
                  onClick={() => setActiveView(view.id)}
                >
                  <Icon size={17} />
                  {view.label}
                </button>
              );
            })}
        </nav>
      </Panel>
    </aside>
  );
}

function SummaryDashboard({
  metrics,
  projects,
  users,
  mainTasks,
  subTasks,
  blockers,
  onSelectProject,
  onExportPdf,
  onExportTasks,
  onExportBlockers,
}) {
  const alerts = buildAlerts(projects, users, subTasks);

  return (
    <>
      <div className="toolbar print:hidden">
        <div>
          <h2 className="page-title">Main Summary Dashboard</h2>
          <p className="page-subtitle">Both exhibition projects, countdowns, progress, alerts, and blockers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="secondary-button" onClick={onExportPdf}>
            <Download size={17} /> Export PDF
          </button>
          <button className="secondary-button" onClick={onExportTasks}>
            <Download size={17} /> Task CSV
          </button>
          <button className="secondary-button" onClick={onExportBlockers}>
            <Download size={17} /> Blocker CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {metrics.map((project) => (
          <ProjectSummaryCard
            key={project.id}
            project={project}
            owner={getUserName(users, project.owner_id)}
            onOpen={() => onSelectProject(project.id)}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="section-title">Priority Alerts</h3>
            <span className="badge bg-red-100 text-red-700 ring-red-200">{alerts.length} alerts</span>
          </div>
          <div className="space-y-3">
            {alerts.slice(0, 8).map((alert) => (
              <div key={alert.id} className="alert-row">
                <AlertTriangle size={18} className={alert.level === "critical" ? "text-red-600" : "text-amber-600"} />
                <div>
                  <p className="font-semibold text-slate-900">{alert.title}</p>
                  <p className="text-sm text-slate-500">{alert.detail}</p>
                </div>
              </div>
            ))}
            {!alerts.length && <EmptyState text="No active alerts." />}
          </div>
        </Panel>
        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="section-title">Blocker Snapshot</h3>
            <span className="badge bg-slate-100 text-slate-700 ring-slate-200">{blockers.length} total</span>
          </div>
          <MiniBars
            rows={projects.map((project) => ({
              label: project.name,
              value: blockers.filter((task) => task.project_id === project.id).length,
            }))}
          />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MetricTile label="Critical blockers" value={blockers.filter((task) => task.blocker_severity === "Critical").length} tone="red" />
            <MetricTile label="Overdue blockers" value={blockers.filter((task) => isOverdue(task.blocker_expected_resolution_date, "In Progress")).length} tone="amber" />
          </div>
        </Panel>
      </div>
    </>
  );
}

function ProjectSummaryCard({ project, owner, onOpen }) {
  return (
    <Panel className="relative overflow-hidden">
      <div className="absolute right-0 top-0 h-28 w-32 bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.18),transparent_65%)]" />
      <div className="relative grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <h3 className="text-xl font-semibold tracking-normal">{project.name}</h3>
          <p className="mt-1 text-sm text-slate-500">Owner: {owner}</p>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 md:justify-end">
          <CountdownBadge text={project.countdownText} />
          <button className="secondary-button h-fit" onClick={onOpen}>
            Open workspace
          </button>
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-sm font-medium">
          <span>{project.name}: {project.progress}% of 100%</span>
          <span className="text-amber-700">{formatDate(project.start_date)}</span>
        </div>
        <JourneyBar progress={project.progress} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <MetricTile label="Main tasks" value={project.totalMain} tone="slate" />
        <MetricTile label="Sub tasks" value={project.totalSub} tone="blue" />
        <MetricTile label="Completed" value={project.completed} tone="green" />
        <MetricTile label="In progress" value={project.inProgress} tone="blue" />
        <MetricTile label="Pending" value={project.pending} tone="amber" />
        <MetricTile label="On hold" value={project.onHold} tone="slate" />
        <MetricTile label="Overdue" value={project.overdue} tone="red" />
        <MetricTile label="Urgent" value={project.urgent} tone="red" />
        <MetricTile label="Total blockers" value={project.blockers} tone="amber" />
        <MetricTile label="Critical blockers" value={project.criticalBlockers} tone="red" />
      </div>
    </Panel>
  );
}

function ProjectDetail({ project, users, metrics, mainTasks, subTasks, categories, canEdit, onEdit, onDelete }) {
  return (
    <>
      <div className="toolbar">
        <div>
          <h2 className="page-title">{project.name}</h2>
          <p className="page-subtitle">{project.description}</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button className="secondary-button" onClick={onEdit}><Edit3 size={17} /> Edit</button>
            <button className="danger-button" onClick={onDelete}><Trash2 size={17} /> Delete</button>
          </div>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel>
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricTile label="Exhibition start" value={formatDate(project.start_date)} tone="slate" />
            <CountdownMetric text={metrics?.countdownText || "No date"} />
            <MetricTile label="Owner" value={getUserName(users, project.owner_id)} tone="blue" />
          </div>
          <div className="mt-6">
            <div className="mb-2 flex justify-between text-sm font-semibold">
              <span>Calculated project progress</span>
              <span>{metrics?.progress || 0}%</span>
            </div>
            <JourneyBar progress={metrics?.progress || 0} />
          </div>
        </Panel>
        <Panel>
          <h3 className="section-title mb-3">Status Mix</h3>
          <MiniBars
            rows={statusOptions.map((status) => ({
              label: status,
              value: subTasks.filter((task) => task.status === status).length,
            }))}
          />
        </Panel>
      </div>
      <Panel>
        <h3 className="section-title mb-4">Main Task Workstreams</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {mainTasks.map((task) => (
            <div key={task.id} className="task-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{task.title}</p>
                  <p className="text-sm text-slate-500">
                    {getCategory(categories, task.category_id).name} - {subTasks.filter((subTask) => subTask.main_task_id === task.id).length} sub tasks
                  </p>
                </div>
                <StatusBadge status={task.status} />
              </div>
              <div className="mt-4 flex items-center gap-3">
                <ProgressLine progress={task.progress} />
                <span className="w-10 text-right text-sm font-semibold">{task.progress}%</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

function MainTaskList({ project, tasks, subTasks, categories, users, canEdit, onAdd, onEdit, onDelete }) {
  return (
    <Panel>
      <TableHeader
        title="Main Task List"
        subtitle={project.name}
        action={canEdit ? <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add main task</button> : null}
      />
      <div className="responsive-table">
        <table>
          <thead>
            <tr>
              <th>Main Task</th>
              <th>Category</th>
              <th>Owner</th>
              <th>Sub Tasks</th>
              <th>Status</th>
              <th>Due</th>
              <th>Progress</th>
              <th>Notes</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td className="font-semibold">{task.title}</td>
                <td><CategoryPill category={getCategory(categories, task.category_id)} /></td>
                <td>{getUserName(users, task.owner_id)}</td>
                <td>
                  <span className="count-pill">
                    {subTasks.filter((subTask) => subTask.main_task_id === task.id).length}
                  </span>
                </td>
                <td><StatusBadge status={task.status} /></td>
                <td className={isOverdue(task.due_date, task.status) ? "text-red-600 font-semibold" : ""}>{formatDate(task.due_date)}</td>
                <td><ProgressCell progress={task.progress} /></td>
                <td className="max-w-xs text-slate-500">{task.notes}</td>
                {canEdit && (
                  <td>
                    <RowActions onEdit={() => onEdit(task)} onDelete={() => onDelete(task.id)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!tasks.length && <EmptyState text="No main tasks yet." />}
    </Panel>
  );
}

function SubTaskList({
  title,
  tasks,
  filters,
  setFilters,
  categories,
  users,
  mainTasks,
  canEdit,
  canUpdate,
  onAdd,
  onEdit,
  onDelete,
  onHistory,
}) {
  return (
    <Panel>
      <TableHeader
        title={title}
        subtitle="Filter, sort, update, and inspect sub task history."
        action={canEdit ? <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add sub task</button> : null}
      />
      <FilterBar filters={filters} setFilters={setFilters} categories={categories} users={users} />
      <div className="responsive-table mt-4">
        <table>
          <thead>
            <tr>
              <th>Sub Task</th>
              <th>Main Task</th>
              <th>Category</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Progress</th>
              <th>Latest update</th>
              <th>Blocker</th>
              <th>History</th>
              {(canEdit || canUpdate) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td className="min-w-56 font-semibold">{task.title}</td>
                <td>{mainTasks.find((main) => main.id === task.main_task_id)?.title || "No main task"}</td>
                <td><CategoryPill category={getCategory(categories, task.category_id)} /></td>
                <td className={!task.owner_id ? "font-semibold text-red-600" : ""}>{getUserName(users, task.owner_id)}</td>
                <td><StatusBadge status={task.status} /></td>
                <td><PriorityBadge priority={task.priority} /></td>
                <td className={isOverdue(task.due_date, task.status) ? "font-semibold text-red-600" : !task.due_date ? "font-semibold text-amber-700" : ""}>{formatDate(task.due_date)}</td>
                <td><ProgressCell progress={task.progress} /></td>
                <td className="min-w-72 text-slate-600">{task.latest_update || "No update yet"}</td>
                <td>{task.blocker_status === "Yes" ? <BlockerBadge task={task} /> : <span className="text-slate-400">No</span>}</td>
                <td><button className="secondary-button" onClick={() => onHistory(task)}>Open</button></td>
                {(canEdit || canUpdate) && (
                  <td>
                    <RowActions onEdit={() => onEdit(task)} onDelete={canEdit ? () => onDelete(task.id) : null} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!tasks.length && <EmptyState text="No sub tasks match the current filters." />}
    </Panel>
  );
}

function FilterBar({ filters, setFilters, categories, users }) {
  const update = (patch) => setFilters((previous) => ({ ...previous, ...patch }));
  return (
    <div className="filter-grid">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={17} />
        <input
          className="field pl-10"
          placeholder="Search tasks"
          value={filters.search}
          onChange={(event) => update({ search: event.target.value })}
        />
      </div>
      <select className="field" value={filters.category} onChange={(event) => update({ category: event.target.value })}>
        <option value="">All categories</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
      <select className="field" value={filters.owner} onChange={(event) => update({ owner: event.target.value })}>
        <option value="">All owners</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select>
      <select className="field" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
        <option value="">All statuses</option>
        {statusOptions.map((status) => <option key={status}>{status}</option>)}
      </select>
      <select className="field" value={filters.priority} onChange={(event) => update({ priority: event.target.value })}>
        <option value="">All priorities</option>
        {priorityOptions.map((priority) => <option key={priority}>{priority}</option>)}
      </select>
      <input className="field" type="date" value={filters.due} onChange={(event) => update({ due: event.target.value })} />
      <select className="field" value={filters.sort} onChange={(event) => update({ sort: event.target.value })}>
        <option value="due_date">Sort: Due date</option>
        <option value="priority">Sort: Priority</option>
        <option value="status">Sort: Status</option>
        <option value="updated_at">Sort: Last updated</option>
        <option value="progress">Sort: Progress</option>
      </select>
      <label className="toggle"><input type="checkbox" checked={filters.overdueOnly} onChange={(event) => update({ overdueOnly: event.target.checked })} /> Overdue</label>
      <label className="toggle"><input type="checkbox" checked={filters.urgentOnly} onChange={(event) => update({ urgentOnly: event.target.checked })} /> Urgent</label>
      <label className="toggle"><input type="checkbox" checked={filters.blockerOnly} onChange={(event) => update({ blockerOnly: event.target.checked })} /> Blockers</label>
    </div>
  );
}

function CategoryView({ categories, subTasks, users, canEdit, onAdd, onEdit, onDelete }) {
  return (
    <Panel>
      <TableHeader
        title="Category View"
        subtitle="Manage task categories and see active task volume."
        action={canEdit ? <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add category</button> : null}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => {
          const tasks = subTasks.filter((task) => task.category_id === category.id);
          return (
            <div key={category.id} className="task-card">
              <div className="flex items-start justify-between gap-3">
                <CategoryPill category={category} />
                {canEdit && <RowActions onEdit={() => onEdit(category)} onDelete={() => onDelete(category.id)} />}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <MetricTile label="Tasks" value={tasks.length} tone="slate" />
                <MetricTile label="Blockers" value={tasks.filter((task) => task.blocker_status === "Yes").length} tone="red" />
                <MetricTile label="Owners" value={new Set(tasks.map((task) => getUserName(users, task.owner_id))).size} tone="blue" />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function TaskTimeline({ title, tasks, categories, users, mainTasks }) {
  const sorted = [...tasks].sort((a, b) => new Date(a.due_date || "2999-01-01") - new Date(b.due_date || "2999-01-01"));
  return (
    <Panel>
      <TableHeader title={title} subtitle={`${sorted.length} tasks`} />
      <div className="space-y-3">
        {sorted.map((task) => (
          <div key={task.id} className="timeline-row">
            <div className="timeline-date">
              <CalendarDays size={17} />
              {formatDate(task.due_date)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{task.title}</p>
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {mainTasks.find((main) => main.id === task.main_task_id)?.title || "No main task"} -
                {" "}{getCategory(categories, task.category_id).name} - {getUserName(users, task.owner_id)}
              </p>
            </div>
            <ProgressCell progress={task.progress} />
          </div>
        ))}
        {!sorted.length && <EmptyState text="No tasks in this view." />}
      </div>
    </Panel>
  );
}

function BlockerDashboard({ blockers, projects, users, mainTasks, onExport, onOpen }) {
  const critical = blockers.filter((task) => task.blocker_severity === "Critical");
  const overdue = blockers.filter((task) => isOverdue(task.blocker_expected_resolution_date, "In Progress"));
  const byCategory = groupCount(blockers, "blocker_category");
  const byOwner = groupCount(blockers, "blocker_owner_id");

  return (
    <>
      <div className="toolbar">
        <div>
          <h2 className="page-title">Blocker / Issue Dashboard</h2>
          <p className="page-subtitle">Critical blockers are sorted to the top and overdue resolutions are flagged.</p>
        </div>
        <button className="secondary-button" onClick={onExport}><Download size={17} /> Export blocker CSV</button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <MetricTile label="Total blockers" value={blockers.length} tone="slate" />
        <MetricTile label="Critical blockers" value={critical.length} tone="red" />
        <MetricTile label="Overdue blockers" value={overdue.length} tone="amber" />
        <MetricTile label="Projects affected" value={new Set(blockers.map((task) => task.project_id)).size} tone="blue" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <h3 className="section-title mb-3">Blockers by Project</h3>
          <MiniBars rows={projects.map((project) => ({ label: project.name, value: blockers.filter((task) => task.project_id === project.id).length }))} />
        </Panel>
        <Panel>
          <h3 className="section-title mb-3">Blockers by Category</h3>
          <MiniBars rows={Object.entries(byCategory).map(([label, value]) => ({ label: label || "Uncategorized", value }))} />
        </Panel>
        <Panel>
          <h3 className="section-title mb-3">Blockers by Owner</h3>
          <MiniBars rows={Object.entries(byOwner).map(([id, value]) => ({ label: getUserName(users, id), value }))} />
        </Panel>
        <Panel>
          <h3 className="section-title mb-3">Issue List</h3>
          <div className="space-y-3">
            {blockers.map((task) => (
              <button key={task.id} className="blocker-row" onClick={() => onOpen(task)}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{task.title}</p>
                    <BlockerBadge task={task} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {mainTasks.find((main) => main.id === task.main_task_id)?.title || "No main task"} -
                    {" "}Owner: {getUserName(users, task.blocker_owner_id)}
                  </p>
                  <p className="mt-2 text-sm text-slate-700">{task.blocker_detail}</p>
                </div>
                <div className={isOverdue(task.blocker_expected_resolution_date, "In Progress") ? "text-right font-semibold text-red-600" : "text-right text-slate-500"}>
                  {formatDate(task.blocker_expected_resolution_date)}
                </div>
              </button>
            ))}
            {!blockers.length && <EmptyState text="No active blockers." />}
          </div>
        </Panel>
      </div>
    </>
  );
}

function UserManagement({ users, canEdit, onAdd, onEdit }) {
  return (
    <Panel>
      <TableHeader
        title="Team & Role Management"
        subtitle="Admin-only team member and access-role setup."
        action={canEdit ? <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add team member</button> : null}
      />
      <div className="responsive-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="font-semibold">{user.name}</td>
                <td>{user.email}</td>
                <td><span className="badge bg-indigo-100 text-indigo-700 ring-indigo-200">{user.role}</span></td>
                <td>{formatDate(user.created_at)}</td>
                {canEdit && <td><button className="secondary-button" onClick={() => onEdit(user)}><Edit3 size={16} /> Edit</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ProjectModal({ item, users, onClose, onSave }) {
  const [form, setForm] = useState(item);
  return (
    <Modal title={item.id ? "Edit project" : "Add project"} onClose={onClose}>
      <FormGrid>
        <TextField label="Project name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <DateField label="Exhibition start date" value={form.start_date} onChange={(start_date) => setForm({ ...form, start_date })} />
        <SelectField label="Project owner" value={form.owner_id} onChange={(owner_id) => setForm({ ...form, owner_id })} options={users.map((user) => [user.id, user.name])} />
        <TextAreaField label="Description" value={form.description} onChange={(description) => setForm({ ...form, description })} span />
      </FormGrid>
      <ModalActions onClose={onClose} onSave={() => onSave(form)} />
    </Modal>
  );
}

function MainTaskModal({ item, categories, users, projects, onClose, onSave }) {
  const [form, setForm] = useState(item);
  return (
    <Modal title={item.id ? "Edit main task" : "Add main task"} onClose={onClose}>
      <FormGrid>
        <TextField label="Main Task name" value={form.title} onChange={(title) => setForm({ ...form, title })} />
        <SelectField label="Project" value={form.project_id} onChange={(project_id) => setForm({ ...form, project_id })} options={projects.map((project) => [project.id, project.name])} />
        <SelectField label="Task category" value={form.category_id} onChange={(category_id) => setForm({ ...form, category_id })} options={categories.map((category) => [category.id, category.name])} />
        <SelectField label="Owner" value={form.owner_id} onChange={(owner_id) => setForm({ ...form, owner_id })} options={[["", "Unassigned"], ...users.map((user) => [user.id, user.name])]} />
        <SelectField label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })} options={statusOptions.map((status) => [status, status])} />
        <DateField label="Due date" value={form.due_date} onChange={(due_date) => setForm({ ...form, due_date })} />
        <NumberField label="Progress %" value={form.progress} onChange={(progress) => setForm({ ...form, progress })} />
        <TextAreaField label="Notes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} span />
      </FormGrid>
      <ModalActions onClose={onClose} onSave={() => onSave(form)} />
    </Modal>
  );
}

function SubTaskModal({ item, categories, users, mainTasks, onClose, onSave }) {
  const [form, setForm] = useState(item);
  const update = (patch) => setForm((previous) => ({ ...previous, ...patch }));
  return (
    <Modal title={item.id ? "Edit sub task" : "Add sub task"} onClose={onClose}>
      <FormGrid>
        <TextField label="Sub Task name" value={form.title} onChange={(title) => update({ title })} />
        <SelectField label="Related Main Task" value={form.main_task_id} onChange={(main_task_id) => update({ main_task_id, project_id: mainTasks.find((task) => task.id === main_task_id)?.project_id || form.project_id })} options={mainTasks.map((task) => [task.id, task.title])} />
        <SelectField label="Task category" value={form.category_id} onChange={(category_id) => update({ category_id })} options={categories.map((category) => [category.id, category.name])} />
        <SelectField label="Owner" value={form.owner_id} onChange={(owner_id) => update({ owner_id })} options={[["", "Unassigned"], ...users.map((user) => [user.id, user.name])]} />
        <SelectField label="Status" value={form.status} onChange={(status) => update({ status, progress: status === "Completed" ? 100 : form.progress })} options={statusOptions.map((status) => [status, status])} />
        <SelectField label="Priority" value={form.priority} onChange={(priority) => update({ priority })} options={priorityOptions.map((priority) => [priority, priority])} />
        <DateField label="Due date" value={form.due_date} onChange={(due_date) => update({ due_date })} />
        <NumberField label="Progress %" value={form.progress} onChange={(progress) => update({ progress, status: Number(progress) === 100 ? "Completed" : form.status })} />
        <TextField label="Attachment / document link" value={form.attachment_url} onChange={(attachment_url) => update({ attachment_url })} />
        <SelectField label="Blocker status" value={form.blocker_status} onChange={(blocker_status) => update({ blocker_status })} options={[["No", "No"], ["Yes", "Yes"]]} />
        {form.blocker_status === "Yes" && (
          <>
            <TextAreaField label="Blocker detail" value={form.blocker_detail} onChange={(blocker_detail) => update({ blocker_detail })} span />
            <SelectField label="Blocker category" value={form.blocker_category} onChange={(blocker_category) => update({ blocker_category })} options={blockerCategories.map((category) => [category, category])} />
            <SelectField label="Blocker owner" value={form.blocker_owner_id} onChange={(blocker_owner_id) => update({ blocker_owner_id })} options={[["", "Unassigned"], ...users.map((user) => [user.id, user.name])]} />
            <DateField label="Expected resolution date" value={form.blocker_expected_resolution_date} onChange={(blocker_expected_resolution_date) => update({ blocker_expected_resolution_date })} />
            <SelectField label="Blocker severity" value={form.blocker_severity} onChange={(blocker_severity) => update({ blocker_severity })} options={blockerSeverityOptions.map((severity) => [severity, severity])} />
          </>
        )}
        <TextAreaField label="Latest update" value={form.latest_update} onChange={(latest_update) => update({ latest_update })} span />
      </FormGrid>
      <ModalActions onClose={onClose} onSave={() => onSave(form)} />
    </Modal>
  );
}

function HistoryModal({ item, updates, users, canUpdate, onClose, onSave }) {
  const [form, setForm] = useState({ update_detail: "", next_action: "", blocker: "" });
  return (
    <Modal title={`Update history: ${item.title}`} onClose={onClose}>
      {canUpdate && (
        <div className="mb-5 rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
          <FormGrid>
            <TextAreaField label="Update detail" value={form.update_detail} onChange={(update_detail) => setForm({ ...form, update_detail })} span />
            <TextField label="Next action" value={form.next_action} onChange={(next_action) => setForm({ ...form, next_action })} />
            <TextField label="Issue / blocker, if any" value={form.blocker} onChange={(blocker) => setForm({ ...form, blocker })} />
          </FormGrid>
          <button className="primary-button mt-4" onClick={() => {
            onSave(form);
            setForm({ update_detail: "", next_action: "", blocker: "" });
          }}>
            <Plus size={17} /> Add update
          </button>
        </div>
      )}
      <div className="space-y-3">
        {updates.map((update) => (
          <div key={update.id} className="timeline-row items-start">
            <div className="timeline-date">{formatDate(update.created_at)}</div>
            <div>
              <p className="font-semibold">{getUserName(users, update.updated_by)}</p>
              <p className="mt-1 text-slate-700">{update.update_detail}</p>
              <p className="mt-2 text-sm text-slate-500">Next: {update.next_action || "No next action"}</p>
              {update.blocker && <p className="mt-1 text-sm font-semibold text-red-600">Issue: {update.blocker}</p>}
            </div>
          </div>
        ))}
        {!updates.length && <EmptyState text="No update history yet." />}
      </div>
    </Modal>
  );
}

function CategoryModal({ item, onClose, onSave }) {
  const [form, setForm] = useState(item);
  return (
    <Modal title={item.id ? "Edit category" : "Add category"} onClose={onClose}>
      <FormGrid>
        <TextField label="Category name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <label>
          <span className="label">Color</span>
          <input className="h-11 w-full rounded-[8px] border border-slate-200 bg-white p-1" type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
        </label>
      </FormGrid>
      <ModalActions onClose={onClose} onSave={() => onSave(form)} />
    </Modal>
  );
}

function UserModal({ item, onClose, onSave }) {
  const [form, setForm] = useState(item);
  return (
    <Modal title={item.id ? "Edit team member" : "Add team member"} onClose={onClose}>
      <FormGrid>
        <TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <TextField label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
        <SelectField label="Role" value={form.role} onChange={(role) => setForm({ ...form, role })} options={roles.map((role) => [role, role])} />
      </FormGrid>
      <ModalActions onClose={onClose} onSave={() => onSave(form)} />
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-[8px] bg-white p-5 shadow-soft">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-normal">{title}</h2>
          <button className="icon-button" onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, onSave }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button className="secondary-button" onClick={onClose}>Cancel</button>
      <button className="primary-button" onClick={onSave}><Check size={17} /> Save</button>
    </div>
  );
}

function FormGrid({ children }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}

function TextField({ label, value, onChange }) {
  return <label><span className="label">{label}</span><input className="field" value={value || ""} onChange={(event) => onChange(event.target.value)} /></label>;
}

function DateField({ label, value, onChange }) {
  return <label><span className="label">{label}</span><input className="field" type="date" value={value || ""} onChange={(event) => onChange(event.target.value)} /></label>;
}

function NumberField({ label, value, onChange }) {
  return <label><span className="label">{label}</span><input className="field" type="number" min="0" max="100" value={value ?? 0} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="field" value={value || ""} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, labelText]) => <option key={optionValue || "blank"} value={optionValue}>{labelText}</option>)}
      </select>
    </label>
  );
}

function TextAreaField({ label, value, onChange, span }) {
  return (
    <label className={span ? "md:col-span-2" : ""}>
      <span className="label">{label}</span>
      <textarea className="field min-h-24" value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Panel({ children, className = "" }) {
  return <div className={`rounded-[8px] border border-white/80 bg-white/90 p-4 shadow-soft ring-1 ring-slate-100 ${className}`}>{children}</div>;
}

function TableHeader({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="page-title text-2xl">{title}</h2>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function JourneyBar({ progress }) {
  return (
    <div className="journey">
      <div className="journey-fill" style={{ width: `${progress}%` }} />
      <span className="walker" style={{ left: `clamp(0px, calc(${progress}% - 11px), calc(100% - 22px))` }} aria-hidden="true">&#128694;</span>
    </div>
  );
}

function CountdownBadge({ text }) {
  return (
    <div className="countdown-badge">
      <Clock3 size={20} />
      <div>
        <p className="text-xs font-bold uppercase tracking-normal text-amber-800">Event countdown</p>
        <p className="text-2xl font-black tracking-normal text-red-700 sm:text-3xl">{text}</p>
      </div>
    </div>
  );
}

function CountdownMetric({ text }) {
  return (
    <div className="rounded-[8px] bg-amber-50 p-3 text-red-800 ring-1 ring-amber-200">
      <p className="text-xs font-bold uppercase tracking-normal text-amber-800">Countdown</p>
      <p className="mt-1 break-words text-3xl font-black tracking-normal">{text}</p>
    </div>
  );
}

function ProgressLine({ progress }) {
  return <div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-teal-500 via-sky-500 to-indigo-500" style={{ width: `${progress}%` }} /></div>;
}

function ProgressCell({ progress }) {
  return <div className="flex min-w-32 items-center gap-2"><ProgressLine progress={progress} /><span className="w-9 text-right text-xs font-semibold">{progress}%</span></div>;
}

function MetricTile({ label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-900 ring-slate-200",
    blue: "bg-blue-50 text-blue-800 ring-blue-200",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-red-50 text-red-800 ring-red-200",
  };
  return (
    <div className={`rounded-[8px] p-3 ring-1 ${tones[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-normal opacity-70">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function MiniBars({ rows }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate font-medium">{row.label}</span>
            <span className="font-semibold">{row.value}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-blue-500" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`badge ${statusStyles[status] || statusStyles["Not Started"]}`}>{status}</span>;
}

function PriorityBadge({ priority }) {
  return <span className={`badge ${priorityStyles[priority] || priorityStyles.Medium}`}>{priority}</span>;
}

function BlockerBadge({ task }) {
  const overdue = isOverdue(task.blocker_expected_resolution_date, "In Progress");
  return (
    <span className={`badge ${task.blocker_severity === "Critical" || overdue ? "bg-red-100 text-red-700 ring-red-200" : "bg-orange-100 text-orange-700 ring-orange-200"}`}>
      {task.blocker_severity || "Blocker"}{overdue ? " / Overdue" : ""}
    </span>
  );
}

function CategoryPill({ category }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-[8px] bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: category.color }} />
      {category.name}
    </span>
  );
}

function RowActions({ onEdit, onDelete }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="table-action-button" onClick={onEdit} title="Edit">
        <Edit3 size={15} />
        Edit
      </button>
      {onDelete && (
        <button className="table-action-button danger" onClick={onDelete} title="Delete">
          <Trash2 size={15} />
          Delete
        </button>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="rounded-[8px] border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">{text}</div>;
}

function buildProjectMetrics(project, mainTasks, subTasks) {
  const projectMain = mainTasks.filter((task) => task.project_id === project.id);
  const projectSub = subTasks.filter((task) => task.project_id === project.id);
  const blockers = projectSub.filter((task) => task.blocker_status === "Yes");
  const countdown = daysUntil(project.start_date);
  return {
    ...project,
    progress: calculateProjectProgress(project.id, subTasks),
    countdownText:
      countdown === null ? "No date" : countdown >= 0 ? `${countdown} days left` : `${Math.abs(countdown)} days past`,
    totalMain: projectMain.length,
    totalSub: projectSub.length,
    completed: projectSub.filter((task) => task.status === "Completed").length,
    inProgress: projectSub.filter((task) => task.status === "In Progress").length,
    pending: projectSub.filter((task) => task.status === "Pending").length,
    onHold: projectSub.filter((task) => task.status === "On Hold").length,
    overdue: projectSub.filter((task) => isOverdue(task.due_date, task.status)).length,
    urgent: projectSub.filter((task) => task.priority === "Urgent").length,
    blockers: blockers.length,
    criticalBlockers: blockers.filter((task) => task.blocker_severity === "Critical").length,
  };
}

function filterAndSortSubTasks(tasks, selectedProjectId, filters) {
  const priorityRank = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  const filtered = tasks.filter((task) => {
    if (selectedProjectId && task.project_id !== selectedProjectId) return false;
    if (filters.search && !`${task.title} ${task.latest_update}`.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.category && task.category_id !== filters.category) return false;
    if (filters.owner && task.owner_id !== filters.owner) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.due && task.due_date !== filters.due) return false;
    if (filters.overdueOnly && !isOverdue(task.due_date, task.status)) return false;
    if (filters.urgentOnly && task.priority !== "Urgent") return false;
    if (filters.blockerOnly && task.blocker_status !== "Yes") return false;
    return true;
  });
  return filtered.sort((a, b) => {
    if (filters.sort === "priority") return priorityRank[a.priority] - priorityRank[b.priority];
    if (filters.sort === "progress") return b.progress - a.progress;
    if (filters.sort === "status") return a.status.localeCompare(b.status);
    if (filters.sort === "updated_at") return new Date(b.updated_at) - new Date(a.updated_at);
    return new Date(a.due_date || "2999-01-01") - new Date(b.due_date || "2999-01-01");
  });
}

function buildAlerts(projects, users, subTasks) {
  return subTasks
    .flatMap((task) => {
      const project = projects.find((item) => item.id === task.project_id);
      const base = `${project?.name || "Project"} - ${task.title}`;
      return [
        isOverdue(task.due_date, task.status) && {
          id: `${task.id}-overdue`,
          level: "critical",
          title: "Overdue task",
          detail: `${base} was due ${formatDate(task.due_date)}.`,
        },
        task.priority === "Urgent" && {
          id: `${task.id}-urgent`,
          level: "warning",
          title: "Urgent task",
          detail: `${base} is marked urgent.`,
        },
        task.blocker_severity === "Critical" && {
          id: `${task.id}-critical`,
          level: "critical",
          title: "Critical blocker",
          detail: `${base}: ${task.blocker_detail}`,
        },
        task.blocker_status === "Yes" &&
          isOverdue(task.blocker_expected_resolution_date, "In Progress") && {
            id: `${task.id}-blocker-overdue`,
            level: "critical",
            title: "Overdue blocker resolution",
            detail: `${base} expected resolution was ${formatDate(task.blocker_expected_resolution_date)}.`,
          },
        !task.owner_id && {
          id: `${task.id}-no-owner`,
          level: "warning",
          title: "Task without owner",
          detail: `${base} needs an owner. Current owner: ${getUserName(users, task.owner_id)}.`,
        },
        !task.due_date && {
          id: `${task.id}-no-date`,
          level: "warning",
          title: "Task without due date",
          detail: `${base} needs a due date.`,
        },
      ].filter(Boolean);
    })
    .sort((a, b) => Number(b.level === "critical") - Number(a.level === "critical"));
}

function groupCount(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "Unassigned";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function csvTaskRow(task, state, mainTasks) {
  return {
    project: state.projects.find((project) => project.id === task.project_id)?.name || "",
    main_task: mainTasks.find((main) => main.id === task.main_task_id)?.title || "",
    sub_task: task.title,
    category: getCategory(state.categories, task.category_id).name,
    owner: getUserName(state.users, task.owner_id),
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    progress: task.progress,
    latest_update: task.latest_update,
    blocker_status: task.blocker_status,
    blocker_detail: task.blocker_detail,
    blocker_category: task.blocker_category,
    blocker_owner: getUserName(state.users, task.blocker_owner_id),
    blocker_expected_resolution_date: task.blocker_expected_resolution_date,
    blocker_severity: task.blocker_severity,
  };
}

export default App;
