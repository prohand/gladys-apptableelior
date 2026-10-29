// -----------------------------------------------------------------------------
// The changelog roll of the Release workflow (.github/scripts/changelog-release.mjs).
// The release commit is pushed straight to main: what it writes must pass the
// same Prettier check as any pull request.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const changelogPath = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));

test('the first release moves Unreleased under 1.0.0 and links its tag', async () => {
  const text = await readFile(changelogPath, 'utf8');
  const rolled = rollChangelog(text, '1.0.0', '2026-11-02');

  assert.match(rolled, /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-11-02\n\n### Added/);
  assert.match(
    rolled,
    /^\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-apptable-elior\/compare\/v1\.0\.0\.\.\.HEAD$/m,
  );
  assert.match(
    rolled,
    /^\[1\.0\.0\]: https:\/\/github\.com\/prohand\/gladys-apptable-elior\/releases\/tag\/v1\.0\.0$/m,
  );
  const options = { ...(await prettier.resolveConfig(changelogPath)), filepath: changelogPath };
  assert.equal(
    await prettier.format(rolled, options),
    rolled,
    'CHANGELOG.md would fail format:check',
  );
});

test('the next release compares with the previous tag', () => {
  const first = rollChangelog(
    '# Changelog\n\n## [Unreleased]\n\n- A.\n\n[Unreleased]: https://github.com/o/r/commits/main\n',
    '1.0.0',
    '2026-11-02',
  );
  const second = rollChangelog(
    first.replace('## [Unreleased]\n', '## [Unreleased]\n\n- B.\n'),
    '1.0.1',
    '2026-11-03',
  );
  assert.match(
    second,
    /^\[1\.0\.1\]: https:\/\/github\.com\/o\/r\/compare\/v1\.0\.0\.\.\.v1\.0\.1$/m,
  );
  assert.match(second, /## \[1\.0\.1\] - 2026-11-03\n\n- B\./);
});

test('a release with nothing listed still gets its section', () => {
  const rolled = rollChangelog('# Changelog\n\n## [Unreleased]\n', '1.0.1', '2026-11-03');
  assert.match(rolled, /## \[1\.0\.1\] - 2026-11-03\n\n- Maintenance release/);
});
