import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(dirname, '../tests');

const testFiles = fs.readdirSync(testsDir, { recursive: true })
    .map(file => file.toString())
    .filter(file => file.endsWith('.test.ts'))
    .map(file => path.join(testsDir, file));

const result = spawnSync('node', [
    '--loader', 'ts-node/esm',
    '--test',
    ...testFiles
], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' }
});

if (result.error) {
    console.error('Failed to start test runner:', result.error);
    process.exit(1);
}

if (result.signal) {
    process.kill(process.pid, result.signal);
    process.exit(1);
}

process.exit(result.status ?? 0);
