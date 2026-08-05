#!/usr/bin/env node
'use strict';

// Tiny zero-dependency todo CLI.
//   node todo.js add "text"     add a todo
//   node todo.js list          list all todos
//   node todo.js done <number>  mark todo <number> (1-based) as done
//
// Todos persist in todos.json next to this script (CWD-independent).

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'todos.json');

// Read todos from disk. Missing or empty file is a normal empty list,
// not an error. A non-array payload is coerced to [] defensively.
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    if (raw.trim() === '') return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Full-array rewrite. Human-readable, diffable JSON.
function save(todos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2));
}

function cmdAdd(operands) {
  const text = operands.join(' ').trim();
  if (!text) {
    console.error('Error: "add" requires text. Usage: node todo.js add "text"');
    process.exit(1);
  }
  const todos = load();
  todos.push({ text: text, done: false });
  save(todos);
  console.log('Added: ' + text);
}

function cmdList() {
  const todos = load();
  if (todos.length === 0) {
    console.log('No todos yet. Add one: node todo.js add "text"');
    return;
  }
  todos.forEach(function (todo, i) {
    const mark = todo.done ? '[x]' : '[ ]';
    console.log((i + 1) + '. ' + mark + ' ' + todo.text);
  });
}

function cmdDone(operands) {
  const todos = load();
  const n = Number(operands[0]);
  if (!operands.length || !Number.isInteger(n) || n < 1 || n > todos.length) {
    console.error(
      'Error: "done" requires a valid todo number between 1 and ' +
        todos.length +
        '. Usage: node todo.js done <number>'
    );
    process.exit(1);
  }
  const todo = todos[n - 1];
  if (todo.done) {
    console.log('Already done: ' + todo.text);
    return;
  }
  todo.done = true;
  save(todos);
  console.log('Done: ' + todo.text);
}

function main() {
  const command = process.argv[2];
  const operands = process.argv.slice(3);
  switch (command) {
    case 'add':
      cmdAdd(operands);
      break;
    case 'list':
      cmdList();
      break;
    case 'done':
      cmdDone(operands);
      break;
    default:
      console.error(
        'Usage:\n' +
          '  node todo.js add "text"\n' +
          '  node todo.js list\n' +
          '  node todo.js done <number>'
      );
      process.exit(1);
  }
}

main();
