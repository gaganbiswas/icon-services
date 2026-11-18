import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { renderLifecycleDoc } from './lifecycle-doc.js';

const target = path.resolve(import.meta.dirname, '../../../../docs/job-lifecycle.md');
writeFileSync(target, renderLifecycleDoc());
console.log(`Wrote ${target}`);
