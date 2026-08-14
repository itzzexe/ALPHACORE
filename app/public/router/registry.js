// Which hash opens which page.
//
// The table itself lives in app.js, because it is the shape of the whole
// console and belongs in the file that composes it. What lives here is the
// box it goes into — and the reason that matters is a cycle: the router has to
// read the table to navigate, the table names a hundred and fifty renderers,
// and every renderer needs the router to link anywhere. Registering into a
// registry breaks the ring without a bundler, an import map, or a build step.
//
// Nothing here decides anything. It is a place to put things and a place to
// look them up, which is exactly as much as it should be.

/** route key → { title, render, poll? }. Populated at import time by app.js. */
export const routes = {};

/**
 * Add pages to the table.
 *
 * Refuses to overwrite a key that is already registered. Two departments
 * quietly claiming the same hash is precisely the failure the surfaces work
 * was built to prevent — `#/people` opening the wrong page is not a 404, it is
 * worse — so it fails loudly here rather than depending on declaration order.
 */
export function registerRoutes(table) {
  for (const [key, def] of Object.entries(table)) {
    if (Object.prototype.hasOwnProperty.call(routes, key)) {
      throw new Error(`two pages both claim the route #/${key}`);
    }
    routes[key] = def;
  }
  return routes;
}
