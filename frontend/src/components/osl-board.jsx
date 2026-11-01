import { createSignal, createMemo, createEffect, onMount, onCleanup, lazy, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Card } from "./card";
import { oslEditorPlugin } from "../osl-editor.mjs";
import { DragAndDrop } from "./drag-and-drop";
import { api } from "../api";
import { useI18n } from "../i18n";
import { visibleTags, markdownLink, taskFilePath } from "../osl-content.mjs";
import { defaultSpaceFor } from "../osl-default-space.mjs";
import "../stylesheets/index.css";
import "../stylesheets/osl.css";

const ExpandedCard = lazy(() => import("./expanded-card"));

function TaskColumnMenu(props) {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ left: 0, top: 0, height: window.innerHeight - 16 });
  let trigger, menu;
  let focusLast = false;
  const menuId = () => `osl-task-columns-${props.task.id}`;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function show(last = false) {
    if (props.disabled) return;
    focusLast = last;
    setPosition({ left: 0, top: 0, height: window.innerHeight - 16 });
    setOpen(true);
  }

  function place(element) {
    queueMicrotask(() => {
      if (!element.isConnected) return;
      const anchor = trigger.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const below = window.innerHeight - anchor.bottom - 8;
      const above = anchor.top - 8;
      const down = below >= rect.height || below >= above;
      const height = Math.min(rect.height, Math.max(1, down ? below : above));
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8)),
        top: down ? anchor.bottom : Math.max(8, anchor.top - height), height });
      const items = element.querySelectorAll("button");
      focusItem(items[focusLast ? items.length - 1 : 0]);
    });
  }

  function focusItem(item) {
    if (!item) return;
    item.focus({ preventScroll: true });
    if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop;
    if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
  }

  async function choose(column) {
    close(true);
    await props.onMove(column);
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function menuKey(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === "Tab") close(true);
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    focusItem(items[next]);
  }

  createEffect(() => { if (props.disabled) close(); });
  onMount(() => {
    const outside = (event) => { if (!trigger.contains(event.target) && !menu?.contains(event.target)) close(); };
    const scroll = (event) => { if (!menu?.contains(event.target)) close(); };
    const resize = () => close();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    });
  });

  return <span class="osl-column-switch">
    <button type="button" class="osl-column-current" ref={trigger} title="Переместить в другой столбец"
      aria-label={`Столбец: ${props.task.state}. Переместить`} aria-haspopup="menu" aria-expanded={open()}
      aria-controls={menuId()} disabled={props.disabled} onClick={() => open() ? close(true) : show()}
      onKeyDown={(event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); show(event.key === "ArrowUp");
      } }}>{props.task.state}</button>
    <Show when={open()}><span class="osl-column-menu" role="menu" id={menuId()} aria-label="Переместить задачу"
      ref={(element) => { menu = element; place(element); }} onKeyDown={menuKey}
      style={{ left: `${position().left}px`, top: `${position().top}px`, "max-height": `${position().height}px` }}>
      <For each={props.columns.filter((column) => column !== props.task.state)}>{(column) =>
        <button type="button" role="menuitem" onClick={() => choose(column)}>
          {column === props.archiveState ? "В архив" : column}
        </button>
      }</For>
    </span></Show>
  </span>;
}

