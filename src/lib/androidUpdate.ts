// Update checking for Croc Mobile.
//
// tauri-plugin-updater is desktop-only here — its rustls path pulls in `ring`,
// which needs a C toolchain for the Android target, so the plugin isn't registered
// (see #[cfg(desktop)] in lib.rs) and there is no signed updater artifact for
// Android at all (createUpdaterArtifacts is false in tauri.android.conf.json).
//
// The release itself is still a perfectly good manifest, though: api.github.com
// answers with `access-control-allow-origin: *`, so the webview can read it
// directly. No new Rust dependency, no native code.
//
// Installing is handed to the browser: the APK URL is opened, the browser
// downloads it, and Android's own package installer takes over. Downloading
// in-app would mean DownloadManager over JNI plus a FileProvider to hand the
// system installer a readable URI — worth doing, but not before the app can even
// tell you an update exists.

import { croc } from './services/ipc';

const REPO = 'Carlos-err406/croc-gui';

export interface AndroidUpdate {
  version: string;
  /** Direct APK link — opening it starts the download, then the system installer. */
  apkUrl: string;
  /** The release page, for when the APK asset is missing from a release. */
  pageUrl: string;
}

/** -1 / 0 / 1, comparing dotted numeric versions ("2.5.1"). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The newest release if it's newer than `current`, else null.
 *
 * Throws on a network/API failure so the caller can say "couldn't check" rather
 * than the far worse "you're up to date".
 */
export async function checkAndroidUpdate(current: string): Promise<AndroidUpdate | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const release = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    assets?: { name: string; browser_download_url: string }[];
  };

  const version = (release.tag_name ?? '').replace(/^v/, '').trim();
  if (!version || compareVersions(version, current) <= 0) return null;

  // Named croc-mobile-<version>-arm64.apk by release.yml. Matched loosely so a
  // rename there degrades to "no APK on this release" rather than a wrong file.
  const apk = release.assets?.find((a) => a.name.endsWith('.apk'));
  const pageUrl = release.html_url ?? `https://github.com/${REPO}/releases/latest`;
  return { version, apkUrl: apk?.browser_download_url ?? pageUrl, pageUrl };
}

/**
 * Download the APK with Android's DownloadManager, then hand it to the package installer.
 *
 * Neither obvious approach works. `openUrl(apkUrl)` goes to the GitHub app, which holds
 * verified App Links for github.com — behind its app lock, downloading nothing. And
 * fetching it here is blocked by CORS: api.github.com allows cross-origin reads, which is
 * why *checking* works, but the asset redirects to release-assets.githubusercontent.com,
 * which sends no CORS header at all.
 */
export async function downloadAndInstallApk(
  url: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const [startErr] = await croc.updateDownload(url);
  if (startErr) throw new Error(startErr.message);

  for (;;) {
    await new Promise((r) => setTimeout(r, 600));
    const [pollErr, state] = await croc.updateProgress();
    if (pollErr) throw new Error(pollErr.message);
    const [kind, soFar, total] = (state ?? '').split(':');
    if (kind === 'error') throw new Error(state!.slice('error:'.length) || 'download failed');
    onProgress(Number(soFar) || 0, Number(total) > 0 ? Number(total) : 0);
    if (kind === 'done') break;
  }

  const [installErr] = await croc.installApk();
  if (installErr) throw new Error(installErr.message);
}
