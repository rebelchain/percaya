import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { patchBuildGradleForRelease } from './setup-release-signing.mjs';

const sampleGradle = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}`;

test('patchBuildGradleForRelease wires signingConfigs.release and is idempotent', () => {
  const once = patchBuildGradleForRelease(sampleGradle);
  assert.match(once, /keystore\.properties/);
  assert.match(once, /debug \{\n\s+signingConfig signingConfigs\.debug/);
  assert.match(once, /buildTypes \{\n[\s\S]*release \{\n\s+signingConfig signingConfigs\.release/);

  const twice = patchBuildGradleForRelease(once);
  assert.equal(twice, once);
});

test('patchBuildGradleForRelease succeeds against actual android/app/build.gradle if present', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const realGradle = path.resolve(dir, '../android/app/build.gradle');
  if (fs.existsSync(realGradle)) {
    const src = fs.readFileSync(realGradle, 'utf8');
    const out = patchBuildGradleForRelease(src);
    assert.match(out, /signingConfigs\.release/);
  }
});
