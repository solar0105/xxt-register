'use strict';
/** 极简路由表：route('GET', '/api/x/:id', handler) */

function createRouter() {
  const routes = [];

  function route(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:[a-zA-Z]+/g, (m) => {
          keys.push(m.slice(1));
          return '([^/]+)';
        }) +
        '$',
    );
    routes.push({ method, re, keys, handler });
  }

  function match(method, pathname) {
    const hit = routes.find((r) => r.method === method && r.re.test(pathname));
    if (!hit) return null;
    const m = hit.re.exec(pathname);
    const params = {};
    hit.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { handler: hit.handler, params };
  }

  return { route, match, routes };
}

module.exports = { createRouter };
