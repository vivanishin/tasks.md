// Extend Stacks Editor's parser; reuse its document nodes and rendering.
export function oslEditorPlugin() {
  return {
    markdown: {
      alterMarkdownIt(markdown) {
        const validateLink = markdown.validateLink;
        markdown.validateLink = (href) => /^#?osl:[1-9][0-9]*$/.test(href) || !href.includes(":") || validateLink(href);
        const normalizeLink = markdown.normalizeLink;
        markdown.normalizeLink = (href) => /^osl:[1-9][0-9]*$/.test(href) ? `#${href}` : normalizeLink(href);
        markdown.linkify.add("osl:", {
          validate(text, position) {
            return /^[1-9][0-9]*(?![\w-])\b/.exec(text.slice(position))?.[0].length || 0;
          },
          normalize(match) { match.url = `#${match.raw}`; },
        });
        markdown.block.ruler.before("html_block", "osl_details", (state, startLine, endLine, silent) => {
          if (state.sCount[startLine] - state.blkIndent >= 4) return false;
          const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trimEnd();
          const marker = /^<!-- kaiten-transfer-id:[1-9][0-9]* source-sha256:[a-f0-9]{64} -->$/.test(line);
          if (line !== "<details>" && line !== "</details>" && !marker) return false;
          if (silent) return true;
          state.line = startLine + 1;
          if (!marker) {
            const open = line === "<details>";
            if (!open && state.tokens.at(-1)?.type === "html_block_container_open") {
              state.push("paragraph_open", "p", 1);
              state.push("paragraph_close", "p", -1);
            }
            const token = state.push(`html_block_container_${open ? "open" : "close"}`, "", open ? 1 : -1);
            if (open) {
              const next = state.getLines(startLine + 1, startLine + 2, state.blkIndent, false).trim();
              const summary = /^<summary>(.*?)<\/summary>$/.exec(next);
              token.attrSet("contentOpen", summary
                ? `<details><summary>${markdown.utils.escapeHtml(summary[1])}</summary>` : "<details>");
              token.attrSet("contentClose", "</details>");
              if (summary) state.line++;
            }
          }
          return true;
        }, { alt: ["paragraph", "reference", "blockquote"] });
      },
    },
  };
}
