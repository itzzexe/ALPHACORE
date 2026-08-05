# QA report

Pipeline: Feature build — Frame → Design → Build → Verify
Goal: A tiny Node.js CLI tool "todo.js" (single file, zero dependencies) supporting: node todo.js add "text" / node todo.js list / node todo.js done <number>. Todos persist in todos.json next to the script. Also produce a brief README.md. Keep it minimal and correct.
Agent: AGT-QA-001 · Run: c9131dc3-9a1e-4ab2-b775-76ad728be9f7

---

{
  "report": [
    {
      "criterion": "Single file named todo.js with zero external dependencies",
      "status": "pass",
      "evidence": "Review info finding confirms: 'zero dependencies, single file' and 'No require of third-party modules'."
    },
    {
      "criterion": "`node todo.js add \"text\"` adds a persisted todo",
      "status": "pass",
      "evidence": "Review info finding confirms cmdAdd trims input and rejects blank text; DATA_FILE = path.join(__dirname,'todos.json') ensures CWD-independent persistence."
    },
    {
      "criterion": "`node todo.js list` displays all todos with status indicators",
      "status": "pass",
      "evidence": "Review info finding confirms cmdList numbers todos 1-based with [ ]/[x] markers. Normal operation functions correctly."
    },
    {
      "criterion": "`node todo.js done <number>` marks the specified todo complete",
      "status": "pass",
      "evidence": "Review info finding confirms cmdDone validates 1-based bounds, distinguishes done vs already-done, exits 0 on success and 1 on error."
    },
    {
      "criterion": "Todos persist in todos.json adjacent to the script (not CWD-relative)",
      "status": "pass",
      "evidence": "Review info finding confirms path.join(__dirname,'todos.json') is used, making the location script-relative, not process-CWD-relative."
    },
    {
      "criterion": "Invalid or out-of-range input produces an error on stderr and exits non-zero",
      "status": "pass",
      "evidence": "Review info finding confirms 'errors->stderr+exit 1'; low finding confirms integer/bounds validation is sound for done command."
    },
    {
      "criterion": "Persistence is robust: a corrupt todos.json does not crash every subsequent command with a raw stack trace",
      "status": "fail",
      "evidence": "Medium severity finding: load() catches only ENOENT and re-throws all other errors, so a non-empty malformed todos.json causes an uncaught SyntaxError from JSON.parse on every invocation of add, list, and done — including the pure-read list path. No recovery path exists. The goal states the tool must be 'correct'; crashing on its own data file with an unhandled exception fails that bar."
    },
    {
      "criterion": "README.md is present and documents add/list/done usage",
      "status": "pass",
      "evidence": "Review info finding confirms README covers add/list/done commands, Node-only requirement, and todos.json location."
    },
    {
      "criterion": "done <number> error message is sensible when the list is empty",
      "status": "fail",
      "evidence": "Low severity finding: cmdDone loads todos before checking operand validity and builds its range message from todos.length, producing the nonsensical message 'a valid todo number between 1 and 0' against an empty list. Functionally exits 1 without mutating state, but the error output is incorrect."
    }
  ],
  "verdict": "red"
}