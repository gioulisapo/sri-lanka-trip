import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { authenticate } from './auth.mjs';
import worker from './worker.mjs';

const password = process.env.SITE_PASSWORD;
if (!password) throw new Error('Set SITE_PASSWORD.');
const origin = new URL(process.env.PUBLIC_URL || 'http://localhost:8080').origin;
mkdirSync('/data', { recursive: true });
const sqlite = new DatabaseSync('/data/trip.sqlite');
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
for (const file of readdirSync('./migrations').filter(f => f.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT name FROM schema_migrations WHERE name=?').get(file)) continue;
  sqlite.exec('BEGIN');
  try {
    sqlite.exec(readFileSync('./migrations/' + file, 'utf8'));
    sqlite.prepare('INSERT INTO schema_migrations VALUES (?)').run(file);
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    const bound = args => ({
      bind: (...values) => bound(values),
      first: async () => statement.get(...args) || null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } })
    });
    return bound([]);
  }
};
const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413); res.end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const key of ['content-type', 'origin', 'cookie']) if (req.headers[key]) headers.set(key, req.headers[key]);
    const method = req.method || 'GET';
    const request = new Request(new URL(req.url, origin), {
      method, headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks)
    });
    const login = await authenticate(request, password);
    if (!login) request.headers.set('oai-authenticated-user-id', 'self-hosted-user');
    const response = login || await worker.fetch(request, { DB });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500); res.end('Server error');
  }
});
server.listen(8080, '0.0.0.0');
process.on('SIGTERM', () => server.close(() => { sqlite.close(); process.exit(0); }));
