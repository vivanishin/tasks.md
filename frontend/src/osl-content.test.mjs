import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./osl-content.mjs";

test("task bodies render Markdown, nested checklists and fenced code", () => {
  const html = renderMarkdown("## Heading\n\n- [ ] Open\n  - [x] Done\n\n```sh\necho '<ok>'\n```\n\n**bold** and `code`");
  assert.match(html, /<h2>Heading<\/h2>/);
  assert.match(html, /<ul class="contains-task-list">/);
  assert.match(html, /<input[^>]*disabled=""[^>]*type="checkbox"/);
  assert.match(html, /checked=""/);
  assert.match(html, /<pre><code class="language-sh">echo '&lt;ok&gt;'/);
  assert.match(html, /<strong>bold<\/strong> and <code>code<\/code>/);
});

test("explicit and bare OSL links navigate within the board, code remains literal", () => {
  const html = renderMarkdown("[Task](osl:280), osl:123 and https://example.org/\n\n`osl:1`\n\n```\nosl:2\n```");
  assert.match(html, /href="#osl:280">Task/);
  assert.match(html, /href="#osl:123">osl:123/);
  assert.match(html, /href="https:\/\/example.org\/"/);
  assert.match(html, /<code>osl:1<\/code>/);
  assert.doesNotMatch(html, /href="#osl:[12]"/);
  assert.doesNotMatch(renderMarkdown("osl:01 osl:1abc osl:1-abc"), /href=/);
});

test("source HTML and executable link targets cannot execute", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(1))\n\n[bad](data:text/html,test)');
  assert.doesNotMatch(html, /<script|<img|href="(?:javascript|data):/i);
  assert.match(html, /&lt;script&gt;/);
});

test("details fold Markdown and preserve code without enabling arbitrary HTML", () => {
  const html = renderMarkdown('<details>\n<summary>Original exported record</summary>\n\n```json\n{"text":"</details><script>alert(1)</script>"}\n```\n\n</details>');
  assert.match(html, /^<details>\n<summary>Original exported record<\/summary>\n<pre><code class="language-json">/);
  assert.match(html, /&lt;\/details&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<\/code><\/pre>\n<\/details>\n$/);
  assert.doesNotMatch(html, /<script>/);
  const unsafe = renderMarkdown('<details ontoggle="alert(1)" open>\n<summary><img src=x onerror=alert(1)></summary>\n\nText\n\n</details>');
  assert.doesNotMatch(unsafe, /<details[^>]+>|<img/);
  assert.match(unsafe, /&lt;details ontoggle=/);
  assert.match(unsafe, /<summary>&lt;img/);
  assert.match(renderMarkdown('```html\n<details>\n<summary>Literal</summary>\n</details>\n```'), /&lt;details&gt;/);
  assert.match(renderMarkdown('    <details>\n'), /<pre><code>&lt;details&gt;/);
});
