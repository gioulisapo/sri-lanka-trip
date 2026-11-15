import { Buffer } from 'node:buffer';
import { authenticate } from './auth.mjs';
import worker from './worker.mjs';
import { supabaseStore } from './storage.mjs';

export default {
  async fetch(request, env) {
    try {
      const login = await authenticate(request, env.SITE_PASSWORD);
      if (login) return login;
      const chunks = [];
      let size = 0;
      if (request.body) {
        for await (const chunk of request.body) {
          size += chunk.byteLength;
          if (size > 65536) return new Response(null, { status: 413 });
          chunks.push(chunk);
        }
      }
      const headers = new Headers(request.headers);
      // Identity is set only after the password check, never trusted from the client.
      headers.set('oai-authenticated-user-id', 'self-hosted-user');
      headers.delete('Authorization');
      const authenticated = new Request(request.url, {
        method: request.method, headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(chunks)
      });
      return await worker.fetch(authenticated, { ...env, STORE: supabaseStore(env) });
    } catch (error) {
      console.error(error.message);
      return new Response('Server error', { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
  }
};
