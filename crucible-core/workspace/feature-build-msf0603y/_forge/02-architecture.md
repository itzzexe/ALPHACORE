# Architecture

Pipeline: Feature build — Frame → Design → Build → Verify
Goal: A tiny Node.js CLI tool "todo.js" (single file, zero dependencies) supporting: node todo.js add "text" / node todo.js list / node todo.js done <number>. Todos persist in todos.json next to the script. Also produce a brief README.md. Keep it minimal and correct.
Agent: AGT-ARC-001 · Run: d8cdfd6d-ebc0-454b-b3ca-32cb8aaca5dc

---

{
  "adr": {
    "decision": "Single-file Node.js CLI (todo.js) organized as four in-file layers, zero runtime dependencies (Node >=18 stdlib only). LAYER 1 — Config: DATA_FILE = path.join(__dirname, 'todos.json') (script-adjacent, per PRD), plus a single USAGE string. LAYER 2 — Store (the only I/O seam): load() reads DATA_FILE, returns [] on ENOENT (missing) or empty file, and THROWS on invalid JSON; save(todos) does a durable write via temp file + fs.renameSync (write todos.json.tmp, then atomic rename). LAYER 3 — Commands (pure over the loaded array): cmdAdd(text) appends {text, done:false} and prints 'Added: <text>'; cmdList() prints 'No todos yet.' when empty else one line per item as `${i+1}. [${done?'x':' '}] ${text}`; cmdDone(n) validates n and sets done=true, printing 'Done: <text>'. LAYER 4 — Dispatch/main: read process.argv.slice(2), switch on argv[0] (add|list|done), route errors to a single catch that prints to stderr and process.exit(1). Success paths exit 0. RESOLVED PRD AMBIGUITY (Error-Handling section vs story S-02): missing/empty file => empty list, exit 0 ('No todos yet.'); INVALID JSON => stderr error, exit 1, and DO NOT auto-reset the file (never destroy recoverable user data). done <n> validation: Number.isInteger and 1 <= n <= todos.length, else 'Invalid todo number.' exit 1; missing number/text => usage hint to stderr, exit 1; already-done item stays done and still confirms (S-03). Deliverables the Engineer must produce: todo.js (this layout) + README.md (<40 lines: Node >=18 prereq, all three commands with example invocations, todos.json persistence note — per S-05).",
    "options": [
      {
        "area": "Persistence",
        "chosen": "Read-modify-write the whole JSON array with fs.readFileSync/writeFileSync",
        "rejected": [
          "node:sqlite (Node 22+) — real query/concurrency support but overkill for a tiny single-user list, adds ceremony, and makes the store non-human-inspectable, violating the PRD's plain 'JSON array' data model",
          "Append-only log / NDJSON — cheaper writes but needs compaction and diverges from the PRD data model; more moving parts than the MVP warrants",
          "In-memory only — fails the persistence requirement outright"
        ],
        "tradeoff": "Whole-file rewrite is O(n) per mutation; irrelevant at expected scale (tens–hundreds of items). Wins on simplicity, human-readability, and exact PRD fit."
      },
      {
        "area": "Write durability",
        "chosen": "Atomic write: write todos.json.tmp then fs.renameSync over todos.json",
        "rejected": [
          "Plain fs.writeFileSync (fallback if CTO wants absolute minimalism) — one line shorter but a crash mid-write can leave a truncated/corrupt todos.json, which is the very failure the PRD error-handling worries about"
        ],
        "tradeoff": "~3 extra lines buys crash-safety and removes self-inflicted corruption. RECOMMENDED to include; plain write is an acceptable downgrade if minimalism is prioritized over durability."
      },
      {
        "area": "File location",
        "chosen": "__dirname-relative (path.join(__dirname,'todos.json'))",
        "rejected": [
          "process.cwd()-relative — would silently fragment the todo list across whatever directory you invoke node from; contradicts PRD 'next to the script'"
        ],
        "tradeoff": "One canonical list regardless of invocation dir. Cost: if todo.js sits on a read-only path, add fails — acceptable and out of scope."
      },
      {
        "area": "Argument parsing / dependencies (build-vs-buy)",
        "chosen": "Hand-rolled switch on argv, stdlib only",
        "rejected": [
          "commander/yargs (arg parsing), lowdb/conf (persistence), chalk (color) — all add a node_modules + package.json the PRD explicitly excludes and expand supply-chain surface; stdlib (fs, path, process) fully covers 3 positional commands",
          "util.parseArgs (stdlib, Node >=18.3) — zero-dep and viable, but unnecessary for three positional verbs with no flags; held in reserve as the exit path"
        ],
        "tradeoff": "Zero deps, zero supply-chain surface, matches MVP boundary. Cost: dispatch logic is manual, but it is ~10 lines and the only growth point."
      }
    ],
    "consequences": "POSITIVE: Meets every NFR (single file, zero deps, Node >=18, script-adjacent JSON) with the smallest surface that satisfies all of S-01..S-05. The load()/save() seam is the sole I/O boundary, keeping command logic pure and trivially reviewable/testable even though tests are out of scope. THREAT MODEL (first draft) — trust boundary is a single local user; todos.json shares that user's trust; no network, no privilege boundary, no shell/eval/child_process anywhere. T1 Prototype pollution via a crafted todos.json ('__proto__' key): LOW — we only read .text/.done off array elements and re-serialize, never merging parsed data into an object or using computed keys, so Object.prototype cannot be polluted; optional hardening: coerce on read (String(t.text), Boolean(t.done)). T2 Corrupt/truncated file: MEDIUM likelihood / LOW impact — mitigated by erroring instead of silently resetting (no data loss) and by atomic writes (no self-inflicted corruption). T3 Path/command injection: NONE — text is stored as data, never used as a path or executed. T4 Concurrent writers (two invocations at once): LOW — atomic rename means last-writer-wins is a lost update, not corruption; file locking is out of scope for a single-user tool (documented, not solved). T5 Disk exhaustion / unbounded growth: negligible locally; out of scope. NEGATIVE / ACCEPTED DEBT: no locking (T4), O(n) rewrite per mutation, and no schema versioning in todos.json — all acceptable at MVP scale and revisited only via the exit path below.",
    "exitPath": "Reversibility is preserved because persistence is isolated behind two functions. (1) SCALE/QUERY/CONCURRENCY: replace load()/save() with node:sqlite (Node 22+, still zero-dep) or lowdb via a one-time JSON->store migration; the command layer is untouched. (2) CLI GROWTH (flags, or edit/delete/filter commands): introduce util.parseArgs (stdlib) or adopt commander — the dispatch switch is the single change point. (3) MULTIPLE/NAMED LISTS: parameterize the DATA_FILE constant (today a single path.join); no other code changes. (4) SCHEMA EVOLUTION: add an optional top-level version field on the next write and branch in load(). No external services, no migrations, and plain portable JSON on disk mean none of these choices lock the design in.",
    "confidence": 0.9
  },
  "confidence": 0.9
}