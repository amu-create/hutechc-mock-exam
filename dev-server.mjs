// 로컬 확인용 서버: 정적 파일 + /api/grade (Vercel과 같은 handler 사용)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import handler from './api/grade.js';

const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/grade') {
      res.status = (c) => ((res.statusCode = c), res);
      res.json = (o) => {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(o));
      };
      return handler(req, res);
    }
    const p = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!p.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  })
  .listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
