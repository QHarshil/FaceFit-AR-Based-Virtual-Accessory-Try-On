// Static server for the production build with SPA fallback, so the harness
// measures the same bundle a user would get.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export const serveBuild = (root, port) =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      let file = join(root, path);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    server.listen(port, () => resolve(server));
  });