export default function OslBoard() {
  const [data, setData] = createSignal({ tasks: [], states: [], spaces: [], archiveState: null, issues: [] });
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [moving, setMoving] = createSignal(false);
  const [pushing, setPushing] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [captureColumn, setCaptureColumn] = createSignal("");
  const [captureTitle, setCaptureTitle] = createSignal("");
  const [captureSpace, setCaptureSpace] = createSignal("");
  const [captureError, setCaptureError] = createSignal("");
  const [taskMoveError, setTaskMoveError] = createSignal("");
  const [editing, setEditing] = createSignal(null);
  const [draftTitle, setDraftTitle] = createSignal("");
  const [draftBody, setDraftBody] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [editError, setEditError] = createSignal("");
  let saveTimer, savePromise;
  const [writeError, setWriteError] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [space, setSpace] = createSignal("");
  const [spaceInitialized, setSpaceInitialized] = createSignal(false);
  const [collapsedColumns, setCollapsedColumns] = createSignal([]);
  let spaceParameter;
  const [tag, setTag] = createSignal("");
  const [archive, setArchive] = createSignal(false);
  const [showAllTags, setShowAllTags] = createSignal(false);
  const [reference, setReference] = createSignal("");
  const [copyStatus, setCopyStatus] = createSignal("");
  const [refreshed, setRefreshed] = createSignal("");
  const { t, locale } = useI18n();
  const working = () => busy() || moving() || pushing() || creating() || saving();
  const tasks = () => data().tasks;
  const spaces = createMemo(() => [...new Set([...(data().spaces || []), ...tasks().map((task) => task.space).filter(Boolean)])]);
  const spaceError = createMemo(() => spaceInitialized() && space() && !spaces().includes(space())
    ? `Неизвестный Space «${space()}». Выберите пространство из списка.` : "");
  const tags = createMemo(() => visibleTags([...new Set(tasks().flatMap((task) => task.tags))], space(), showAllTags()).sort());
  const displayedTags = (task) => visibleTags(task.tags, space(), showAllTags());
  const localTasksDirectory = import.meta.env.VITE_OSL_LOCAL_TASKS_DIR || "/mnt/co/notes/planning/osl/tasks";
  const exact = createMemo(() => /^(?:osl:)?([1-9][0-9]*)$/.exec(search().trim())?.[1] || null);
  const visible = createMemo(() => tasks().filter((task) => {
    if (exact()) return task.id === exact();
    if (spaceError()) return false;
    if (task.state === data().archiveState && !archive()) return false;
    if (space() && task.space && data().spaces.includes(task.space) && task.space !== space()) return false;
    if (tag() && !task.tags.includes(tag())) return false;
    const needle = search().trim().toLowerCase();
    return `${task.title}\n${task.body}\n${task.tags.join(" ")}\nosl:${task.id}`.toLowerCase().includes(needle);
  }));
  const states = createMemo(() => [...new Set([...data().states, ...tasks().map((task) => task.state)])]
    .filter((state) => state !== data().archiveState || archive() || visible().some((task) => task.state === state)));
  const selected = createMemo(() => tasks().filter((task) => `osl:${task.id}` === reference()));
  const selectedError = createMemo(() => {
    if (!reference()) return "";
    if (!/^osl:[1-9][0-9]*$/.test(reference())) return "Некорректная ссылка OSL";
    if (selected().length > 1) return `Неоднозначная ссылка ${reference()}: повторяющийся ID`;
    if (!selected().length) return `Задача ${reference()} не найдена`;
    return "";
  });
  createEffect(() => { document.title = `${space() || "Все Spaces"} — ${data().title || "OSL"}`; });
  createEffect(() => {
    if (!spaceInitialized()) return;
    const key = columnPreferencesKey();
    let columns = [];
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(saved)) columns = saved.filter((column) => typeof column === "string");
    } catch {}
    setCollapsedColumns(columns);
  });

  function columnPreferencesKey() {
    return `osl:collapsed-columns:${window.location.pathname}:${space()}`;
  }

  function saveCollapsedColumns(columns) {
    setCollapsedColumns(columns);
    try { localStorage.setItem(columnPreferencesKey(), JSON.stringify(columns)); }
    catch {}
  }

  const isCollapsed = (column) => collapsedColumns().includes(column);
  const columnContentId = (column) => `lane-content-${encodeURIComponent(column)}`;

  function expandColumn(column) {
    if (isCollapsed(column)) saveCollapsedColumns(collapsedColumns().filter((value) => value !== column));
  }

  function toggleColumn(column) {
    if (working()) return;
    if (isCollapsed(column)) expandColumn(column);
    else saveCollapsedColumns([...collapsedColumns(), column]);
  }

  function searchBoard(value) {
    setSearch(value);
    if (exact()) {
      const task = visible()[0];
      if (task) expandColumn(task.state);
    }
  }

  function readSpace() {
    const value = new URLSearchParams(window.location.search).get("space");
    // Card hash navigation must not reapply the starting view rules.
    if (spaceInitialized() && value === spaceParameter) return;
    spaceParameter = value;
    setSpace(value ?? defaultSpaceFor(data().webDefaults));
    if (tag() && !tags().includes(tag())) setTag("");
  }

  function changeSpace(value) {
    const url = new URL(window.location.href);
    url.searchParams.set("space", value);
    if (url.href !== window.location.href) window.history.pushState(window.history.state, "", url);
    readSpace();
  }

  function readLocation() {
    readSpace();
    readHash();
  }

  async function refresh() {
    if (working() || editing()) return;
    setBusy(true);
    try {
      const response = await fetch(`${api}/osl`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.schemaVersion !== 1 || !Array.isArray(result.tasks)) throw new Error("Неподдерживаемый формат ответа");
      setData(result);
      if (!spaceInitialized()) {
        readSpace();
        setSpaceInitialized(true);
      }
      setError("");
      setRefreshed(new Date().toLocaleTimeString());
    } catch (failure) {
      setError(`Не удалось обновить доску (${failure.message}). Показан последний полученный снимок.`);
    } finally { setBusy(false); }
  }

  async function writeRequest(endpoint, method, body) {
    const response = await fetch(`${api}${endpoint}`, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const error = new Error(failure.error || `HTTP ${response.status}`);
      error.task = failure.task;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  function startCapture(column) {
    if (working()) return;
    setCaptureTitle("");
    setCaptureSpace(data().spaces.includes(space()) ? space() : data().defaultSpace);
    setCaptureError("");
    setCaptureColumn(column);
  }

  function cancelCapture() {
    if (!creating()) setCaptureColumn("");
  }

  async function captureTask(event) {
    event.preventDefault();
    if (working() || !captureTitle().trim()) return;
    setCreating(true);
    setCaptureError("");
    setWriteError("");
    let task;
    try {
      task = await writeRequest("/osl/capture", "POST", {
        title: captureTitle().trim(), space: captureSpace(), state: captureColumn(),
      });
    } catch (failure) {
      if (failure.task) {
        task = failure.task;
        setWriteError(`Карточка ${task.reference} создана, но локальный commit не выполнен: ${failure.message}`);
      } else {
        setCaptureError(`Не удалось добавить задачу: ${failure.message}`);
      }
    } finally { setCreating(false); }
    if (task) {
      expandColumn(captureColumn());
      setCaptureColumn("");
      await refresh();
      window.location.hash = task.reference;
    }
  }

  async function pushChanges() {
    if (working()) return;
    setWriteError("");
    setPushing(true);
    try { await writeRequest("/osl/push", "POST", {}); }
    catch (failure) { setWriteError(`Не удалось выполнить push: ${failure.message}`); }
    finally { setPushing(false); await refresh(); }
  }

  async function moveCard(change) {
    const previous = data();
    const task = previous.tasks.find((task) => `card-${task.path}` === change.id);
    const column = decodeURIComponent(change.to.slice("lane-content-".length));
    const columnTasks = visible().filter((item) => item.state === column);
    if (!task?.id || task.errors.length || !previous.states.includes(column) || working()
        || (task.state === column && columnTasks.indexOf(task) === change.index)) {
      // Replace cards to reset upstream drag-and-drop's DOM transforms.
      setData({ ...previous, tasks: previous.tasks.map((task) => ({ ...task })) });
      return;
    }
    const destination = isCollapsed(column) ? [] : columnTasks.filter((item) => item.id !== task.id);
    const before = destination[Math.max(0, change.index)]?.id ?? null;
    await moveTask(task, column, before);
  }

  async function moveSelectedTask(task, column) {
    if (working() || task.errors.length || !data().states.includes(column) || task.state === column) return;
    setTaskMoveError("");
    const failure = await moveTask(task, column);
    if (reference() === `osl:${task.id}`) setTaskMoveError(failure);
  }

  async function moveTask(task, column, before) {
    const previous = data();
    const newPath = `${column}/${task.path.split("/").at(-1)}`;
    let failureMessage = "";
    setWriteError("");
    setMoving(true);
    setData({ ...previous, tasks: previous.tasks.map((item) => item === task
      ? { ...task, state: column, path: newPath } : item) });
    try {
      await writeRequest(`/resource/${task.path.split("/").map(encodeURIComponent).join("/")}`, "PATCH", {
        newPath, ...(before !== undefined ? { before } : {}),
      });
      expandColumn(column);
    } catch (failure) {
      setData(previous);
      failureMessage = `Не удалось завершить перенос osl:${task.id}: ${failure.message}`;
      setWriteError(failureMessage);
    } finally {
      setMoving(false);
      await refresh();
    }
    return failureMessage;
  }

  async function readHash() {
    let next;
    try { next = decodeURIComponent(window.location.hash.slice(1)); }
    catch { next = "invalid"; }
    if (next === reference()) return;
    if (editing() && (saving() || hasDraftChanges())) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${reference()}`);
      if (!await finishEdit()) return;
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${next}`);
    }
    setEditing(null);
    setEditError("");
    setReference(next);
    setCopyStatus("");
    setTaskMoveError("");
  }
  function hasDraftChanges() {
    return editing() && (draftTitle().trim() !== editing().title || draftBody() !== editing().body);
  }
  async function close() {
    if (!await finishEdit()) return;
    window.location.hash = "";
    await refresh();
  }
  function startEdit(task) {
    if (working() || task.errors.length) return;
    setDraftTitle(task.title);
    setDraftBody(task.body);
    setEditError("");
    setEditing({ ...task });
  }
  async function finishEdit() {
    clearTimeout(saveTimer);
    saveTimer = null;
    while (saving() || (hasDraftChanges() && !editError() && draftTitle().trim())) await saveEdit();
    if (hasDraftChanges() && !window.confirm("Автосохранение не завершено. Закрыть без последних правок?")) return false;
    setEditing(null);
    setEditError("");
    return true;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    if (!editError()) saveTimer = setTimeout(saveEdit, 1500);
  }
  function saveEdit() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (savePromise) return savePromise;
    if (!editing() || editError() || !hasDraftChanges() || !draftTitle().trim()) return;
    const task = editing();
    const content = { title: draftTitle().trim(), body: draftBody() };
    setSaving(true);
    savePromise = writeRequest(`/resource/${task.path.split("/").map(encodeURIComponent).join("/")}`, "PATCH", {
      revision: task.revision, ...content,
    }).then((result) => {
      if (!/^[a-f0-9]{64}$/.test(result?.revision)) throw new Error("Нет подтверждения версии файла");
      const saved = { ...task, ...content, revision: result.revision };
      setEditing(saved);
      setData((previous) => ({ ...previous, git: result.git,
        tasks: previous.tasks.map((item) => item.path === task.path ? { ...item, ...saved } : item),
      }));
    }).catch((failure) => {
      setEditError(`Автосохранение остановлено: ${failure.message}. Правки остаются в редакторе.`);
    }).finally(() => {
      savePromise = null;
      setSaving(false);
      if (!saveTimer && !editError() && hasDraftChanges()) saveEdit();
    });
    return savePromise;
  }
  function beforeUnload(event) {
    if (saving() || hasDraftChanges()) { event.preventDefault(); event.returnValue = ""; }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopyStatus("Скопировано"); }
    catch { setCopyStatus(`Буфер обмена недоступен. Скопируйте вручную: ${text}`); }
  }
  function orgLink(task) {
    return `[[osl:${task.id}][${task.title.replaceAll("[", "(").replaceAll("]", ")")}]]`;
  }
  function tagColor(name) {
    let hash = 0;
    for (const char of name) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return `var(--color-alt-${Math.abs(hash % 7) + 1})`;
  }

  onMount(() => {
    readHash();
    refresh();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("popstate", readLocation);
    window.addEventListener("focus", refresh);
    window.addEventListener("beforeunload", beforeUnload);
    const interval = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    onCleanup(() => {
      clearInterval(interval);
      clearTimeout(saveTimer);
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("popstate", readLocation);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("beforeunload", beforeUnload);
    });
  });

  return <>
    <header class="app-header osl-header">
      <h1>{data().title || "OSL"}</h1>
      <input aria-label="Поиск" placeholder="Поиск, номер или osl:1234" value={search()} onInput={(event) => searchBoard(event.target.value)} />
      <select aria-label="Space" value={space()} onChange={(event) => changeSpace(event.target.value)}>
        <Show when={spaceError()}><option value={space()}>{space()} (неизвестный Space)</option></Show>
        <option value="">Все Spaces</option><For each={spaces()}>{(value) => <option value={value}>{value}</option>}</For>
      </select>
      <select aria-label="Лейбл" value={tag()} onChange={(event) => setTag(event.target.value)}>
        <option value="">Все лейблы</option><For each={tags()}>{(value) => <option value={value}>{value}</option>}</For>
      </select>
      <label class="osl-checkbox"><input type="checkbox" checked={archive()} onChange={(event) => setArchive(event.target.checked)} />Архив</label>
      <label class="osl-checkbox"><input type="checkbox" checked={showAllTags()} onChange={(event) => {
        setShowAllTags(event.target.checked);
        if (tag() && !tags().includes(tag())) setTag("");
      }} />Все лейблы</label>
      <button type="button" onClick={refresh} disabled={working()}>Обновить</button>
      <button type="button" onClick={pushChanges} disabled={working() || data().git?.unpushed === 0}
        title="Отправить все неопубликованные коммиты текущей ветки">{pushing() ? "Push…" : "Push"}</button>
      <Show when={data().git?.unpushed > 0}>
        <span class="osl-unpushed" role="status" aria-live="polite">
          <span class="osl-push-light" aria-hidden="true" />Unpushed changes ({data().git.unpushed})
        </span>
      </Show>
      <Show when={data().git?.error}><span title={data().git.error}>Статус Git недоступен</span></Show>
      <small aria-live="polite">{pushing() ? "Push…" : moving() ? "Перенос и коммит…" : creating() ? "Создание…" : busy() ? "Обновление…" : refreshed() && `Обновлено ${refreshed()}`}</small>
    </header>
    <Show when={error()}><p class="osl-alert" role="alert">{error()}</p></Show>
    <Show when={writeError()}><p class="osl-alert" role="alert" style={{ "white-space": "pre-wrap" }}>{writeError()}</p></Show>
    <Show when={spaceError()}><p class="osl-alert" role="alert">{spaceError()}</p></Show>
    <Show when={selectedError()}><p class="osl-alert" role="alert">{selectedError()} <button type="button" onClick={close}>Закрыть</button></p></Show>
    <Show when={data().issues.length}>
      <details class="osl-validation" open>
        <summary>Ошибки данных: {data().issues.length}</summary>
        <ul><For each={data().issues}>{(issue) => <li>{issue.path}: {issue.message}</li>}</For></ul>
      </details>
    </Show>
    <Show when={exact() && !visible().length}><p class="osl-alert">Задача osl:{exact()} не найдена, включая архив.</p></Show>
    <Show when={!busy() && !tasks().length && !error()}><p class="osl-empty">Задач пока нет. Добавьте первую кнопкой «+» у нужного столбца.</p></Show>
    <DragAndDrop.Provider>
    <main class="lanes osl-lanes" aria-label="Доска OSL" inert={working()}>
      <For each={states()}>{(state) => <section class="lane" classList={{ "osl-lane-collapsed": isCollapsed(state) }} aria-label={state}>
        <header class="lane__header">
          <h2><button type="button" class="osl-lane-toggle" aria-expanded={!isCollapsed(state)} aria-controls={columnContentId(state)}
            title={`${isCollapsed(state) ? "Развернуть" : "Свернуть"} столбец ${state}`} onClick={() => toggleColumn(state)} disabled={working()}>
            <span aria-hidden="true">{isCollapsed(state) ? "▸" : "▾"}</span>
            <span class="osl-lane-title">{state} <small>({visible().filter((task) => task.state === state).length})</small></span>
          </button></h2>
          <Show when={data().states.includes(state)}>
            <button type="button" class="small" title="Добавить задачу" aria-label={`Добавить задачу в ${state}`}
              onClick={() => startCapture(state)} disabled={working()}>+</button>
          </Show>
        </header>
        <DragAndDrop.Container class="lane__content" group="cards" id={columnContentId(state)} onChange={moveCard}>
          <For each={isCollapsed(state) ? [] : visible().filter((task) => task.state === state)}>{(task) => <Card
            name={task.path} disableDrag={!task.id || task.errors.length > 0} t={t} locale={locale()}
            content={task.body.slice(0, 160)} dueDate={task.due}
            tags={displayedTags(task).map((name) => ({ name, backgroundColor: tagColor(name) }))}
            onClick={() => { if (task.id) window.location.hash = `osl:${task.id}`; else setError(`Нет корректного ID: ${task.path}`); }}
            headerSlot={<div><strong>{task.title}</strong><small class="osl-reference">{task.id ? `osl:${task.id}` : task.path}</small>
              <Show when={task.errors.length}><span class="osl-card-error">⚠ {task.errors.join("; ")}</span></Show></div>}
          />}</For>
        </DragAndDrop.Container>
      </section>}</For>
    </main>
    <DragAndDrop.Target />
    </DragAndDrop.Provider>
    <Show when={captureColumn()}>
      <Portal><dialog class="osl-detail osl-capture" aria-label="Новая задача"
        ref={(element) => queueMicrotask(() => {
          if (element.isConnected && !element.open) {
            element.showModal();
            element.querySelector("input")?.focus();
          }
        })}
        onCancel={(event) => { event.preventDefault(); cancelCapture(); }}>
        <form onSubmit={captureTask}>
          <h2>Новая задача</h2>
          <p>Столбец: {captureColumn()}</p>
          <label for="osl-capture-title">Название</label>
          <input id="osl-capture-title" type="text" required value={captureTitle()} disabled={creating()}
            onInput={(event) => setCaptureTitle(event.target.value)} />
          <fieldset disabled={creating()}>
            <legend>Space</legend>
            <div class="osl-capture-spaces">
              <For each={data().spaces}>{(value) => <label>
                <input type="radio" name="osl-capture-space" value={value} checked={captureSpace() === value}
                  onChange={() => setCaptureSpace(value)} />
                {value}
              </label>}</For>
            </div>
          </fieldset>
          <Show when={captureError()}><p class="osl-alert" role="alert">{captureError()}</p></Show>
          <div class="osl-capture-actions">
            <button type="submit" disabled={working() || !captureTitle().trim()}>{creating() ? "Добавление…" : "Добавить"}</button>
            <button type="button" onClick={cancelCapture} disabled={creating()}>Отмена</button>
          </div>
        </form>
      </dialog></Portal>
    </Show>
    <Show when={selected().length === 1 && reference()} keyed>{(taskReference) => {
      const task = () => tasks().find((task) => `osl:${task.id}` === taskReference);
      return <Show when={editing() ? "edit" : "read"} keyed>{(mode) => <ExpandedCard
        readOnly={mode === "read"} sourceMode={mode === "edit"} disableImageUpload
        onContentChange={(body) => { setDraftBody(body); scheduleSave(); }}
        dialogLabel="Задача OSL" name={task().title} content={mode === "edit" ? editing()?.body ?? task().body : task().body} onClose={close} t={t}
        tags={[]} tagsOptions={[]}
        editorOptions={{ editorPlugins: [oslEditorPlugin], parserFeatures: { html: false, tagLinks: false } }}
        metadataSlot={<>
        <p class="osl-task-meta">{`osl:${task().id} · `}<TaskColumnMenu task={task()} columns={data().states}
          archiveState={data().archiveState} disabled={working() || Boolean(editing()) || task().errors.length > 0}
          onMove={(column) => moveSelectedTask(task(), column)} />
          <For each={displayedTags(task())}>{(tag) => <span>{` · ${tag}`}</span>}</For>
        </p>
        <Show when={task().due}><p>Срок / пересмотр: {task().due}</p></Show>
        <Show when={task().errors.length}><p class="osl-alert">{task().errors.join("; ")}</p></Show>
        <Show when={taskMoveError()}><p class="osl-alert osl-task-move-error" role="alert" style={{ "white-space": "pre-wrap" }}>{taskMoveError()}</p></Show>
        <Show when={mode === "edit"}>
          <label>Название<input aria-label="Название карточки" value={draftTitle()}
            onInput={(event) => { setDraftTitle(event.target.value); scheduleSave(); }} /></label>
          <p class="osl-autosave-status" role="status" aria-live="polite">{editError() ? "Автосохранение остановлено"
            : !draftTitle().trim() ? "Введите название карточки" : saving() ? "Сохраняется…"
            : hasDraftChanges() ? "Изменения ожидают сохранения…" : "Сохранено"}</p>
        </Show>
        <Show when={editError()}><p class="osl-alert" role="alert" style={{ "white-space": "pre-wrap" }}>{editError()}</p></Show>
        <div class="osl-copy">
          <Show when={mode === "read"} fallback={<>
            <button type="button" onClick={async () => { if (await finishEdit()) await refresh(); }}>Готово</button>
            <Show when={editError()}><button type="button" onClick={() => { setEditError(""); saveEdit(); }}>Повторить</button></Show>
          </>}>
            <button type="button" onClick={() => startEdit(task())} disabled={working() || task().errors.length > 0}>Редактировать</button>
          </Show>
          <button type="button" onClick={() => copy(`osl:${task().id}`)}>Копировать osl:</button>
          <button type="button" onClick={() => copy(orgLink(task()))}>Копировать Org-ссылку</button>
          <button type="button" onClick={() => copy(markdownLink(task()))}>Копировать md-ссылку</button>
          <button type="button" onClick={() => copy(taskFilePath(localTasksDirectory, task()))}>Копировать путь к файлу</button>
          <button type="button" onClick={() => copy(`${window.location.href.split("#")[0]}#osl:${task().id}`)}>Копировать Web-ссылку</button>
          <a class="osl-open-emacs" href={`org-protocol://osl?reference=${encodeURIComponent(`osl:${task().id}`)}`}>Открыть в Emacs</a>
        </div>
        <p role="status">{copyStatus()}</p>
        </>}
        footerSlot={<footer><small>{task().path}</small></footer>}
      />}</Show>;
    }}</Show>
  </>;
}
