# OSL increment

Implements the initial Markdown phase of ADR-001 in
`/mnt/co/notes/planning/osl/adr-001-tasks-md.org`. The full OSL specification is
still a draft. Org conversion and comments remain later increments.

Use `/mnt/co/notes/planning/osl/README.org` for the schema, Emacs setup,
scoped commits, refresh and deployment procedures. Application source stays here;
canonical tasks stay in `/mnt/co/notes/planning/osl/tasks`, in the notes Git
repository.

The OSL frontend is selected at build time with `VITE_OSL_READ_ONLY=true`.
The backend starts with `OSL_READ_ONLY=true`. This restricted mode also permits
the upstream `PATCH /_api/resource/COLUMN/FILE.md` endpoint with `newPath`
and optional `before` (a string ID, or `null` for the end) to move or reorder
a task while retaining its filename.
`OSL_HELPER` selects the notes helper; it runs `move osl:ID --to COLUMN`
with optional `--before ID` or `--last`, without a shell. Success means the
local commit completed. A separate Push
button calls `POST /_api/osl/push` with `{}` to run `osl.sh push`, publishing
existing commits without staging or committing pending edits.
`GET /_api/osl` includes `git.unpushed`, the outgoing commit count against the
locally tracked upstream, without a fetch. The indicator includes commits made
outside the Web app. Failure to determine status returns `unpushed: null`
and an error; it does not hide the task snapshot. Failed push retains local
commits and the indicator. Errors remain visible across refreshes.
The Web board reuses upstream drag-and-drop for mouse and long-press moves.
It refreshes actual files and Git status after each attempt. Dropping within
or between columns saves the chosen position in the optional task-store
`.order.json`, mapping columns to arrays of string IDs. Listed cards come
first; unlisted cards follow in filename order. Stale IDs are ignored and
invalid order data is reported. Order is shared by all Spaces; hidden cards
retain their relative order. A drop at the same visible position is a no-op.
Moves serialize via `.move-lock` and refuse to overwrite pending order edits.
Every read scans the canonical files,
including archive, with the same parser as the capture/validation CLI. Invalid
cards remain visible, and duplicate IDs cannot be resolved arbitrarily.
The card dialog offers Edit and Done. Changes autosave after 1.5 seconds
without input; Done also flushes pending changes. Editing uses Stacks
Editor's Markdown view to preserve comments, folded sections and literal OSL links.
Saving uses the same PATCH endpoint with `title`, `body` and the snapshot's
`revision`; `osl.sh edit` checks that the path and content still match,
refuses pending edits to that card, and commits only its file. Metadata above
the title is retained verbatim. The response confirms the written revision
and Git status. One request runs at a time; further input replaces the
waiting text and remains editable. Repeated saves use the helper's commit
batching. Edits share `.move-lock` with moves and Push. Conflicts and failed
requests pause autosave and retain the draft; Retry resumes it. Closing
flushes pending edits and asks before discarding a failed save. If committing
fails after the write, the file remains for a manual commit. Push remains separate.
Column order/names, Spaces, capture defaults and the common archive come from
`/tasks/.board.json`; no workflow names are hardcoded. Capture does not require
creation/modification timestamps. Emacs Lisp lives in `~/.emacs.d/lisp/osl.el`
and delegates storage operations to `osl.sh`, whose `config` command returns
the same validated board configuration.
Image cleanup, config creation, other write operations and PWA caching
remain disabled. The default OSL listener is loopback. Upstream writable mode
remains available for upstream use; do not use it to serve OSL data.

Tests (Node.js 22):

```sh
OSL_HELPER=/mnt/co/notes/planning/osl/osl.sh node --test backend/osl.test.js
```

An OSL build needs no Stacks-Editor submodule. The optional container build is
`docker build -f Dockerfile.osl -t osl .`; expose it only through a loopback
published port or an isolated reverse-proxy network and mount `/tasks` read-only.
The container and mTLS proxy configuration need validation on the chosen server
before remote deployment.
