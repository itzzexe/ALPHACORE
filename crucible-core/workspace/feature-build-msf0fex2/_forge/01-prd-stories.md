# PRD & stories

Pipeline: Feature build — Frame → Design → Build → Verify
Goal: A tiny Node.js CLI tool "todo.js" (single file, zero dependencies) supporting: node todo.js add "text" / node todo.js list / node todo.js done <number>. Todos persist in todos.json next to the script. Also produce a brief README.md. Keep it minimal and correct.
Agent: AGT-PM-001 · Run: 40ae30df-d88c-4b5a-aa4e-7ce0a8a51acb

---

{
  "artifact": "# PRD: todo.js CLI Tool\n\n## Overview\nA single-file, zero-dependency Node.js CLI that lets users manage a todo list from the terminal. Todos persist in `todos.json` in the same directory as the script.\n\n## Goals\n- Minimal footprint: one file (`todo.js`), one data file (`todos.json`), no npm install\n- Three commands cover the full lifecycle: add, list, done\n- Correct behavior on edge cases (missing file, invalid index, empty list)\n\n## MVP Boundary\n- Commands: `add`, `list`, `done <number>`\n- Persistence: `todos.json` (array of `{text: string, done: boolean}`)\n- Output: plain text to stdout\n- Error output: stderr, non-zero exit code\n- Accompanies: `README.md` (usage only)\n\n## Non-Goals (Out of Scope for MVP)\n- Edit, delete, or reorder todos\n- Priority, due dates, tags, or categories\n- Multiple lists or named lists\n- Remote sync or cloud persistence\n- Interactive TUI or prompts\n- Color/formatting libraries\n- Tests or CI configuration",
  "stories": [
    {
      "id": "US-01",
      "title": "Add a todo",
      "role": "CLI user",
      "goal": "add a new todo item",
      "benefit": "so that I can track a task I need to complete",
      "acceptance": [
        {
          "given": "the user runs `node todo.js add \"Buy milk\"`",
          "when": "the command executes successfully",
          "then": "a new entry `{text: 'Buy milk', done: false}` is appended to todos.json and stdout prints 'Added: Buy milk'"
        },
        {
          "given": "todos.json does not exist yet",
          "when": "the user runs `node todo.js add \"First task\"`",
          "then": "todos.json is created with the single entry and the item is confirmed on stdout"
        },
        {
          "given": "the user runs `node todo.js add` with no text argument",
          "when": "the command executes",
          "then": "stderr prints a usage error and the process exits with code 1"
        }
      ]
    },
    {
      "id": "US-02",
      "title": "List all todos",
      "role": "CLI user",
      "goal": "see all current todos with their status and 1-based index",
      "benefit": "so that I know what tasks exist and which are done",
      "acceptance": [
        {
          "given": "todos.json contains three items (two pending, one done)",
          "when": "the user runs `node todo.js list`",
          "then": "stdout prints each item as `<index>. [ ] text` for pending and `<index>. [x] text` for done, one per line"
        },
        {
          "given": "todos.json is empty or does not exist",
          "when": "the user runs `node todo.js list`",
          "then": "stdout prints 'No todos yet.' and exits with code 0"
        }
      ]
    },
    {
      "id": "US-03",
      "title": "Mark a todo done",
      "role": "CLI user",
      "goal": "mark a specific todo as complete by its list number",
      "benefit": "so that I can track progress without deleting the record",
      "acceptance": [
        {
          "given": "todos.json has 3 items and item 2 is not done",
          "when": "the user runs `node todo.js done 2`",
          "then": "item at index 2 has its `done` field set to true in todos.json and stdout prints 'Done: <text of item 2>'"
        },
        {
          "given": "todos.json has 3 items and item 2 is already done",
          "when": "the user runs `node todo.js done 2`",
          "then": "the item remains done, stdout prints 'Already done: <text of item 2>'"
        },
        {
          "given": "the user runs `node todo.js done 99` and there are fewer than 99 items",
          "when": "the command executes",
          "then": "stderr prints 'Invalid number: 99' and the process exits with code 1"
        },
        {
          "given": "the user runs `node todo.js done` with no number",
          "when": "the command executes",
          "then": "stderr prints a usage error and the process exits with code 1"
        }
      ]
    },
    {
      "id": "US-04",
      "title": "README documents usage",
      "role": "new user",
      "goal": "understand all commands without reading source code",
      "benefit": "so that I can start using the tool immediately",
      "acceptance": [
        {
          "given": "the README.md file is present",
          "when": "a user reads it",
          "then": "it covers installation (none required beyond Node.js), all three commands with example invocations, and the todos.json persistence location"
        },
        {
          "given": "the README.md file is present",
          "when": "a user reads it",
          "then": "it contains no references to features outside the MVP boundary"
        }
      ]
    }
  ],
  "outOfScope": [
    "Edit or update existing todo text",
    "Delete individual todos",
    "Reorder or prioritize todos",
    "Due dates, tags, or categories",
    "Named or multiple lists",
    "Color output or formatting libraries",
    "Remote sync or database storage",
    "Interactive mode or prompts",
    "Automated tests or CI config",
    "Any npm dependency"
  ],
  "confidence": 0.97
}