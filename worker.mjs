import html from './page.generated.mjs';
const sections = new Set(["dec-4", "alternatives", "booking", "day-1", "day-10", "day-11", "day-2", "day-3", "day-4", "day-5", "day-6", "day-7", "day-8", "day-9", "dec-10", "dec-11", "dec-12", "dec-13", "dec-14", "dec-15", "dec-16", "dec-17", "dec-5", "dec-6", "dec-7", "dec-8", "dec-9", "diving", "flights", "hiking", "itinerary", "map", "plans", "practical", "questions", "route", "sources", "surfing", "transport"]);

import { sqliteStore } from './storage.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const store = env.STORE || sqliteStore(env.DB);
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(html, {
        headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin'}
      });
    }
    if (url.pathname === '/api/answers') {
      if (!request.headers.get('oai-authenticated-user-id')) return new Response(null,{status:401});
      if(request.method==='GET'){
        return Response.json(await store.getAnswers(),{headers:{'Cache-Control':'no-store'}});
      }
      if(request.method!=='POST') return new Response(null,{status:405});
      if(request.headers.get('Origin')!==url.origin) return new Response(null,{status:403});
      const payload=await request.json().catch(()=>null);
      if(!payload||!Number.isInteger(payload.revision)||!payload.answers||Array.isArray(payload.answers))return new Response(null,{status:400});
      const entries=Object.entries(payload.answers);
      if(entries.length!==12||entries.some(([k,v])=>!/^([0-9]|1[01])$/.test(k)||typeof v!=='string'||v.length>3000))return new Response(null,{status:400});
      const revision=await store.saveAnswers(payload.answers,payload.revision);
      if(revision===null)return new Response(null,{status:409});
      return Response.json({revision});
    }

    if (url.pathname !== '/api/comments') return new Response(null, {status: 404});
    const user = request.headers.get('oai-authenticated-user-id');
    if (!user) return new Response(null, {status: 401});

    const section = url.searchParams.get('section');
    if (!sections.has(section)) return new Response(null, {status: 400});
    if (request.method === 'GET') {
      return Response.json(await store.getComments(section), {headers: {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin'}});
    }
    if (request.method !== 'POST') return new Response(null, {status: 405});
    if (request.headers.get('Origin') !== url.origin) return new Response(null, {status: 403});

    const payload = await request.json().catch(() => null);
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    const quote = typeof payload?.quote === 'string' ? payload.quote.trim() : '';
    if (!body || body.length > 2000 || quote.length > 500) return new Response(null, {status: 400});

    const author = payload?.author;
    if (!['Maria', 'Apostolis', 'Giannis'].includes(author)) {
      return new Response(null, {status: 400});
    }
    await store.addComment(section, author, body, quote);
    return new Response(null, {status: 201});
  }
};
