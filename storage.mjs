export function sqliteStore(DB) {
  return {
    async getText() {
      const row = await DB.prepare('SELECT edits, revision FROM trip_text WHERE id=1').first();
      return row ? { edits: JSON.parse(row.edits), revision: row.revision } : { edits: {}, revision: 0 };
    },
    async saveText(edits, revision) {
      await DB.prepare('INSERT OR IGNORE INTO trip_text (id) VALUES (1)').run();
      const result = await DB.prepare('UPDATE trip_text SET edits=json_patch(edits, ?), revision=revision+1 WHERE id=1 AND revision=?')
        .bind(JSON.stringify(edits), revision).run();
      return result.meta.changes ? revision + 1 : null;
    },
    async getAnswers() {
      const row = await DB.prepare('SELECT answers, revision FROM trip_answers WHERE id=1').first();
      return row ? { answers: JSON.parse(row.answers), revision: row.revision } : { answers: {}, revision: 0 };
    },
    async saveAnswers(answers, revision) {
      await DB.prepare('INSERT OR IGNORE INTO trip_answers (id) VALUES (1)').run();
      const result = await DB.prepare('UPDATE trip_answers SET answers=?, revision=revision+1 WHERE id=1 AND revision=?')
        .bind(JSON.stringify(answers), revision).run();
      return result.meta.changes ? revision + 1 : null;
    },
    async getComments(section) {
      const { results } = await DB.prepare('SELECT author, body, quote FROM comments WHERE section = ? ORDER BY id DESC LIMIT 100')
        .bind(section).all();
      return results.reverse();
    },
    async addComment(section, author, body, quote) {
      await DB.prepare('INSERT INTO comments (section, author, body, quote) VALUES (?, ?, ?, ?)')
        .bind(section, author, body, quote).run();
    }
  };
}

export function supabaseStore(env) {
  async function query(path, body) {
    const response = await fetch(new URL('/rest/v1/' + path, env.SUPABASE_URL), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Supabase request failed: ' + response.status);
    return response.status === 201 || response.status === 204 ? null : response.json();
  }
  return {
    async getText() {
      const rows = await query('sri_lanka_text?id=eq.1&select=edits,revision');
      return rows[0] || { edits: {}, revision: 0 };
    },
    saveText: (edits, revision) => query('rpc/sri_lanka_save_text', {
      new_edits: edits, expected_revision: revision
    }),
    async getAnswers() {
      const rows = await query('sri_lanka_answers?id=eq.1&select=answers,revision');
      return rows[0] || { answers: {}, revision: 0 };
    },
    saveAnswers: (answers, revision) => query('rpc/sri_lanka_save_answers', {
      new_answers: answers, expected_revision: revision
    }),
    async getComments(section) {
      const rows = await query('sri_lanka_comments?select=author,body,quote&order=id.desc&limit=100&section=eq.' + encodeURIComponent(section));
      return rows.reverse();
    },
    addComment: (section, author, body, quote) => query('sri_lanka_comments', { section, author, body, quote })
  };
}
