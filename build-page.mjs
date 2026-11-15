import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('site.html', 'utf8');
writeFileSync('page.generated.mjs', `export default ${JSON.stringify(html)};\n`);
