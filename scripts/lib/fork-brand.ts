/**
 * Local fork: a desktop build made with `T3CODE_FORK_BRAND=<id>` installs and runs beside the
 * official app, with its own name, ids and data, and never updates itself from upstream. The
 * build script reads the brand from the environment; the desktop bundle bakes it in at pack time
 * (apps/desktop/src/app/DesktopForkBrand.ts).
 */

export interface ForkBrand {
  readonly productName: string;
  /** electron-builder appId and the Windows AppUserModelID; also names the installer's GUID. */
  readonly appId: string;
  /** Staged package name; a per-user NSIS install goes to %LOCALAPPDATA%\Programs\<packageName>. */
  readonly packageName: string;
  readonly artifactPrefix: string;
  /** Electron userData folder under the platform's app-data directory. */
  readonly userDataDirName: string;
  /** Default T3 home under the user's home directory (the official app uses `.t3`). */
  readonly t3HomeDirName: string;
}

const FORK_BRANDS: Readonly<Record<string, ForkBrand>> = {
  alex: {
    productName: "T3 Code Alex",
    appId: "com.t3tools.t3code.alex",
    packageName: "t3code-alex",
    artifactPrefix: "T3-Code-Alex",
    userDataDirName: "t3code-alex",
    t3HomeDirName: ".t3-alex",
  },
};

export function resolveForkBrand(name: string | undefined): ForkBrand | undefined {
  const key = name?.trim().toLowerCase();
  if (!key) return undefined;
  const brand = FORK_BRANDS[key];
  if (!brand) {
    throw new Error(
      `Unknown T3CODE_FORK_BRAND '${name}'. Known brands: ${Object.keys(FORK_BRANDS).join(", ")}.`,
    );
  }
  return brand;
}
