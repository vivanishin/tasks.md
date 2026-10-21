import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

const markdown = new MarkdownIt({ html: false, linkify: true }).use(taskLists);
markdown.linkify.add("osl:", {
  validate(text, position) {
    return /^[1-9][0-9]*(?![\w-])\b/.exec(text.slice(position))?.[0].length || 0;
  },
  normalize(match) { match.url = `#${match.raw}`; },
});
const linkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const href = token.attrGet("href");
  if (/^osl:[1-9][0-9]*$/.test(href)) token.attrSet("href", `#${href}`);
  return linkOpen(tokens, index, options, env, renderer);
};

export function renderMarkdown(body) {
  return markdown.render((body || "").replace(/^<!-- kaiten-transfer-id:[1-9][0-9]* source-sha256:[a-f0-9]{64} -->\r?\n?/gm, ""));
}
