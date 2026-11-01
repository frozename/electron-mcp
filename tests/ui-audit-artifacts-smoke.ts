import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const executable = process.env.CI_ELECTRON_BIN;
assert(executable, 'CI_ELECTRON_BIN must point to an Electron executable');
const here = dirname(fileURLToPath(import.meta.url));
const artifactRoot = '/tmp/electron-mcp-audit-smoke';
mkdirSync(artifactRoot, { recursive: true });
const directory = mkdtempSync(join(artifactRoot, 'run-'));
const modulesPath = join(directory, 'modules.json');
const baselines = join(directory, 'baselines');
writeFileSync(modulesPath, JSON.stringify([{ id: 'dashboard', label: 'Dashboard' }]));

interface AuditReport {
  diffs: Array<{
    currentPath?: string;
    diffPixels: number;
    totalPixels: number;
    diffRatio: number;
    thresholdBreached: boolean;
  }>;
  results: Array<{ screenshotPath: string }>;
}

function run(name: string, flags: string[], expectedExit: number): AuditReport {
  const outDir = join(directory, name);
  mkdirSync(outDir, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      resolve(here, '../node_modules/tsx/dist/cli.mjs'),
      join(here, 'ui-audit-driver-v2.ts'),
      `--executable=${executable}`,
      `--args=${join(here, 'fixtures/ci-app/main.js')}`,
      `--modules=${modulesPath}`,
      `--out-dir=${outDir}`,
      `--baselines=${baselines}`,
      ...flags,
    ],
    { encoding: 'utf8', timeout: 90_000 },
  );
  writeFileSync(join(outDir, 'driver.log'), result.stdout + result.stderr);
  assert.ifError(result.error);
  assert.equal(result.status, expectedExit, `${name}: ${result.stdout}${result.stderr}`);
  const report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as AuditReport;
  assert.equal(report.diffs.length, 1);
  assert.equal(report.results.length, 1);
  const currentPath = report.diffs[0]!.currentPath;
  assert(currentPath, 'the report must identify the exact compared frame');
  const retainedPath = relative(outDir, currentPath);
  assert(
    !retainedPath.startsWith('..') && !isAbsolute(retainedPath),
    `compared frame must be retained under --out-dir: ${currentPath}`,
  );
  assert.notEqual(currentPath, report.results[0]!.screenshotPath);
  PNG.sync.read(readFileSync(currentPath));
  return report;
}

function verifyComparison(
  report: AuditReport,
  baselinePath = join(baselines, 'dashboard.png'),
): void {
  const diff = report.diffs[0]!;
  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const current = PNG.sync.read(readFileSync(diff.currentPath!));
  const count = pixelmatch(baseline.data, current.data, undefined, current.width, current.height, {
    threshold: 0,
  });
  assert.equal(diff.diffPixels, count);
  assert.equal(diff.totalPixels, current.width * current.height);
  assert.equal(diff.diffRatio, count / diff.totalPixels);
}

const seeded = run('seed', ['--updateBaselines'], 0);
assert.deepEqual(
  readFileSync(seeded.diffs[0]!.currentPath!),
  readFileSync(join(baselines, 'dashboard.png')),
);
const passing = run('pass', ['--threshold=1'], 0);
verifyComparison(passing);
assert.equal(passing.diffs[0]!.thresholdBreached, false);

const defectiveBaseline = PNG.sync.read(readFileSync(join(baselines, 'dashboard.png')));
for (let i = 0; i < defectiveBaseline.data.length; i += 4) {
  defectiveBaseline.data.set([255, 0, 255, 255], i);
}
writeFileSync(join(baselines, 'dashboard.png'), PNG.sync.write(defectiveBaseline));
const failing = run('fail', ['--threshold=0.01'], 1);
verifyComparison(failing);
assert.equal(failing.diffs[0]!.thresholdBreached, true);

writeFileSync(
  modulesPath,
  JSON.stringify([{ id: '../../escape', label: 'Dashboard', rootTestId: 'dashboard-root' }]),
);
run(
  'nested-id',
  ['--updateBaselines', `--baselines=${join(directory, 'nested/baseline/files')}`],
  0,
);

const overlappingBaselines = join(directory, 'overlap/compared');
mkdirSync(overlappingBaselines, { recursive: true });
const overlappingBaseline = join(overlappingBaselines, 'current.png');
const originalBaseline = PNG.sync.write(defectiveBaseline);
writeFileSync(overlappingBaseline, originalBaseline);
writeFileSync(
  modulesPath,
  JSON.stringify([{ id: 'current', label: 'Dashboard', rootTestId: 'dashboard-root' }]),
);
const overlapping = run('overlap', [`--baselines=${overlappingBaselines}`, '--threshold=0.01'], 1);
assert.deepEqual(readFileSync(overlappingBaseline), originalBaseline);
verifyComparison(overlapping, overlappingBaseline);
console.log(`audit artifact smoke passed (seed, pass, fail, path-like ID, overlap): ${directory}`);
