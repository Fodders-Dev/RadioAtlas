# Android (Trusted Web Activity)

A TWA is Chrome rendering `radioatlas.ru` full-screen inside an Android app. It
is **not** a second codebase: whatever the web build does, the wrapper does
identically. It buys one thing — being findable in the Play Store.

Like `apps/extractor`, this directory has **no `package.json` on purpose**.
`workspaces: ["apps/*"]` means any directory here that has one becomes an npm
workspace, and `npm run build --workspaces` would then try to build an Android
project. Do not add one.

## What is committed, and what is not

Only `twa-manifest.json` — the whole configuration. The Android project
(`app/`, `gradle*`, `build.gradle`) is **generated** from it by Bubblewrap and is
gitignored: it is derived output, and several hundred files of it would bury the
one file anybody actually edits.

`android.keystore` is gitignored too, and must never be committed. It is a
signing credential.

## Toolchain

Bubblewrap needs JDK **17** specifically — not 21, which is what this machine
has for everything else, and `doctor` refuses anything newer. Both the JDK and a
second Android SDK live under `~/.bubblewrap/`, installed by Bubblewrap itself:

```bash
npx @bubblewrap/cli doctor
```

⚠ Run that **interactively the first time**. It asks whether you accept the
Android SDK terms and conditions, which is a licence agreement and therefore a
decision for the person whose machine it is. It cannot be answered from a script,
and it should not be.

Note also that a fully populated Android SDK already existed on this machine
(build-tools 34/35/36, platforms 33–36) and Bubblewrap rejected it, asking for a
folder layout it did not have. Rather than reshaping somebody's SDK to satisfy an
opaque check, we let Bubblewrap install its own under `~/.bubblewrap/android_sdk`.

## Building

```bash
cd apps/android
npx @bubblewrap/cli build
```

The first build creates the signing key and asks for a password. **That password
is yours** — pick it, keep it in a password manager, and do not put it in this
repo. Losing the upload key is recoverable through Play Console, but only
awkwardly.

## The assetlinks chicken-and-egg

A TWA only runs without a browser address bar if
`https://radioatlas.ru/.well-known/assetlinks.json` carries the SHA-256
fingerprint of the certificate the app is signed with. With Play App Signing —
the default — that is **Google's** certificate, not the local upload key, and its
fingerprint is only available **after the first upload to Play Console**.

So the order is fixed and cannot be shortened:

1. build locally → 2. Play Console account → 3. upload → 4. read the fingerprint
Google shows → 5. write `assetlinks.json` → 6. deploy the web app → 7. the
wrapper stops showing an address bar.

Skipping step 5 does not fail loudly. The app installs, opens and works — with a
URL bar across the top, which is the thing a TWA exists to remove.

**The delivery path for that file is already verified** (2026-08-27), which is
worth knowing because it is the part that breaks silently:

- Vite copies `public/.well-known/` into `dist` — dot-directories are not
  skipped. Checked by building with a probe file.
- Caddy does not intercept the `/.well-known/` prefix. Checked against
  production: a nonexistent path, a nonexistent path under `/.well-known/`,
  `/.well-known/assetlinks.json` and even `/.well-known/acme-challenge/test` all
  return the byte-identical SPA shell, so the prefix falls through to
  `try_files`, and `try_files` serves real files.

So dropping the finished file at `apps/webapp/public/.well-known/assetlinks.json`
will work. Nothing else is needed.

## Decisions worth knowing

**`packageId` is permanent.** `ru.radioatlas.app` can be changed freely right now
and **never again after the first Play upload** — a different id is a different
app, with its own listing, installs and reviews. If the product is renamed, that
is survivable: the store name, icon and description are all editable, and the id
only ever shows up in the Play URL.

**`enableNotifications` is false.** Turning it on adds a runtime permission
prompt, and the web app has nothing to deliver through it yet.

**`minSdkVersion` is 21.** Below that there is no Custom Tabs support worth
having, and the TWA falls back to a plain browser window.

## Before publishing, read PLAN.md

The store is not gated on this build. It is gated on whether playback survives
being backgrounded, which is the one thing a radio app is judged on and which a
TWA does not change — it is the same web engine. Those counters started on
2026-08-26 and need weeks.
