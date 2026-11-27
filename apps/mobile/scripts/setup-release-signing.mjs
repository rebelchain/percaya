#!/usr/bin/env node
/**
 * Generates a dedicated RSA-2048 release keystore (required by Solana dApp Store;
 * debug.keystore is rejected) and wires `signingConfigs.release` into `android/app/build.gradle`.
 *
 * Usage (from apps/mobile):
 *   node scripts/setup-release-signing.mjs
 *
 * Optional env overrides:
 *   KEYSTORE_PASS, KEY_ALIAS, KEY_PASS
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_SIGNING_MARKER = '// percaya-dapp-store-release-signing';

/**
 * Pure patcher for `android/app/build.gradle` (exported for unit testing).
 * Idempotent: running twice produces the exact same output.
 */
export function patchBuildGradleForRelease(gradleSource) {
  if (gradleSource.includes(RELEASE_SIGNING_MARKER)) {
    return gradleSource;
  }

  const releaseConfigBlock = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        ${RELEASE_SIGNING_MARKER}
        release {
            def ksPropsFile = rootProject.file('keystore.properties')
            if (ksPropsFile.exists()) {
                def ksProps = new Properties()
                ksPropsFile.withInputStream { ksProps.load(it) }
                storeFile file(ksProps.getProperty('storeFile'))
                storePassword ksProps.getProperty('storePassword')
                keyAlias ksProps.getProperty('keyAlias')
                keyPassword ksProps.getProperty('keyPassword')
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }`;

  const debugBlockRegex =
    /        debug \{\r?\n            storeFile file\('debug\.keystore'\)\r?\n            storePassword 'android'\r?\n            keyAlias 'androiddebugkey'\r?\n            keyPassword 'android'\r?\n        \}/;

  if (!debugBlockRegex.test(gradleSource)) {
    throw new Error('Could not locate expected debug signingConfig block in build.gradle');
  }

  let patched = gradleSource.replace(debugBlockRegex, releaseConfigBlock);
  patched = patched.replace(
    /(buildTypes \{\r?\n[\s\S]*?release \{\r?\n[^}]*?)signingConfig signingConfigs\.debug/,
    '$1signingConfig signingConfigs.release',
  );
  return patched;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const mobileRoot = path.resolve(scriptDir, '..');
  const androidDir = path.join(mobileRoot, 'android');
  const appDir = path.join(androidDir, 'app');
  const gradlePath = path.join(appDir, 'build.gradle');
  const keystoreFile = 'percaya-release.keystore';
  const keystorePath = path.join(appDir, keystoreFile);
  const propsPath = path.join(androidDir, 'keystore.properties');

  if (!fs.existsSync(gradlePath)) {
    throw new Error(`Missing ${gradlePath}. Run 'npx expo prebuild --platform android' first.`);
  }

  if (!fs.existsSync(keystorePath)) {
    const storePassword =
      process.env.KEYSTORE_PASS || crypto.randomBytes(18).toString('base64url');
    const keyAlias = process.env.KEY_ALIAS || 'percaya-dapp-store';
    const keyPassword = process.env.KEY_PASS || storePassword;

    console.log(`[signing] Generating RSA-2048 keystore at ${keystorePath} ...`);
    execFileSync(
      'keytool',
      [
        '-genkeypair',
        '-v',
        '-storetype',
        'PKCS12',
        '-keystore',
        keystorePath,
        '-alias',
        keyAlias,
        '-keyalg',
        'RSA',
        '-keysize',
        '2048',
        '-validity',
        '10000',
        '-storepass',
        storePassword,
        '-keypass',
        keyPassword,
        '-dname',
        'CN=percaya, OU=Solana Mobile, O=percaya, L=Jakarta, C=ID',
      ],
      { stdio: 'inherit' },
    );

    fs.writeFileSync(
      propsPath,
      [
        `storeFile=${keystoreFile}`,
        `storePassword=${storePassword}`,
        `keyAlias=${keyAlias}`,
        `keyPassword=${keyPassword}`,
        '',
      ].join('\n'),
      'utf8',
    );
    console.log(`[signing] Wrote gitignored ${propsPath}`);
  } else {
    console.log(`[signing] Reusing existing ${keystorePath}`);
  }

  const original = fs.readFileSync(gradlePath, 'utf8');
  const updated = patchBuildGradleForRelease(original);
  if (updated !== original) {
    fs.writeFileSync(gradlePath, updated, 'utf8');
    console.log(`[signing] Patched ${gradlePath} to use signingConfigs.release`);
  } else {
    console.log(`[signing] ${gradlePath} already configured for release signing`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
