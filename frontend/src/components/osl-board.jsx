import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Card } from "./card";
import { api } from "../api";
import { useI18n } from "../i18n";
import { renderMarkdown, visibleTags } from "../osl-content.mjs";
import "../stylesheets/index.css";
import "../stylesheets/osl.css";

export default function OslBoard() {
  const [data, setData] = createSignal({ tasks: [], states: [], spaces: [], archiveState: null, issues: [] });
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [space, setSpace] = createSignal("");
  const [tag, setTag] = createSignal("");
  const [archive, setArchive] = createSignal(false);
  const [showAllTags, setShowAllTags] = createSignal(false);
  const [reference, setReference] = createSignal("");
  const [copyStatus, setCopyStatus] = createSignal("");
  const [refreshed, setRefreshed] = createSignal("");
  const { t, locale } = useI18n();
  const tasks = () => data().tasks;
  const spaces = createMemo(() => [...new Set([...(data().spaces || []), ...tasks().map((task) => task.space).filter(Boolean)])]);
  const tags = createMemo(() => visibleTags([...new Set(tasks().flatMap((task) => task.tags))], space(), showAllTags()).sort());
  const displayedTags = (task) => visibleTags(task.tags, space(), showAllTags());
  const exact = createMemo(() => /^osl:[1-9][0-9]*$/.test(search().trim()) ? search().trim().slice(4) : null);
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
    if (busy()) return;
    setBusy(true);
    try {
      const response = await fetch(`${api}/osl`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.schemaVersion !== 1 || !Array.isArray(result.tasks)) throw new Error("Неподдерживаемый формат ответа");
      setData(result);
      document.title = result.title;
      setError("");
      setRefreshed(new Date().toLocaleTimeString());
    } catch (failure) {
      setError(`Не удалось обновить доску (${failure.message}). Показан последний полученный снимок.`);
    } finally { setBusy(false); }
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
      <span>Только чтение</span>
      <input aria-label="Поиск" placeholder="Поиск или osl:1234" value={search()} onInput={(event) => setSearch(event.target.value)} />
      <select aria-label="Space" value={space()} onChange={(event) => {
        setSpace(event.target.value);
        if (tag() && !tags().includes(tag())) setTag("");
      }}>
        <option value="">Все Spaces</option><For each={spaces()}>{(value) => <option value={value}>{value}</option>}</For>
      </select>
      <select aria-label="Тег" value={tag()} onChange={(event) => setTag(event.target.value)}>
        <option value="">Все теги</option><For each={tags()}>{(value) => <option value={value}>{value}</option>}</For>
      </select>
      <label class="osl-checkbox"><input type="checkbox" checked={archive()} onChange={(event) => setArchive(event.target.checked)} />Архив</label>
      <label class="osl-checkbox"><input type="checkbox" checked={showAllTags()} onChange={(event) => {
        setShowAllTags(event.target.checked);
        if (tag() && !tags().includes(tag())) setTag("");
      }} />Все лейблы</label>
      <button type="button" onClick={refresh} disabled={busy()}>Обновить</button>
      <small aria-live="polite">{busy() ? "Обновление…" : refreshed() && `Обновлено ${refreshed()}`}</small>
    </header>
    <Show when={error()}><p class="osl-alert" role="alert">{error()}</p></Show>
    <Show when={selectedError()}><p class="osl-alert" role="alert">{selectedError()} <button type="button" onClick={close}>Закрыть</button></p></Show>
    <Show when={data().issues.length}>
      <details class="osl-validation" open>
        <summary>Ошибки данных: {data().issues.length}</summary>
        <ul><For each={data().issues}>{(issue) => <li>{issue.path}: {issue.message}</li>}</For></ul>
      </details>
    </Show>
    <Show when={exact() && !visible().length}><p class="osl-alert">Задача osl:{exact()} не найдена, включая архив.</p></Show>
    <Show when={!busy() && !tasks().length && !error()}><p class="osl-empty">Задач пока нет. Добавьте первую командой osl.sh capture или M-x osl-capture.</p></Show>
    <main class="lanes osl-lanes" aria-label="Доска OSL">
      <For each={states()}>{(state) => <section class="lane">
        <header class="lane__header"><h2>{state} <small>({visible().filter((task) => task.state === state).length})</small></h2></header>
        <div class="lane__content">
          <For each={visible().filter((task) => task.state === state)}>{(task) => <Card
            name={task.path} disableDrag t={t} locale={locale()}
            content={task.body.slice(0, 160)} dueDate={task.due}
            tags={displayedTags(task).map((name) => ({ name, backgroundColor: tagColor(name) }))}
            onClick={() => { if (task.id) window.location.hash = `osl:${task.id}`; else setError(`Нет корректного ID: ${task.path}`); }}
            headerSlot={<div><strong>{task.title}</strong><small class="osl-reference">{task.id ? `osl:${task.id}` : task.path}</small>
              <Show when={task.errors.length}><span class="osl-card-error">⚠ {task.errors.join("; ")}</span></Show></div>}
          />}</For>
        </div>
      </section>}</For>
    </main>
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
          <button type="button" onClick={() => copy(`${window.location.href.split("#")[0]}#osl:${task().id}`)}>Копировать Web-ссылку</button>
        </div>
        <p role="status">{copyStatus()}</p>
        <div class="osl-body" innerHTML={renderMarkdown(task().body)} />
        <footer><small>{task().path}</small></footer>
      </dialog></Portal>;
    }}</Show>
  </>;
}
