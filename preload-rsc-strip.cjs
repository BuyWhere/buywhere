// Preload module: runs at process startup before any other code
const http = require('node:http');

const RSTRIPPED_PREFIXES = ['/search', '/compare', '/deals'];
const RSTATE_HEADER = 'next-router-state-tree';

const original = http.createServer;
http.createServer = function patchedCreateServer(requestListener, options) {
  if (typeof requestListener === 'function') {
    const wrapped = function wrapped(req, res) {
      try {
        const url = req.url || '/';
        const pathname = url.split('?', 1)[0] || '/';
        if (
          RSTRIPPED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/')) &&
          req.headers[RSTATE_HEADER]
        ) {
          delete req.headers[RSTATE_HEADER];
        }
      } catch (e) {}
      return requestListener.call(this, req, res);
    };
    return original.call(this, wrapped, options);
  }
  return original.call(this, requestListener, options);
};

console.log('[preload] http.createServer patched for /search + /compare + /deals');
