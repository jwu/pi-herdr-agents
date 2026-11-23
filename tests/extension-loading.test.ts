import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

test('Pi loads the extension from the package manifest', async () => {
  const packageDir = fileURLToPath(new URL('../', import.meta.url));
  const agentDir = await mkdtemp(join(tmpdir(), 'pi-herdr-core-'));

  try {
    const loader = new DefaultResourceLoader({
      cwd: agentDir,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: [packageDir],
      noExtensions: true,
    });
    await loader.reload();

    const { extensions, errors } = loader.getExtensions();
    expect(errors).toEqual([]);
    expect(extensions.map(({ path }) => path)).toEqual([join(packageDir, 'extensions/index.ts')]);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});
