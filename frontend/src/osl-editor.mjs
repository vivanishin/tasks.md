// Extend Stacks Editor's parser and document schema; rendering stays in the editor.
export function oslEditorPlugin() {
  return {
    extendSchema(schema) {
      return { ...schema, nodes: schema.nodes.append({
        osl_details: {
          group: "block", content: "block*", defining: true,
          parseDOM: [{ tag: "details" }], toDOM: () => ["details", 0],
        },
        osl_summary: {
          group: "block", content: "inline*", defining: true,
          parseDOM: [{ tag: "summary" }], toDOM: () => ["summary", 0],
        },
      }) };
    },
    markdown: {
      parser: { osl_details: { block: "osl_details" }, osl_summary: { block: "osl_summary" } },
      serializers: { nodes: {
        osl_details(state, node) {
          state.write("<details>\n"); state.renderContent(node);
          state.write("</details>"); state.closeBlock(node);
        },
        osl_summary(state, node) {
          state.write("<summary>"); state.renderInline(node);
          state.write("</summary>"); state.closeBlock(node);
        },
      }, marks: {} },
      alterMarkdownIt(markdown) {
        const validateLink = markdown.validateLink;
        markdown.validateLink = (href) => /^#?osl:[1-9][0-9]*$/.test(href) || !href.includes(":") || validateLink(href);
        markdown.linkify.add("osl:", {
          validate(text, position) {
            return /^[1-9][0-9]*(?![\w-])\b/.exec(text.slice(position))?.[0].length || 0;
          },
          normalize(match) { match.url = `#${match.raw}`; },
        });
        markdown.block.ruler.before("html_block", "osl_details", (state, startLine, endLine, silent) => {
          if (state.sCount[startLine] - state.blkIndent >= 4) return false;
          const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trimEnd();
          const summary = /^<summary>(.*?)<\/summary>$/.exec(line);
          const marker = /^<!-- kaiten-transfer-id:[1-9][0-9]* source-sha256:[a-f0-9]{64} -->$/.test(line);
          if (line !== "<details>" && line !== "</details>" && !summary && !marker) return false;
          if (silent) return true;
          if (summary) {
            state.push("osl_summary_open", "summary", 1);
            const inline = state.push("inline", "", 0);
            inline.content = "";
            const text = new state.Token("text", "", 0);
            text.content = summary[1];
            inline.children = [text];
            state.push("osl_summary_close", "summary", -1);
          } else if (!marker) {
            const open = line === "<details>";
            state.push(`osl_details_${open ? "open" : "close"}`, "details", open ? 1 : -1);
          }
          state.line = startLine + 1;
          return true;
        }, { alt: ["paragraph", "reference", "blockquote"] });
        markdown.core.ruler.after("linkify", "osl_links", (state) => {
          for (const token of state.tokens.flatMap((token) => token.children || [])) {
            if (token.type === "link_open" && /^osl:[1-9][0-9]*$/.test(token.attrGet("href")))
              token.attrSet("href", `#${token.attrGet("href")}`);
          }
        });
        // The fork's checkbox pass misses nested lists and leaves markers in inline text.
        markdown.core.ruler.after("checkbox", "osl_checklists", (state) => {
          for (let index = 0; index < state.tokens.length; index++) {
            const token = state.tokens[index];
            if (token.type !== "list_item_open") continue;
            const inline = state.tokens[index + 2];
            const match = inline?.type === "inline" && /^\[([ xX])\] /.exec(inline.content);
            token.attrSet("text", null);
            token.attrSet("checkbox", match ? "true" : null);
            token.attrSet("checked", match && match[1] !== " " ? "true" : null);
            if (match) {
              inline.content = inline.content.slice(4);
              if (inline.children[0]?.type === "text") inline.children[0].content = inline.children[0].content.slice(4);
            }
          }
        });
      },
    },
  };
}
