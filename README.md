# Notebook

A Windows notebook for photos, videos, notes and boards, with an Android companion and direct home-network sync.

Current source versions: **Windows 2.5.4** and **Android 0.15.1 (39)**.

## Project map

- `main/`: Electron main process, local library, phone sync server, Pinterest integration and optional local recognition.
- `renderer/`: Windows interface, using plain HTML, CSS and JavaScript.
- `phone/`: Android app, using Java and a bundled WebView interface. Package: `com.mani.notebook`; min SDK 28, compile/target SDK 37.
- `scripts/`: checks and development utilities.
- `docs/SYNC.md`: the phone/PC protocol contract.
- `GUIDE.md`: user guide.
- `phone/README.md`: Android build, installation and testing instructions.
- `AGENTS.md`: repository conventions and checks for coding agents.
- `promo/`: promotional composition source; rendered output is excluded.

## Windows development

Install Node.js and use `npm ci` to restore the locked dependencies. Start the app with:

```powershell
node node_modules/electron/cli.js .
```

Build the Windows installer with:

```powershell
node node_modules/electron-builder/cli.js --win nsis
```

The original checkout path contains `&`, so the project uses direct Node commands instead of `npm run`. See `AGENTS.md` for the full verification instructions. Core library and sync checks are:

```powershell
node scripts/test-library.js
node scripts/test-sync.js
```

Optional recognition models and downloader tools live outside the repository in `D:\Notebook Tools` (or the `NOTEBOOK_TOOLS` directory). They are not required to inspect the app or its sync architecture. See `main/recognise.js`, `main/downloader.js` and the feature documentation for their use.

## Data and connection boundaries

The PC runs a private-network HTTP server, normally on TCP 47821, with UDP discovery on 47822. The phone initiates requests using an existing QR/code pairing and bearer-token mechanism. Traffic currently uses unencrypted HTTP on the home network; see `docs/SYNC.md` for the complete contract.

The repository contains application source, bundled assets, tests and documentation. Personal libraries, browser sessions, pairing credentials, installed dependencies, SDKs, models, generated test output and installers are not included.

Gallery imports currently copy selected files into Notebook's own library. Notebook's Bin manages those copies. **Browsing and trashing the phone's original Samsung Gallery media from Windows is a proposed feature, not an implemented capability.**
