import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

test('page generation preserves programmatic edits, Unicode and script escaping', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trip-page-'));
  try {
    const original = '<h1>Sri Lanka</h1>\n<p>Maria’s trip & "quotes"</p>\n<script>const text = `hello ${name} \\n`;</script>';
    for (const html of [original, original.replace('Sri Lanka', 'Updated trip')]) {
      writeFileSync(join(directory, 'site.html'), html);
      execFileSync(process.execPath, [new URL('./build-page.mjs', import.meta.url).pathname], { cwd: directory });
      const generated = readFileSync(join(directory, 'page.generated.mjs'), 'utf8');
      assert.equal(runInNewContext(generated.replace('export default ', '')), html);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
