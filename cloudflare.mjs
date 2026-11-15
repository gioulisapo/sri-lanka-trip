import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import worker from './worker.mjs';
import { supabaseStore } from './storage.mjs';

export default {
  async fetch(request, env) {
    if (!env.SITE_PASSWORD || env.SITE_PASSWORD.length < 16) {
      return new Response('Site password is not configured', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const expected = Buffer.from('Basic ' + Buffer.from((env.SITE_USER || 'traveller') + ':' + env.SITE_PASSWORD).toString('base64'));
    const supplied = Buffer.from(request.headers.get('Authorization') || '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return new Response('Sign in to view the trip', { status: 401, headers: {
        'WWW-Authenticate': 'Basic realm="Sri Lanka trip", charset="UTF-8"',
        'Cache-Control': 'no-store'
      } });
    }
    try {
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
