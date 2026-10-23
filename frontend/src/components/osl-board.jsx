import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Card } from "./card";
import { DragAndDrop } from "./drag-and-drop";
import { api } from "../api";
import { useI18n } from "../i18n";
import { renderMarkdown, visibleTags, markdownLink, taskFilePath } from "../osl-content.mjs";
import "../stylesheets/index.css";
import "../stylesheets/osl.css";

export default function OslBoard() {
  const [data, setData] = createSignal({ tasks: [], states: [], spaces: [], archiveState: null, issues: [] });
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [moving, setMoving] = createSignal(false);
  const [pushing, setPushing] = createSignal(false);
  const [writeError, setWriteError] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [space, setSpace] = createSignal("");
  const [defaultSpaceInitialized, setDefaultSpaceInitialized] = createSignal(false);
  const [tag, setTag] = createSignal("");
  const [archive, setArchive] = createSignal(false);
  const [showAllTags, setShowAllTags] = createSignal(false);
  const [reference, setReference] = createSignal("");
  const [copyStatus, setCopyStatus] = createSignal("");
  const [refreshed, setRefreshed] = createSignal("");
  const { t, locale } = useI18n();
  const working = () => busy() || moving() || pushing();
  const tasks = () => data().tasks;
  const spaces = createMemo(() => [...new Set([...(data().spaces || []), ...tasks().map((task) => task.space).filter(Boolean)])]);
  const tags = createMemo(() => visibleTags([...new Set(tasks().flatMap((task) => task.tags))], space(), showAllTags()).sort());
  const displayedTags = (task) => visibleTags(task.tags, space(), showAllTags());
  const localTasksDirectory = import.meta.env.VITE_OSL_LOCAL_TASKS_DIR || "/mnt/co/notes/planning/osl/tasks";
  const exact = createMemo(() => /^(?:osl:)?([1-9][0-9]*)$/.exec(search().trim())?.[1] || null);
  const visible = createMemo(() => tasks().filter((task) => {
    if (exact()) return task.id === exact();
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

  async function refresh() {
    if (working()) return;
    setBusy(true);
    try {
      const response = await fetch(`${api}/osl`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.schemaVersion !== 1 || !Array.isArray(result.tasks)) throw new Error("Неподдерживаемый формат ответа");
      setData(result);
      if (!defaultSpaceInitialized()) {
        const defaultSpace = Array.isArray(result.spaces) && result.spaces.includes(result.defaultSpace)
          ? result.defaultSpace : "";
        setSpace(defaultSpace);
        setDefaultSpaceInitialized(true);
      }
      document.title = result.title;
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
      throw new Error(failure.error || `HTTP ${response.status}`);
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
    const column = change.to.slice("lane-content-".length);
    if (!task?.id || task.state === column || working()) {
      // Replace cards to reset upstream drag-and-drop's DOM transforms.
      setData({ ...previous, tasks: previous.tasks.map((task) => ({ ...task })) });
      return;
    }
    const newPath = `${column}/${task.path.split("/").at(-1)}`;
    setWriteError("");
    setMoving(true);
    setData({ ...previous, tasks: previous.tasks.map((item) => item === task
      ? { ...task, state: column, path: newPath } : item) });
    try {
      await writeRequest(`/resource/${task.path.split("/").map(encodeURIComponent).join("/")}`, "PATCH", { newPath });
    } catch (failure) {
      setData(previous);
      setWriteError(`Не удалось завершить перенос: ${failure.message}`);
    } finally {
      setMoving(false);
      await refresh();
    }
  }

  function readHash() {
    try { setReference(decodeURIComponent(window.location.hash.slice(1))); }
    catch { setReference("invalid"); }
    setCopyStatus("");
  }
  function close() { window.location.hash = ""; }
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
    window.addEventListener("focus", refresh);
    const interval = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    onCleanup(() => {
      clearInterval(interval);
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("focus", refresh);
    });
  });

  return <>
    <header class="app-header osl-header">
      <h1>{data().title || "OSL"}</h1>
      <span>Перетаскивайте карточки между колонками</span>
      <input aria-label="Поиск" placeholder="Поиск, номер или osl:1234" value={search()} onInput={(event) => setSearch(event.target.value)} />
      <select aria-label="Space" value={space()} onChange={(event) => {
        setSpace(event.target.value);
        if (tag() && !tags().includes(tag())) setTag("");
      }}>
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
      <small aria-live="polite">{pushing() ? "Push…" : moving() ? "Перенос и коммит…" : busy() ? "Обновление…" : refreshed() && `Обновлено ${refreshed()}`}</small>
    </header>
    <Show when={error()}><p class="osl-alert" role="alert">{error()}</p></Show>
    <Show when={writeError()}><p class="osl-alert" role="alert" style={{ "white-space": "pre-wrap" }}>{writeError()}</p></Show>
    <Show when={selectedError()}><p class="osl-alert" role="alert">{selectedError()} <button type="button" onClick={close}>Закрыть</button></p></Show>
    <Show when={data().issues.length}>
      <details class="osl-validation" open>
        <summary>Ошибки данных: {data().issues.length}</summary>
        <ul><For each={data().issues}>{(issue) => <li>{issue.path}: {issue.message}</li>}</For></ul>
      </details>
    </Show>
    <Show when={exact() && !visible().length}><p class="osl-alert">Задача osl:{exact()} не найдена, включая архив.</p></Show>
    <Show when={!busy() && !tasks().length && !error()}><p class="osl-empty">Задач пока нет. Добавьте первую командой osl.sh capture или M-x osl-capture.</p></Show>
    <DragAndDrop.Provider>
    <main class="lanes osl-lanes" aria-label="Доска OSL" inert={working()}>
      <For each={states()}>{(state) => <section class="lane">
        <header class="lane__header"><h2>{state} <small>({visible().filter((task) => task.state === state).length})</small></h2></header>
        <DragAndDrop.Container class="lane__content" group="cards" id={`lane-content-${state}`} onChange={moveCard}>
          <For each={visible().filter((task) => task.state === state)}>{(task) => <Card
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
    <Show when={selected().length === 1 && reference()} keyed>{() => {
      const task = () => selected()[0];
      return <Portal><dialog class="osl-detail" aria-label="Задача OSL"
        ref={(element) => queueMicrotask(() => { if (element.isConnected && !element.open) element.showModal(); })}
        onCancel={(event) => { event.preventDefault(); close(); }}>
        <header><h2>{task().title}</h2><button type="button" onClick={close}>Закрыть</button></header>
        <p class="osl-task-meta">{[`osl:${task().id}`, task().state, ...displayedTags(task())].join(" · ")}</p>
        <Show when={task().due}><p>Срок / пересмотр: {task().due}</p></Show>
        <Show when={task().errors.length}><p class="osl-alert">{task().errors.join("; ")}</p></Show>
        <div class="osl-copy">
          <button type="button" onClick={() => copy(`osl:${task().id}`)}>Копировать osl:</button>
          <button type="button" onClick={() => copy(orgLink(task()))}>Копировать Org-ссылку</button>
          <button type="button" onClick={() => copy(markdownLink(task()))}>Копировать md-ссылку</button>
          <button type="button" onClick={() => copy(taskFilePath(localTasksDirectory, task()))}>Копировать путь к файлу</button>
          <button type="button" onClick={() => copy(`${window.location.href.split("#")[0]}#osl:${task().id}`)}>Копировать Web-ссылку</button>
          <a class="osl-open-emacs" href={`org-protocol://osl?reference=${encodeURIComponent(`osl:${task().id}`)}`}>Открыть в Emacs</a>
        </div>
        <p role="status">{copyStatus()}</p>
        <div class="osl-body" innerHTML={renderMarkdown(task().body)} />
        <footer><small>{task().path}</small></footer>
      </dialog></Portal>;
    }}</Show>
  </>;
}
