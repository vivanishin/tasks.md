# OSL read-only increment

Implements the initial Markdown phase of ADR-001 in
`/mnt/co/notes/planning/osl/adr-001-tasks-md.org`. The full OSL specification is
still a draft. Org conversion, Web state changes and comments remain later
increments.

Use `/mnt/co/notes/planning/osl/README.org` for the schema, Emacs setup,
scoped commits, refresh and deployment procedures. Application source stays here;
canonical tasks stay in `/mnt/co/notes/planning/osl/tasks`, in the notes Git
repository.

The OSL frontend is selected at build time with `VITE_OSL_READ_ONLY=true`.
The backend must start with `OSL_READ_ONLY=true`; it rejects every method
except GET and HEAD before parsing bodies or running upload handlers. Only
`/_api/osl` is available in this mode. Every read scans the canonical files,
including archive, with the same parser as the capture/validation CLI. Invalid
cards remain visible, and duplicate IDs cannot be resolved arbitrarily.
Column order/names, Spaces, capture defaults and the common archive come from
`/tasks/.board.json`; no workflow names are hardcoded. Capture does not require
creation/modification timestamps. Emacs Lisp lives in `~/.emacs.d/lisp/osl.el`
and delegates storage operations to `osl.sh`, whose `config` command returns
the same validated board configuration.
Image cleanup, config creation, filesystem mutation routes and PWA caching
are disabled. The default OSL listener is loopback. Upstream writable mode
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
