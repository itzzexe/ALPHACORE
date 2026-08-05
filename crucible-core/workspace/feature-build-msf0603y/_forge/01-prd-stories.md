# PRD & stories

Pipeline: Feature build — Frame → Design → Build → Verify
Goal: A tiny Node.js CLI tool "todo.js" (single file, zero dependencies) supporting: node todo.js add "text" / node todo.js list / node todo.js done <number>. Todos persist in todos.json next to the script. Also produce a brief README.md. Keep it minimal and correct.
Agent: AGT-PM-001 · Run: ac0ffb33-3448-4511-89bc-377a6ba664cd

---

{
  "artifact": "# PRD: todo.js — Minimal Node.js CLI Todo Tool\n\n## Goal\nA single-file, zero-dependency Node.js CLI that lets a user add, list, and mark todos as done, with persistence via a local JSON file.\n\n## Constraints\n- Single file: `todo.js`\n- No npm dependencies (Node.js stdlib only)\n- Persistence: `todos.json` stored adjacent to `todo.js`\n- Runtime: Node.js >=18\n- Deliverables: `todo.js` + `README.md`\n\n## Commands (MVP boundary)\n| Command | Syntax | Behavior |\n|---|---|---|\n| add | `node todo.js add \"text\"` | Appends a new incomplete todo |\n| list | `node todo.js list` | Prints all todos with 1-based index and status |\n| done | `node todo.js done <number>` | Marks todo at given index as done |\n\n## Data Model\n`todos.json`: JSON array of `{ text: string, done: boolean }` objects.\nFile is created on first `add` if absent.\n\n## Error Handling (MVP)\n- Unknown command → print usage, exit 1\n- `done` with no/invalid number → print error, exit 1\n- `done` with out-of-range index → print error, exit 1\n- Missing/corrupt `todos.json` on `list` or `done` → treat as empty list or print error, exit 1\n\n## Out of Scope\n- Delete / edit commands\n- Due dates, priorities, tags\n- Colors / interactive TUI\n- Tests\n- npm publish / package.json\n- Global install (`chmod +x` / shebang)\n- Multiple todo files",
  "stories": [
    {
      "id": "S-01",
      "title": "Add a todo",
      "story": "As a user, I want to add a todo item from the command line so that it is saved for later.",
      "acceptance": [
        "GIVEN todos.json does not exist WHEN I run `node todo.js add \"Buy milk\"` THEN todos.json is created containing [{\"text\":\"Buy milk\",\"done\":false}] and stdout prints 'Added: Buy milk'",
        "GIVEN todos.json already has one item WHEN I run `node todo.js add \"Walk dog\"` THEN todos.json contains both items in order and stdout prints 'Added: Walk dog'",
        "GIVEN I run `node todo.js add` with no text argument THEN stderr prints a usage hint and the process exits with code 1"
      ]
    },
    {
      "id": "S-02",
      "title": "List todos",
      "story": "As a user, I want to list all todos with their index and status so that I know what remains to do.",
      "acceptance": [
        "GIVEN todos.json has [{\"text\":\"Buy milk\",\"done\":false},{\"text\":\"Walk dog\",\"done\":true}] WHEN I run `node todo.js list` THEN stdout prints:\n  1. [ ] Buy milk\n  2. [x] Walk dog",
        "GIVEN todos.json does not exist or is empty WHEN I run `node todo.js list` THEN stdout prints 'No todos yet.' and exits 0",
        "GIVEN todos.json contains invalid JSON WHEN I run `node todo.js list` THEN stderr prints an error message and the process exits with code 1"
      ]
    },
    {
      "id": "S-03",
      "title": "Mark a todo done",
      "story": "As a user, I want to mark a todo as done by its list number so that I can track completion.",
      "acceptance": [
        "GIVEN todos.json has two items WHEN I run `node todo.js done 1` THEN the first item's done field is set to true, todos.json is updated, and stdout prints 'Done: Buy milk'",
        "GIVEN todos.json has two items WHEN I run `node todo.js done 2` THEN only the second item is marked done",
        "GIVEN I run `node todo.js done 0` or `node todo.js done 99` (out of range) THEN stderr prints 'Invalid todo number.' and exits 1",
        "GIVEN I run `node todo.js done` with no number THEN stderr prints a usage hint and exits 1",
        "GIVEN an item is already marked done WHEN I run `node todo.js done <n>` for that item THEN it remains done and stdout confirms it"
      ]
    },
    {
      "id": "S-04",
      "title": "Unknown command",
      "story": "As a user, if I mistype a command I want a clear usage message so I know what commands are valid.",
      "acceptance": [
        "GIVEN I run `node todo.js remove 1` THEN stderr prints usage listing add/list/done and the process exits with code 1"
      ]
    },
    {
      "id": "S-05",
      "title": "README",
      "story": "As a developer, I want a README.md so I can understand how to use the tool without reading source.",
      "acceptance": [
        "GIVEN the repo root WHEN I read README.md THEN it documents: prerequisites (Node.js >=18), all three commands with example invocations, and the todos.json persistence note — in under 40 lines"
      ]
    }
  ],
  "outOfScope": [
    "Delete or edit commands",
    "Due dates, priorities, or tags",
    "Color output or interactive TUI",
    "Automated tests",
    "package.json / npm publish",
    "Global CLI install (shebang / chmod +x)",
    "Multiple or named todo files",
    "Undo / redo",
    "Search / filter"
  ],
  "confidence": 0.97
}