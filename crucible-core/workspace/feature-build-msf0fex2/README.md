# todo.js

A tiny command-line todo list. Single file, **zero dependencies** — requires only Node.js.

## Requirements

- Node.js (any reasonably recent version). Nothing to install — no `npm install`, no packages.

## Usage

```sh
node todo.js add "buy milk"    # add a todo
node todo.js list              # list all todos
node todo.js done 1            # mark todo number 1 as done
```

### Commands

- `add "text"` — append a new todo. Multiple words are fine; quote them so the shell passes one argument.
- `list` — print every todo, numbered (1-based), with `[ ]` for pending and `[x]` for done.
- `done <number>` — mark the todo at that number as done. Numbers come from `list`. Marking an already-done item reports `Already done: ...` and changes nothing.

## Example

```sh
$ node todo.js add "write README"
Added: write README
$ node todo.js add "ship it"
Added: ship it
$ node todo.js list
1. [ ] write README
2. [ ] ship it
$ node todo.js done 1
Done: write README
$ node todo.js list
1. [x] write README
2. [ ] ship it
```

## Data storage

Todos are stored as plain JSON in `todos.json`, located **next to `todo.js`** (not in your current directory). This means the same list is used no matter where you run the command from. The file is human-readable and safe to view, edit, back up, or track in git. It is created automatically the first time you add a todo.

## Exit codes

- `0` on success.
- `1` on error (missing text for `add`, missing/invalid number for `done`, or an unknown command). Errors are printed to stderr.
