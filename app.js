(() => {
  const CONFIG = window.WORKBOARD_CONFIG || {};
  const isConfigured =
    CONFIG.supabaseUrl &&
    CONFIG.supabasePublishableKey &&
    !CONFIG.supabaseUrl.includes("YOUR-PROJECT") &&
    !CONFIG.supabasePublishableKey.includes("YOUR_PUBLISHABLE_KEY");

  if (!isConfigured) {
    document.addEventListener("DOMContentLoaded", () => {
      const error = document.getElementById("loginError");
      if (error) error.textContent = "Setup needed: add your Supabase URL and publishable key in config.js.";
    });
    return;
  }

  const db = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  const STATUS = {
    backlog: { label: "Backlog", short: "Backlog" },
    todo: { label: "To do", short: "To do" },
    in_progress: { label: "In progress", short: "Doing" },
    review: { label: "Review", short: "Review" },
    done: { label: "Done", short: "Done" }
  };
  const STATUS_ORDER = ["backlog", "todo", "in_progress", "review", "done"];

  const state = {
    user: null,
    employees: [],
    projects: [],
    tasks: [],
    view: localStorage.getItem("workboard:view") || "person",
    projectFilter: "all",
    search: "",
    mobileColumn: null,
    sortables: []
  };

  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    applyTheme();
    bindUI();
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      state.user = session.user;
      await enterApp();
    } else {
      showAuth();
    }

    db.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        state.user = session.user;
        await enterApp();
      } else {
        state.user = null;
        showAuth();
      }
    });
  }

  function bindUI() {
    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", () => db.auth.signOut());
    $("themeToggle").addEventListener("click", toggleTheme);

    qsa(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchSection(btn.dataset.section)));
    qsa(".segment").forEach(btn => btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      localStorage.setItem("workboard:view", state.view);
      qsa(".segment").forEach(x => x.classList.toggle("active", x.dataset.view === state.view));
      state.mobileColumn = null;
      renderBoard();
    }));

    ["newTaskTop", "newTaskMobile", "emptyCreateBtn"].forEach(id => $(id).addEventListener("click", () => openTask()));
    $("addProjectBtn").addEventListener("click", () => openProject());
    $("addEmployeeBtn").addEventListener("click", () => openEmployee());

    $("projectFilter").addEventListener("change", e => {
      state.projectFilter = e.target.value;
      renderBoard();
    });
    $("taskSearch").addEventListener("input", e => {
      state.search = e.target.value.trim().toLowerCase();
      renderBoard();
    });
    $("mobileColumnSelect").addEventListener("change", e => {
      state.mobileColumn = e.target.value;
      updateMobileColumn();
    });

    $("taskForm").addEventListener("submit", saveTask);
    $("projectForm").addEventListener("submit", saveProject);
    $("employeeForm").addEventListener("submit", saveEmployee);

    $("deleteTaskBtn").addEventListener("click", deleteCurrentTask);
    $("archiveProjectBtn").addEventListener("click", archiveCurrentProject);
    $("removeEmployeeBtn").addEventListener("click", removeCurrentEmployee);

    qsa(".close-dialog").forEach(btn => btn.addEventListener("click", () => btn.closest("dialog").close()));
  }

  function applyTheme() {
    const saved = localStorage.getItem("workboard:theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved || (prefersDark ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    updateThemeButton(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("workboard:theme", next);
    updateThemeButton(next);
  }

  function updateThemeButton(theme) {
    const button = $("themeToggle");
    if (!button) return;
    button.textContent = theme === "dark" ? "☀" : "☾";
    button.title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    button.setAttribute("aria-label", button.title);
  }

  async function login(e) {
    e.preventDefault();
    $("loginError").textContent = "";
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) $("loginError").textContent = error.message;
  }

  function showAuth() {
    $("app").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
  }

  async function enterApp() {
    $("authScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    setGreeting();
    qsa(".segment").forEach(x => x.classList.toggle("active", x.dataset.view === state.view));
    await refreshAll();
  }

  function setGreeting() {
    const hour = new Date().getHours();
    const phrase = hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
    $("greeting").textContent = `${phrase} What’s moving?`;
  }

  async function refreshAll() {
    setSync("Syncing…");
    const [employeesRes, projectsRes, tasksRes] = await Promise.all([
      db.from("employees").select("*").eq("active", true).order("name"),
      db.from("projects").select("*").eq("archived", false).order("created_at"),
      db.from("tasks").select("*").order("position").order("created_at")
    ]);

    const error = employeesRes.error || projectsRes.error || tasksRes.error;
    if (error) {
      toast(error.message, true);
      setSync("Sync error");
      return;
    }

    state.employees = employeesRes.data || [];
    state.projects = projectsRes.data || [];
    state.tasks = (tasksRes.data || []).filter(t => state.projects.some(p => p.id === t.project_id));
    populateProjectSelectors();
    renderBoard();
    renderProjects();
    renderTeam();
    setSync("Synced");
  }

  function setSync(text) { $("syncLabel").textContent = text; }

  function switchSection(section) {
    qsa(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.section === section));
    qsa(".page-section").forEach(sec => sec.classList.remove("active"));
    $(`${section}Section`).classList.add("active");
  }

  function populateProjectSelectors() {
    const filter = $("projectFilter");
    const currentFilter = state.projectFilter;
    filter.innerHTML = `<option value="all">All projects</option>` +
      state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    filter.value = state.projects.some(p => p.id === currentFilter) ? currentFilter : "all";
    state.projectFilter = filter.value;

    $("taskProject").innerHTML = state.projects.length
      ? state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
      : `<option value="">Create a project first</option>`;

    $("taskEmployee").innerHTML =
      `<option value="">Unassigned</option>` +
      state.employees.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  }

  function filteredTasks() {
    return state.tasks.filter(t => {
      const matchesProject = state.projectFilter === "all" || t.project_id === state.projectFilter;
      const project = projectById(t.project_id);
      const employee = employeeById(t.employee_id);
      const haystack = `${t.title} ${t.description || ""} ${project?.name || ""} ${employee?.name || ""}`.toLowerCase();
      return matchesProject && (!state.search || haystack.includes(state.search));
    });
  }

  function getColumns() {
    if (state.view === "person") {
      return [
        { id: "unassigned", title: "Unassigned", avatar: "—" },
        ...state.employees.map(e => ({ id: e.id, title: e.name, avatar: initials(e.name) }))
      ];
    }
    return STATUS_ORDER.map(id => ({ id, title: STATUS[id].label, avatar: null }));
  }

  function taskBelongs(task, columnId) {
    return state.view === "person"
      ? (columnId === "unassigned" ? !task.employee_id : task.employee_id === columnId)
      : task.status === columnId;
  }

  function renderBoard() {
    destroySortables();
    const tasks = filteredTasks();
    const columns = getColumns();
    const kanban = $("kanban");
    kanban.innerHTML = "";

    $("emptyBoard").classList.toggle("hidden", !(state.tasks.length === 0 || state.projects.length === 0));
    kanban.classList.toggle("hidden", state.tasks.length === 0 || state.projects.length === 0);

    if (!columns.length) return;

    columns.forEach(col => {
      const colTasks = tasks.filter(t => taskBelongs(t, col.id)).sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
      const el = document.createElement("section");
      el.className = "kanban-column";
      el.dataset.columnId = col.id;
      el.innerHTML = `
        <div class="column-head">
          <div class="column-title">
            ${col.avatar !== null ? `<div class="avatar">${escapeHtml(col.avatar)}</div>` : ""}
            <h3>${escapeHtml(col.title)}</h3>
          </div>
          <span class="count">${colTasks.length}</span>
        </div>
        <div class="column-body" data-drop-column="${col.id}">
          ${colTasks.map(taskCardHtml).join("")}
        </div>`;
      kanban.appendChild(el);
    });

    qsa(".task-card", kanban).forEach(card => card.addEventListener("click", e => {
      if (card.classList.contains("sortable-chosen")) return;
      openTask(card.dataset.taskId);
    }));

    setupSortables();
    renderMobilePicker(columns);
  }

  function taskCardHtml(task) {
    const project = projectById(task.project_id);
    const employee = employeeById(task.employee_id);
    const projectColor = project?.color || "#8b6f65";
    const isOverdue = task.due_date && task.status !== "done" && new Date(`${task.due_date}T23:59:59`) < new Date();
    const assigneeTag = state.view === "status"
      ? `<span class="tag">${employee ? `👤 ${escapeHtml(employee.name)}` : "○ Unassigned"}</span>`
      : `<span class="tag status-tag">${escapeHtml(STATUS[task.status]?.short || task.status)}</span>`;

    return `
      <article class="task-card" data-task-id="${task.id}" style="--project-color:${escapeAttr(projectColor)}">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="tag project-tag">${escapeHtml(project?.name || "Unknown project")}</span>
          ${assigneeTag}
        </div>
        ${task.due_date ? `<div class="due ${isOverdue ? "overdue" : ""}">${isOverdue ? "Overdue · " : ""}${formatDate(task.due_date)}</div>` : ""}
      </article>`;
  }

  function setupSortables() {
    qsa(".column-body").forEach(body => {
      const sortable = new Sortable(body, {
        group: "workboard",
        animation: 160,
        draggable: ".task-card",
        ghostClass: "sortable-ghost",
        chosenClass: "sortable-chosen",
        delay: 80,
        delayOnTouchOnly: true,
        onEnd: handleDragEnd
      });
      state.sortables.push(sortable);
    });
  }

  function destroySortables() {
    state.sortables.forEach(s => s.destroy());
    state.sortables = [];
  }

  async function handleDragEnd(evt) {
    const taskId = evt.item.dataset.taskId;
    const destination = evt.to.dataset.dropColumn;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const updates = {};
    if (state.view === "person") updates.employee_id = destination === "unassigned" ? null : destination;
    else updates.status = destination;

    const siblings = [...evt.to.querySelectorAll(".task-card")];
    siblings.forEach((el, index) => {
      const local = state.tasks.find(t => t.id === el.dataset.taskId);
      if (local) local.position = index * 1000;
    });

    Object.assign(task, updates);
    renderBoard();
    setSync("Saving…");

    const moveRes = await db.from("tasks").update(updates).eq("id", taskId);
    const orderUpdates = siblings.map((el, index) =>
      db.from("tasks").update({ position: index * 1000 }).eq("id", el.dataset.taskId)
    );
    const orderResults = await Promise.all(orderUpdates);

    if (moveRes.error || orderResults.some(r => r.error)) {
      toast(moveRes.error?.message || "Could not save card order.", true);
      await refreshAll();
      return;
    }
    setSync("Synced");
  }

  function renderMobilePicker(columns) {
    const select = $("mobileColumnSelect");
    select.innerHTML = columns.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("");
    if (!state.mobileColumn || !columns.some(c => c.id === state.mobileColumn)) state.mobileColumn = columns[0]?.id || null;
    select.value = state.mobileColumn;
    updateMobileColumn();
  }

  function updateMobileColumn() {
    qsa(".kanban-column").forEach(c => c.classList.toggle("mobile-visible", c.dataset.columnId === state.mobileColumn));
  }

  function renderProjects() {
    const grid = $("projectsGrid");
    if (!state.projects.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-emoji">◌</div><h3>No projects yet.</h3><p>Create one before creating tasks.</p></div>`;
      return;
    }
    grid.innerHTML = state.projects.map(p => {
      const open = state.tasks.filter(t => t.project_id === p.id && t.status !== "done").length;
      const total = state.tasks.filter(t => t.project_id === p.id).length;
      return `
        <article class="info-card">
          <div class="info-card-top">
            <span class="project-dot" style="background:${escapeAttr(p.color)}"></span>
            <h3>${escapeHtml(p.name)}</h3>
          </div>
          <p>${open} open · ${total} total task${total === 1 ? "" : "s"}</p>
          <div class="card-actions">
            <button class="btn ghost edit-project" data-project-id="${p.id}">Edit</button>
            <button class="btn ghost filter-project" data-project-id="${p.id}">View tasks</button>
          </div>
        </article>`;
    }).join("");

    qsa(".edit-project", grid).forEach(b => b.addEventListener("click", () => openProject(b.dataset.projectId)));
    qsa(".filter-project", grid).forEach(b => b.addEventListener("click", () => {
      state.projectFilter = b.dataset.projectId;
      $("projectFilter").value = state.projectFilter;
      switchSection("tasks");
      renderBoard();
    }));
  }

  function renderTeam() {
    const grid = $("teamGrid");
    if (!state.employees.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-emoji">☺</div><h3>No employees yet.</h3><p>Add someone so tasks can be assigned.</p></div>`;
      return;
    }
    grid.innerHTML = state.employees.map(e => {
      const active = state.tasks.filter(t => t.employee_id === e.id && t.status !== "done").length;
      const total = state.tasks.filter(t => t.employee_id === e.id).length;
      return `
        <article class="info-card">
          <div class="info-card-top">
            <div class="avatar">${escapeHtml(initials(e.name))}</div>
            <h3>${escapeHtml(e.name)}</h3>
          </div>
          <p>${active} active · ${total} total task${total === 1 ? "" : "s"}</p>
          <div class="card-actions">
            <button class="btn ghost edit-employee" data-employee-id="${e.id}">Edit</button>
          </div>
        </article>`;
    }).join("");
    qsa(".edit-employee", grid).forEach(b => b.addEventListener("click", () => openEmployee(b.dataset.employeeId)));
  }

  function openTask(id = null) {
    if (!state.projects.length) {
      toast("Create a project first.", true);
      switchSection("projects");
      return;
    }

    $("taskForm").reset();
    $("taskId").value = "";
    $("taskStatus").value = "todo";
    $("deleteTaskBtn").classList.add("hidden");
    $("taskModalEyebrow").textContent = "NEW TASK";
    $("taskModalTitle").textContent = "Create task";
    populateProjectSelectors();

    if (state.projectFilter !== "all" && state.projects.some(p => p.id === state.projectFilter)) {
      $("taskProject").value = state.projectFilter;
    }

    if (id) {
      const t = state.tasks.find(x => x.id === id);
      if (!t) return;
      $("taskId").value = t.id;
      $("taskTitle").value = t.title;
      $("taskProject").value = t.project_id;
      $("taskEmployee").value = t.employee_id || "";
      $("taskStatus").value = t.status;
      $("taskDueDate").value = t.due_date || "";
      $("taskDescription").value = t.description || "";
      $("deleteTaskBtn").classList.remove("hidden");
      $("taskModalEyebrow").textContent = "TASK";
      $("taskModalTitle").textContent = "Edit task";
    }
    $("taskDialog").showModal();
  }

  async function saveTask(e) {
    e.preventDefault();
    const id = $("taskId").value || null;
    const payload = {
      title: $("taskTitle").value.trim(),
      project_id: $("taskProject").value,
      employee_id: $("taskEmployee").value || null,
      status: $("taskStatus").value,
      due_date: $("taskDueDate").value || null,
      description: $("taskDescription").value.trim() || null,
      updated_at: new Date().toISOString()
    };

    if (!payload.title || !payload.project_id) return;

    setSync("Saving…");
    let res;
    if (id) {
      res = await db.from("tasks").update(payload).eq("id", id);
    } else {
      const matching = state.tasks.filter(t => state.view === "person"
        ? t.employee_id === payload.employee_id
        : t.status === payload.status);
      payload.position = matching.length * 1000;
      res = await db.from("tasks").insert(payload);
    }

    if (res.error) {
      toast(res.error.message, true);
      setSync("Sync error");
      return;
    }
    $("taskDialog").close();
    toast(id ? "Task updated." : "Task created.");
    await refreshAll();
  }

  async function deleteCurrentTask() {
    const id = $("taskId").value;
    if (!id) return;
    const ok = await confirmAction("Delete task?", "This permanently removes the task.");
    if (!ok) return;
    const { error } = await db.from("tasks").delete().eq("id", id);
    if (error) return toast(error.message, true);
    $("taskDialog").close();
    toast("Task deleted.");
    await refreshAll();
  }

  function openProject(id = null) {
    $("projectForm").reset();
    $("projectId").value = "";
    $("projectColor").value = "#8b6f65";
    $("archiveProjectBtn").classList.add("hidden");
    $("projectModalTitle").textContent = "New project";

    if (id) {
      const p = state.projects.find(x => x.id === id);
      if (!p) return;
      $("projectId").value = p.id;
      $("projectName").value = p.name;
      $("projectColor").value = p.color || "#8b6f65";
      $("archiveProjectBtn").classList.remove("hidden");
      $("projectModalTitle").textContent = "Edit project";
    }
    $("projectDialog").showModal();
  }

  async function saveProject(e) {
    e.preventDefault();
    const id = $("projectId").value || null;
    const payload = {
      name: $("projectName").value.trim(),
      color: $("projectColor").value,
      updated_at: new Date().toISOString()
    };
    const res = id
      ? await db.from("projects").update(payload).eq("id", id)
      : await db.from("projects").insert(payload);
    if (res.error) return toast(res.error.message, true);
    $("projectDialog").close();
    toast(id ? "Project updated." : "Project created.");
    await refreshAll();
  }

  async function archiveCurrentProject() {
    const id = $("projectId").value;
    const project = state.projects.find(p => p.id === id);
    if (!project) return;
    const openCount = state.tasks.filter(t => t.project_id === id && t.status !== "done").length;
    const ok = await confirmAction(
      `Archive ${project.name}?`,
      openCount ? `It still has ${openCount} open task${openCount === 1 ? "" : "s"}. The tasks will remain stored.` : "Its tasks will remain stored."
    );
    if (!ok) return;
    const { error } = await db.from("projects").update({ archived: true, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast(error.message, true);
    $("projectDialog").close();
    if (state.projectFilter === id) state.projectFilter = "all";
    toast("Project archived.");
    await refreshAll();
  }

  function openEmployee(id = null) {
    $("employeeForm").reset();
    $("employeeId").value = "";
    $("removeEmployeeBtn").classList.add("hidden");
    $("employeeModalTitle").textContent = "Add employee";

    if (id) {
      const emp = state.employees.find(x => x.id === id);
      if (!emp) return;
      $("employeeId").value = emp.id;
      $("employeeName").value = emp.name;
      $("removeEmployeeBtn").classList.remove("hidden");
      $("employeeModalTitle").textContent = "Edit employee";
    }
    $("employeeDialog").showModal();
  }

  async function saveEmployee(e) {
    e.preventDefault();
    const id = $("employeeId").value || null;
    const payload = { name: $("employeeName").value.trim() };
    const res = id
      ? await db.from("employees").update(payload).eq("id", id)
      : await db.from("employees").insert(payload);
    if (res.error) return toast(res.error.message, true);
    $("employeeDialog").close();
    toast(id ? "Employee updated." : "Employee added.");
    await refreshAll();
  }

  async function removeCurrentEmployee() {
    const id = $("employeeId").value;
    const emp = state.employees.find(e => e.id === id);
    if (!emp) return;
    const count = state.tasks.filter(t => t.employee_id === id).length;
    const ok = await confirmAction(
      `Remove ${emp.name}?`,
      `${count ? `${count} task${count === 1 ? "" : "s"} will become unassigned. ` : ""}The employee can be restored manually in Supabase if needed.`
    );
    if (!ok) return;

    const { error: taskError } = await db.from("tasks").update({ employee_id: null }).eq("employee_id", id);
    if (taskError) return toast(taskError.message, true);
    const { error } = await db.from("employees").update({ active: false }).eq("id", id);
    if (error) return toast(error.message, true);

    $("employeeDialog").close();
    toast(`${emp.name} removed. Their tasks are unassigned.`);
    await refreshAll();
  }

  function confirmAction(title, text) {
    return new Promise(resolve => {
      $("confirmTitle").textContent = title;
      $("confirmText").textContent = text;
      const dialog = $("confirmDialog");

      const cleanup = value => {
        $("confirmOk").onclick = null;
        $("confirmCancel").onclick = null;
        dialog.close();
        resolve(value);
      };
      $("confirmOk").onclick = () => cleanup(true);
      $("confirmCancel").onclick = () => cleanup(false);
      dialog.showModal();
    });
  }

  function employeeById(id) { return state.employees.find(e => e.id === id); }
  function projectById(id) { return state.projects.find(p => p.id === id); }

  function initials(name = "") {
    return name.split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join("").toUpperCase() || "?";
  }

  function formatDate(dateStr) {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(`${dateStr}T12:00:00`));
  }

  function toast(message, isError = false) {
    const el = $("toast");
    el.textContent = message;
    el.style.background = isError ? "#8f342e" : "#282521";
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
  }
  function escapeAttr(value) { return escapeHtml(value); }
})();
