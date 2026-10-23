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
the upstream `PATCH /_api/resource/COLUMN/FILE.md` endpoint with only `newPath`
to move a task between configured columns while retaining its filename.
`OSL_HELPER` selects the notes helper; it runs `move osl:ID --to COLUMN`
without a shell. Success means the local commit completed. A separate Push
button calls `POST /_api/osl/push` with `{}` to run `osl.sh push`, publishing
existing commits without staging or committing pending edits.
`GET /_api/osl` includes `git.unpushed`, the outgoing commit count against the
locally tracked upstream, without a fetch. The indicator includes commits made
outside the Web app. Failure to determine status returns `unpushed: null`
and an error; it does not hide the task snapshot. Failed push retains local
commits and the indicator. Errors remain visible across refreshes.
The Web board reuses upstream drag-and-drop for mouse and long-press moves.
It refreshes actual files and Git status after each attempt. Dropping within
the same column preserves the current order.
Every read scans the canonical files,
including archive, with the same parser as the capture/validation CLI. Invalid
cards remain visible, and duplicate IDs cannot be resolved arbitrarily.
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
