// What is declared at the top level of app.js, and where.
const fs = require('fs');
const lines = fs.readFileSync('public/app.js', 'utf8').split(/\r?\n/);
const decls = [];
const re = /^(?:export\s+)?(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
lines.forEach((l, i) => {
  const m = l.match(re);
  if (m) decls.push({ name: m[2], kind: m[1], line: i + 1 });
});
console.log('top-level declarations:', decls.length);
const byKind = {};
for (const d of decls) byKind[d.kind] = (byKind[d.kind] || 0) + 1;
console.log(byKind);
// Render functions, which are the bulk.
const renders = decls.filter((d) => /^render[A-Z]/.test(d.name));
console.log('render functions:', renders.length);
fs.writeFileSync('/tmp/decls.json', JSON.stringify(decls, null, 1));
