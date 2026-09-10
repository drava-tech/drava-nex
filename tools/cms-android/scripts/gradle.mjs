/**
 * Runs the Android Gradle wrapper with a JDK and SDK it can actually use.
 *
 * Two things bite here and neither gives a clear error on its own:
 *
 *  - Android Studio 2026 bundles JDK 25 (jbr/). Gradle 8.14.3 — the version
 *    Capacitor pins — supports at most JDK 24, so a build using JAVA_HOME as
 *    Studio sets it dies with "Unsupported class file major version".
 *  - The Android SDK path has to reach Gradle through android/local.properties,
 *    which is gitignored (it is machine-specific), so a fresh clone has none.
 *
 * So: pick a JDK in the supported range, write local.properties if it is
 * missing or stale, and hand both to the wrapper. Nothing global is modified —
 * JAVA_HOME and ANDROID_HOME are set for this child process only.
 *
 * Usage: node scripts/gradle.mjs assembleRelease
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = resolve(here, '..', 'android');
const isWindows = platform() === 'win32';

// Gradle 8.14 runs on JDK 8–24; AGP 8.13 needs 17+. 21 is the LTS in the middle.
const MIN_JDK = 17;
const MAX_JDK = 24;

function jdkMajor(home) {
  // The `release` file every JDK ships beats spawning java -version.
  const releaseFile = join(home, 'release');
  if (!existsSync(releaseFile)) return null;
  const m = readFileSync(releaseFile, 'utf8').match(/^JAVA_VERSION="?(\d+)/m);
  return m ? Number(m[1]) : null;
}

const usable = (home) => {
  if (!home || !existsSync(join(home, 'bin', isWindows ? 'java.exe' : 'java'))) return null;
  const major = jdkMajor(home);
  return major !== null && major >= MIN_JDK && major <= MAX_JDK ? major : null;
};

function* candidateJdks() {
  if (process.env.CMS_ANDROID_JAVA_HOME) yield process.env.CMS_ANDROID_JAVA_HOME;
  if (process.env.JAVA_HOME) yield process.env.JAVA_HOME;

  // Forward slashes throughout — Node accepts them on Windows, and they keep
  // these literals free of escape sequences.
  const roots = isWindows
    ? ['C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Java', 'C:/Program Files/Microsoft']
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      yield join(root, name);
      // macOS nests the real home a few levels down.
      yield join(root, name, 'Contents', 'Home');
    }
  }
}

function findJdk() {
  const rejected = [];
  for (const home of candidateJdks()) {
    const major = usable(home);
    if (major) return { home, major };
    const seen = jdkMajor(home);
    if (seen !== null) rejected.push(`${home} (JDK ${seen})`);
  }
  const detail = rejected.length ? `\nFound but unusable:\n  ${rejected.join('\n  ')}` : '';
  throw new Error(
    `No JDK ${MIN_JDK}-${MAX_JDK} found — Gradle 8.14.3 cannot run on anything newer, ` +
      `and Android Studio's bundled jbr/ is JDK 25.\n` +
      `Install Temurin 21 (winget install EclipseAdoptium.Temurin.21.JDK), or set ` +
      `CMS_ANDROID_JAVA_HOME to one you already have.${detail}`,
  );
}

function findSdk() {
  const explicit = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const guesses = [
    explicit,
    isWindows ? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk') : null,
    join(homedir(), 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
  ].filter(Boolean);

  for (const dir of guesses) {
    if (existsSync(join(dir, 'platforms'))) return dir;
  }
  throw new Error(
    'Android SDK not found. Open Android Studio once to run its setup wizard, or set ANDROID_HOME.\n' +
      `Looked in:\n  ${guesses.join('\n  ')}`,
  );
}

const { home: javaHome, major } = findJdk();
const sdk = findSdk();
console.log(`gradle: JDK ${major} at ${javaHome}`);
console.log(`gradle: SDK at ${sdk}`);

// local.properties is gitignored, so write it rather than expecting it.
// A .properties file treats backslash as an escape character, so a Windows SDK
// path has to be written with forward slashes (Gradle accepts them) rather than
// pasted in raw.
const BACKSLASH = String.fromCharCode(92);
const localProps = join(androidDir, 'local.properties');
const line = 'sdk.dir=' + sdk.split(BACKSLASH).join('/') + '\n';
if (!existsSync(localProps) || readFileSync(localProps, 'utf8') !== line) {
  writeFileSync(localProps, line);
  console.log('gradle: wrote android/local.properties');
}

const result = spawnSync(join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew'), process.argv.slice(2), {
  cwd: androidDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    // The wrapper downloads the Gradle distribution in the *client* JVM, before
    // gradle.properties (which carries the same flag for the daemon) is read.
    // Without it that download hangs on IPv6 — see the note in
    // android/gradle.properties.
    GRADLE_OPTS: [process.env.GRADLE_OPTS, '-Djava.net.preferIPv4Stack=true'].filter(Boolean).join(' '),
  },
  shell: isWindows,
});

process.exit(result.status ?? 1);
