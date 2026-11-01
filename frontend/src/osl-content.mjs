export function visibleTags(tags, space, showAll) {
  return showAll ? tags : tags.filter((tag) => tag !== `space::${space}`
    && tag !== "kaiten" && !tag.startsWith("source:"));
}

export function markdownLink(task) {
  const title = task.title.replaceAll("\\", "\\\\").replace(/[\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
  return `[${title}](osl:${task.id})`;
}

export function taskFilePath(directory, task) {
  return `${directory.replace(/\/$/, "")}/${task.path}`;
}
