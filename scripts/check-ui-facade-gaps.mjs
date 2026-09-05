import { readFile } from 'node:fs/promises';

const gaps = await readFile(new URL('../docs/frontend/ui-facade-gaps.md', import.meta.url), 'utf8');
if (/^\|\s*OPEN\s*\|/imu.test(gaps))
  throw new Error('An open UI facade gap blocks the MVP checklist.');
process.stdout.write('ui:facade-gaps: no open facade gaps.\n');
