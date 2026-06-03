// Single source of truth for the version string the UI shows.
// Reads from package.json so bumps are one edit (plus tauri.conf.json
// for the installer side — those are kept in lockstep by the
// `chore: bump version markers` workflow).
//
// Vite supports JSON imports natively in ESM mode (our `"type":
// "module"` package). The import is statically analyzable and the
// version literal gets baked into the bundle — no runtime fetch.

import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;
