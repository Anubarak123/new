import {
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import "./style.css";
type Category = { id: string; name: string; _count?: { tools: number } };
type Tool = {
  id: string;
  name: string;
  logoPath?: string | null;
  categoryId?: string;
  category?: Category;
  selectedCategoryId?: string | null;
  selectedCategoryName?: string | null;
  correctCategoryName?: string;
  isCorrect?: boolean;
};
type Settings = {
  toolsPerQuiz: number;
  timeLimitSeconds: number;
  totalTools: number;
  totalCategories: number;
  available: boolean;
};
type Attempt = {
  id: string;
  studentName: string;
  semester: string;
  year: number;
  status: string;
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  serverNow: string;
  score: number | null;
  totalTools: number;
  percentage: number | null;
  timeSpentSeconds: number | null;
  categories: Category[];
  tools: Tool[];
};
async function api<T = any>(
  url: string,
  method = "GET",
  body?: unknown,
  attemptId?: string,
): Promise<T> {
  const token = localStorage.getItem("professor-token");
  const multipart = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    headers: {
      ...(!multipart ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(attemptId
        ? {
            "X-Attempt-Token":
              localStorage.getItem(`attempt-token:${attemptId}`) || "",
          }
        : {}),
    },
    body:
      body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => {
    throw new Error("The server is unavailable. Please try again.");
  });
  if (!res.ok) {
    if (res.status === 401 && url.startsWith("/professor")) {
      localStorage.removeItem("professor-token");
      window.location.assign("/professor/login");
    }
    throw new Error(data.error || "Request failed.");
  }
  return data;
}
const duration = (seconds: number | null) =>
  seconds === null
    ? "—"
    : `${Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
const semester = (a: { semester: string; year: number }) =>
  `${a.semester.charAt(0)}${a.semester.slice(1).toLowerCase()} ${a.year}`;
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
function Logo({ path }: { path?: string | null }) {
  return path ? <img className="tool-logo" src={path} alt="" /> : null;
}
function Back() {
  return (
    <Link className="back" to="/professor">
      ← Back to Dashboard
    </Link>
  );
}
function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api<T>(url)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [url]);
  return { data, setData, error, setError };
}
function Protected() {
  const { data, error } = useLoad("/professor/session");
  if (!localStorage.getItem("professor-token"))
    return <Navigate to="/professor/login" replace />;
  return data ? (
    <Outlet />
  ) : error ? (
    <ErrorBox message={error} />
  ) : (
    <p>Checking your session…</p>
  );
}
function Shell() {
  return (
    <>
      <header>
        <Link className="brand" to="/">
          <span className="logo">TQ</span>Digital Tools Quiz
        </Link>
        <span className="header-note">Learn by putting things in place.</span>
        <Link to="/">Home</Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/professor/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route path="/professor" element={<Dashboard />} />
            <Route path="/professor/tools" element={<Library kind="tools" />} />
            <Route
              path="/professor/tools/new"
              element={<RecordForm key="new-tool" kind="tools" />}
            />
            <Route
              path="/professor/tools/:id/edit"
              element={<RecordForm kind="tools" />}
            />
            <Route
              path="/professor/categories"
              element={<Library kind="categories" />}
            />
            <Route
              path="/professor/categories/new"
              element={<RecordForm key="new-category" kind="categories" />}
            />
            <Route
              path="/professor/categories/:id/edit"
              element={<RecordForm kind="categories" />}
            />
            <Route path="/professor/settings" element={<QuizSettings />} />
            <Route path="/professor/results" element={<Results />} />
            <Route
              path="/professor/results/:attemptId"
              element={<ResultPage professor />}
            />
          </Route>
          <Route path="/student" element={<Join />} />
          <Route path="/student/quiz/:attemptId" element={<Play />} />
          <Route path="/student/results/:attemptId" element={<ResultPage />} />
          <Route
            path="*"
            element={
              <section className="card">
                <h1>Page not found</h1>
                <Link to="/">Return home</Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer>Digital Tools Quiz · Learn. Sort. Discover.</footer>
    </>
  );
}
function Home() {
  return (
    <section className="card landing">
      <p className="eyebrow">A PLACE TO PRACTICE</p>
      <h1>Digital Tools Quiz</h1>
      <p className="instructions">
        Test your knowledge of digital tools by sorting them into the correct
        categories.
      </p>
      <div className="role-grid">
        <Link className="nav-card" to="/professor/login">
          <span className="eyebrow">MANAGE & REVIEW</span>
          <h2>Professor →</h2>
          <p>
            Build your tool library, set the quiz, and review student results.
          </p>
        </Link>
        <Link className="nav-card" to="/student">
          <span className="eyebrow">SORT & LEARN</span>
          <h2>Student →</h2>
          <p>
            Enter your name and put your knowledge of digital tools to the test.
          </p>
        </Link>
      </div>
    </section>
  );
}
function Login() {
  const nav = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await api("/auth/login", "POST", {
        username: f.get("username"),
        password: f.get("password"),
      });
      localStorage.setItem("professor-token", r.token);
      nav("/professor");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card narrow">
      <p className="eyebrow">PROFESSOR PORTAL</p>
      <h1>Welcome back</h1>
      <ErrorBox message={error} />
      <form onSubmit={submit}>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            required
            maxLength={150}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
          />
        </label>
        <button disabled={busy}>{busy ? "Logging in…" : "Login"}</button>
      </form>
    </section>
  );
}
function Dashboard() {
  const nav = useNavigate();
  return (
    <>
      <p className="eyebrow">YOUR TEACHING SPACE</p>
      <h1>Professor Dashboard</h1>
      <p>Manage the library and the quiz. See how your students did.</p>
      <div className="dashboard-grid">
        {[
          ["Add Tool", "tools/new", "Grow your digital tool library."],
          ["All Tools", "tools", "Browse, edit, and organize tools."],
          [
            "Add Category",
            "categories/new",
            "Create a place for tools to belong.",
          ],
          ["All Categories", "categories", "Manage your category names."],
          [
            "Quiz Settings",
            "settings",
            "Choose the tool count and time limit.",
          ],
          ["Results", "results", "Review attempts and export results."],
        ].map(([title, url, description]) => (
          <Link className="nav-card" key={url} to={`/professor/${url}`}>
            <h2>{title} →</h2>
            <p>{description}</p>
          </Link>
        ))}
      </div>
      <button
        className="secondary"
        onClick={() => {
          localStorage.removeItem("professor-token");
          nav("/");
        }}
      >
        Logout
      </button>
    </>
  );
}
function Library({ kind }: { kind: "tools" | "categories" }) {
  const { data, setData, error, setError } = useLoad<(Tool & Category)[]>(
    `/professor/${kind}`,
  );
  const [busy, setBusy] = useState(false);
  async function remove(row: Tool & Category) {
    if (!confirm(`Are you sure you want to delete "${row.name}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/professor/${kind}/${row.id}`, "DELETE");
      setData(data!.filter((r) => r.id !== row.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const tools = kind === "tools";
  return (
    <>
      <Back />
      <div className="page-heading">
        <h1>All {tools ? "Tools" : "Categories"}</h1>
        <Link className="button" to={`/professor/${kind}/new`}>
          + Add {tools ? "Tool" : "Category"}
        </Link>
      </div>
      <ErrorBox message={error} />
      <section className="card table-wrap">
        {!data ? (
          <p>Loading…</p>
        ) : !data.length ? (
          <p>
            No {kind} yet. Add your first {tools ? "tool" : "category"} to get
            started.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                {(tools
                  ? ["Logo", "Tool Name", "Category", "Actions"]
                  : ["Category Name", "Number of Tools", "Actions"]
                ).map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  {tools && (
                    <td>
                      <Logo path={r.logoPath} />
                      {!r.logoPath && "—"}
                    </td>
                  )}
                  <td>{r.name}</td>
                  <td>
                    {tools ? r.category?.name : `${r._count?.tools || 0} tools`}
                  </td>
                  <td>
                    <div className="actions">
                      <Link to={`/professor/${kind}/${r.id}/edit`}>Edit</Link>
                      <button
                        className="quiet danger"
                        disabled={busy}
                        onClick={() => void remove(r)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
function RecordForm({ kind }: { kind: "tools" | "categories" }) {
  const { id } = useParams();
  const nav = useNavigate();
  const tools = kind === "tools";
  const [row, setRow] = useState<Tool | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      id ? api<Tool[]>(`/professor/${kind}`) : Promise.resolve([]),
      tools ? api<Category[]>("/professor/categories") : Promise.resolve([]),
    ])
      .then(([rows, c]) => {
        if (!active) return;
        const r = rows.find((r) => r.id === id);
        if (id && !r) throw new Error("Record not found.");
        setRow(r || null);
        setCategories(c);
        setLoading(false);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, kind]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (!String(f.get("name")).trim()) throw new Error("Name is required.");
      const file = f.get("logo");
      if (file instanceof File && !file.size) f.delete("logo");
      await api(
        `/professor/${kind}${id ? `/${id}` : ""}`,
        id ? "PUT" : "POST",
        tools ? f : { name: f.get("name") },
      );
      nav(`/professor/${kind}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Back />
      <section className="card narrow">
        <h1>
          {id ? "Edit" : "Add"} {tools ? "Tool" : "Category"}
        </h1>
        <ErrorBox message={error} />
        {loading ? (
          !error && <p>Loading…</p>
        ) : (
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <label>
                {tools ? "Tool" : "Category"} Name
                <input
                  name="name"
                  defaultValue={row?.name}
                  required
                  maxLength={150}
                />
              </label>
              {tools && (
                <>
                  <label>
                    Category
                    <select
                      name="categoryId"
                      defaultValue={row?.categoryId || ""}
                      required
                    >
                      <option value="" disabled>
                        Select Category
                      </option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!categories.length && (
                    <p className="hint">
                      Add a category before adding a tool.{" "}
                      <Link to="/professor/categories/new">Add Category</Link>
                    </p>
                  )}
                  {row?.logoPath && (
                    <div>
                      <p>Current Logo</p>
                      <Logo path={row.logoPath} />
                      <label className="check">
                        <input type="checkbox" name="removeLogo" value="true" />
                        Remove current logo
                      </label>
                    </div>
                  )}
                  <label>
                    {row?.logoPath ? "Replace Image" : "Logo (optional)"}
                    <input
                      name="logo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                    />
                  </label>
                  <p className="muted">PNG, JPG, or WebP. Maximum 2 MB.</p>
                </>
              )}
              <div className="actions">
                <button disabled={tools && !categories.length}>
                  {busy ? "Saving…" : id ? "Save Changes" : "Save"}
                </button>
                <Link to={`/professor/${kind}`}>Cancel</Link>
              </div>
            </fieldset>
          </form>
        )}
      </section>
    </>
  );
}
function QuizSettings() {
  const { data, error, setError } = useLoad<Settings>("/professor/settings");
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/professor/settings", "PUT", {
        toolsPerQuiz: Number(f.get("count")),
        timeLimitSeconds: Math.round(Number(f.get("minutes")) * 60),
      });
      nav("/professor");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Back />
      <section className="card narrow">
        <h1>Quiz Settings</h1>
        <ErrorBox message={error} />
        {data ? (
          <>
            <p>
              Total tools available: <strong>{data.totalTools}</strong>
              <br />
              Total categories: <strong>{data.totalCategories}</strong>
            </p>
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <label>
                  Number of tools per quiz
                  <input
                    name="count"
                    type="number"
                    min="1"
                    max="500"
                    step="1"
                    required
                    defaultValue={data.toolsPerQuiz}
                  />
                </label>
                <label>
                  Time limit (minutes)
                  <input
                    name="minutes"
                    type="number"
                    min="0.001"
                    max="1440"
                    step="any"
                    required
                    defaultValue={data.timeLimitSeconds / 60}
                  />
                </label>
                {!data.available && (
                  <p className="hint">
                    The quiz is unavailable until settings are valid and enough
                    tools exist.
                  </p>
                )}
                <div className="actions">
                  <button>{busy ? "Saving…" : "Save Changes"}</button>
                  <Link to="/professor">Cancel</Link>
                </div>
              </fieldset>
            </form>
          </>
        ) : (
          !error && <p>Loading settings…</p>
        )}
      </section>
    </>
  );
}
function Join() {
  const { data, error, setError } = useLoad<Settings>("/student");
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const active = localStorage.getItem("active-attempt");
  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const studentName = String(
        new FormData(e.currentTarget).get("name"),
      ).trim();
      if (!studentName) throw new Error("Your name is required.");
      const a = await api("/student/start", "POST", { studentName });
      localStorage.setItem(`attempt-token:${a.id}`, a.token);
      localStorage.setItem("active-attempt", a.id);
      nav(`/student/quiz/${a.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card narrow">
      <p className="eyebrow">READY, SET, SORT</p>
      <h1>Digital Tools Quiz</h1>
      <ErrorBox message={error} />
      {data ? (
        <>
          <div className="join-stats">
            <div>
              <strong>{data.toolsPerQuiz || "—"}</strong>
              <span>Number of tools</span>
            </div>
            <div>
              <strong>{data.timeLimitSeconds / 60 || "—"}</strong>
              <span>minutes</span>
            </div>
          </div>
          {active && (
            <p>
              <Link to={`/student/quiz/${active}`}>
                Resume your previous attempt →
              </Link>
            </p>
          )}
          {!data.available && (
            <p className="hint">
              The quiz is not ready yet. Ask your Professor to check the
              settings and tool library.
            </p>
          )}
          <form onSubmit={start}>
            <label>
              Your Name
              <input
                name="name"
                required
                maxLength={150}
                autoComplete="name"
                placeholder="First and last name"
              />
            </label>
            <button disabled={busy || !data.available}>
              {busy ? "Starting…" : "Start Quiz"}
            </button>
          </form>
          <p className="muted">
            Once the quiz starts, the timer cannot be paused. Your moves are
            saved automatically.
          </p>
        </>
      ) : (
        !error && <p>Loading quiz…</p>
      )}
    </section>
  );
}
function Zone({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`zone ${isOver ? "over" : ""}`}>
      <h2>{title}</h2>
      <div className="zone-items">{children}</div>
      <span className="drop-hint">Drop tools here</span>
    </section>
  );
}
function ToolCard({
  tool,
  categories,
  disabled,
  move,
}: {
  tool: Tool;
  categories: Category[];
  disabled: boolean;
  move: (id: string, category: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: tool.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className="tool"
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px,${transform.y}px,0)`,
              zIndex: 10,
            }
          : undefined
      }
    >
      <button
        className="drag-handle"
        {...listeners}
        {...attributes}
        disabled={disabled}
        aria-label={`Drag ${tool.name}`}
      >
        <Logo path={tool.logoPath} /> <span>⠿</span> {tool.name}
      </button>
      <select
        aria-label={`Category for ${tool.name}`}
        disabled={disabled}
        value={tool.selectedCategoryId || ""}
        onChange={(e) => move(tool.id, e.target.value || null)}
      >
        <option value="">Unsorted</option>
        {categories.map((c) => (
          <option value={c.id} key={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
function Play() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const [a, setA] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const inFlight = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  function accept(row: Attempt) {
    offset.current = new Date(row.serverNow).getTime() - Date.now();
    setA(row);
    if (row.status !== "IN_PROGRESS") {
      localStorage.removeItem("active-attempt");
      nav(`/student/results/${row.id}`, { replace: true });
    }
    setNow(Date.now() + offset.current);
  }
  async function refresh() {
    accept(
      await api<Attempt>(`/attempts/${attemptId}`, "GET", undefined, attemptId),
    );
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(timer);
  }, [attemptId]);
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      accept(
        await api<Attempt>(
          `/attempts/${attemptId}/submit`,
          "POST",
          {
            answers:
              a?.tools.map((t) => ({
                toolId: t.id,
                selectedCategoryId: t.selectedCategoryId || null,
              })) || [],
          },
          attemptId,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const remaining = a
    ? Math.max(0, Math.ceil((new Date(a.expiresAt).getTime() - now) / 1000))
    : 0;
  useEffect(() => {
    if (a?.status === "IN_PROGRESS" && remaining === 0 && !busy) {
      const retry = setTimeout(() => void submit(), 1000);
      return () => clearTimeout(retry);
    }
  }, [a?.status, remaining, busy]);
  async function move(toolId: string, selectedCategoryId: string | null) {
    if (inFlight.current || remaining === 0 || a?.status !== "IN_PROGRESS")
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      accept(
        await api<Attempt>(
          `/attempts/${attemptId}/answers`,
          "PUT",
          { toolId, selectedCategoryId },
          attemptId,
        ),
      );
    } catch (e) {
      setError(`Move was not saved: ${(e as Error).message}`);
      await refresh().catch(() => {});
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!a)
    return (
      <>
        <ErrorBox message={error} />
        {!error && <p>Restoring your attempt…</p>}
      </>
    );
  if (a.status !== "IN_PROGRESS")
    return (
      <>
        <ErrorBox message={error} />
        <ResultDetail a={a} />
      </>
    );
  const disabled = busy || remaining === 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LET’S PUT THINGS IN PLACE · {a.studentName}</p>
          <h1>Digital Tools Quiz</h1>
          <p className="instructions">
            Sort each tool into a category. Unassigned tools count as incorrect.
          </p>
        </div>
        <div className={`timer ${remaining < 30 ? "urgent" : ""}`}>
          <span>Time remaining</span>
          <strong>{duration(remaining)}</strong>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="sorting-meta">
        <span>
          {a.tools.filter((t) => t.selectedCategoryId).length} of {a.totalTools}{" "}
          tools sorted
        </span>
        <span role="status">
          {busy
            ? "Saving…"
            : remaining === 0
              ? "Time is up. Submitting saved answers…"
              : "All changes saved"}
        </span>
      </div>
      <p className="muted">
        Drag a tool into a category, or use its category menu.
      </p>
      <DndContext
        sensors={sensors}
        onDragEnd={({ active, over }) => {
          if (over)
            void move(
              String(active.id),
              over.id === "unsorted" ? null : String(over.id),
            );
        }}
      >
        <Zone id="unsorted" title="Available tools">
          {a.tools
            .filter((t) => !t.selectedCategoryId)
            .map((t) => (
              <ToolCard
                key={t.id}
                tool={t}
                categories={a.categories}
                disabled={disabled}
                move={move}
              />
            ))}
        </Zone>
        <div className="sorting-grid">
          {a.categories.map((c) => (
            <Zone key={c.id} id={c.id} title={c.name}>
              {a.tools
                .filter((t) => t.selectedCategoryId === c.id)
                .map((t) => (
                  <ToolCard
                    key={t.id}
                    tool={t}
                    categories={a.categories}
                    disabled={disabled}
                    move={move}
                  />
                ))}
            </Zone>
          ))}
        </div>
      </DndContext>
      <div className="submit-bar">
        <p>You can move tools until you submit or time runs out.</p>
        <button
          disabled={disabled}
          onClick={() => {
            const missing = a.tools.filter((t) => !t.selectedCategoryId).length;
            if (
              !missing ||
              confirm(
                `${missing} tool(s) are unsorted and will be marked incorrect. Submit now?`,
              )
            )
              void submit();
          }}
        >
          Submit answers →
        </button>
      </div>
    </>
  );
}

function ResultDetail({ a }: { a: Attempt }) {
  return (
    <>
      <p className="eyebrow">
        {a.status === "EXPIRED" ? "TIME EXPIRED" : "QUIZ COMPLETE"}
      </p>
      <h1>{a.studentName}</h1>
      <p>
        {semester(a)} · {date(a.startedAt)}
      </p>
      <section className="result-summary">
        <div>
          <strong>
            {a.score} / {a.totalTools}
          </strong>
          <span>correct answers</span>
        </div>
        <div>
          <strong>{a.percentage}%</strong>
          <span>score</span>
        </div>
        <div>
          <strong>{duration(a.timeSpentSeconds)}</strong>
          <span>time used</span>
        </div>
      </section>
      <div className="answer-list">
        {a.tools.map((t) => (
          <article
            key={t.id}
            className={`answer ${t.isCorrect ? "answer-correct" : "answer-incorrect"}`}
          >
            <span className={t.isCorrect ? "correct-mark" : "incorrect-mark"}>
              {t.isCorrect ? "✓" : "✕"}
            </span>
            <Logo path={t.logoPath} />
            <div>
              <h3>{t.name}</h3>
              <p>
                Your answer: {t.selectedCategoryName || "No category selected"}
              </p>
              <p>
                Correct answer: <strong>{t.correctCategoryName}</strong>
              </p>
            </div>
            <span className="badge">
              {t.isCorrect ? "Correct" : "Incorrect"}
            </span>
          </article>
        ))}
      </div>
    </>
  );
}
function ResultPage({ professor = false }: { professor?: boolean }) {
  const { attemptId } = useParams();
  const [a, setA] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Attempt>(
      professor ? `/professor/results/${attemptId}` : `/attempts/${attemptId}`,
      "GET",
      undefined,
      professor ? undefined : attemptId,
    )
      .then(setA)
      .catch((e) => setError(e.message));
  }, [attemptId, professor]);
  if (a?.status === "IN_PROGRESS" && !professor)
    return <Navigate to={`/student/quiz/${attemptId}`} replace />;
  return (
    <>
      <Link className="back" to={professor ? "/professor/results" : "/student"}>
        ← {professor ? "All Results" : "Student page"}
      </Link>
      <ErrorBox message={error} />
      {a ? (
        a.status === "IN_PROGRESS" ? (
          <section className="card">
            <h1>{a.studentName}</h1>
            <p>
              {semester(a)} · {date(a.startedAt)}
            </p>
            <p>
              This quiz is in progress. Results will be available after
              submission.
            </p>
          </section>
        ) : (
          <ResultDetail a={a} />
        )
      ) : (
        !error && <p>Loading result…</p>
      )}
    </>
  );
}
function Results() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState("newest");
  const [exporting, setExporting] = useState(false);
  const query = new URLSearchParams({
    ...(search ? { search } : {}),
    ...(term ? { semester: term } : {}),
    sort,
  }).toString();
  const { data, error, setError } = useLoad<{
    rows: Attempt[];
    semesters: { semester: string; year: number }[];
  }>(`/professor/results?${query}`);
  const semesters = useRef<{ semester: string; year: number }[]>([]);
  if (data) semesters.current = data.semesters;
  async function download() {
    setExporting(true);
    setError("");
    try {
      const res = await fetch(`/api/professor/results/export?${query}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("professor-token")}`,
        },
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Export failed.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "quiz-results.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <Back />
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLASSROOM INSIGHTS</p>
          <h1>Results</h1>
        </div>
        <button disabled={exporting || !data} onClick={() => void download()}>
          {exporting ? "Exporting…" : "Export to Excel"}
        </button>
      </div>
      <section className="card filters">
        <label>
          Search student
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={150}
            placeholder="Student name"
          />
        </label>
        <label>
          Semester
          <select value={term} onChange={(e) => setTerm(e.target.value)}>
            <option value="">All Semesters</option>
            {semesters.current.map((s) => (
              <option
                key={`${s.semester}-${s.year}`}
                value={`${s.semester}-${s.year}`}
              >
                {semester(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {[
              ["newest", "Newest First"],
              ["oldest", "Oldest First"],
              ["high", "Score: High to Low"],
              ["low", "Score: Low to High"],
              ["az", "Student Name A-Z"],
              ["za", "Student Name Z-A"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </section>
      <ErrorBox message={error} />
      <section className="card table-wrap">
        {!data ? (
          !error && <p>Loading results…</p>
        ) : !data.rows.length ? (
          <p>No attempts match these filters.</p>
        ) : (
          <table>
            <thead>
              <tr>
                {[
                  "Student",
                  "Semester",
                  "Score",
                  "Percentage",
                  "Date",
                  "Time Used",
                  "Status",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/professor/results/${r.id}`}>
                      {r.studentName}
                    </Link>
                  </td>
                  <td>{semester(r)}</td>
                  <td>
                    {r.score === null ? "—" : `${r.score}/${r.totalTools}`}
                  </td>
                  <td>{r.percentage === null ? "—" : `${r.percentage}%`}</td>
                  <td>{date(r.startedAt)}</td>
                  <td>{duration(r.timeSpentSeconds)}</td>
                  <td>{r.status.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
