import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runOfflineLiraContracts } from './liraEvalContracts.js';

// Intentionally separate from evalLiraProviders: no dotenv or model keys.
const report = await runOfflineLiraContracts();
const output = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = process.argv.slice(2).find(arg => arg.startsWith('--out='))?.slice('--out='.length);
if (outputPath) {
  const absolute = resolve(outputPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, output, 'utf8');
  console.log(`Wrote ${absolute}: ${report.passCount}/${report.total}, model calls ${report.modelCalls}`);
} else {
  console.log(output);
}
if (report.passCount !== report.total) process.exitCode = 1;
