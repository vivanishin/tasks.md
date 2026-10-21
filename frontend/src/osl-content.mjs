import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

const markdown = new MarkdownIt({ html: false, linkify: true }).use(taskLists);
markdown.block.ruler.before("html_block", "details", (state, startLine, endLine, silent) => {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trimEnd();
  const summary = /^<summary>(.*?)<\/summary>$/.exec(line);
  if (line !== "<details>" && line !== "</details>" && !summary) return false;
  if (silent) return true;
  const token = state.push("html_block", "", 0);
  token.block = true;
  token.map = [startLine, startLine + 1];
  token.content = summary ? `<summary>${markdown.utils.escapeHtml(summary[1])}</summary>\n` : `${line}\n`;
  state.line = startLine + 1;
  return true;
}, { alt: ["paragraph", "reference", "blockquote"] });
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
