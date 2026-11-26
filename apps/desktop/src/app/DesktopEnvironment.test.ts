import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import { resolveForkBrand } from "./DesktopForkBrand.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) => DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layerEnvironment(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("gives a fork-branded build its own name, ids and T3 home", () =>
    Effect.gen(function* () {
      const branded = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        homeDirectory: "/Users/alice",
        forkBrand: resolveForkBrand("alex"),
      });
      assert.equal(branded.displayName, "T3 Code Alex");
      assert.equal(branded.branding.baseName, "T3 Code Alex");
      assert.equal(branded.appUserModelId, "com.t3tools.t3code.alex");
      assert.equal(branded.baseDir, "/Users/alice/.t3-alex");
      assert.equal(branded.stateDir, "/Users/alice/.t3-alex/userdata");
      assert.isTrue(branded.skipProtocolRegistration);
      assert.equal(branded.linuxDesktopEntryName, "com.t3tools.t3code.alex.desktop");

      const official = yield* makeEnvironment({ platform: "win32", isPackaged: true });
      assert.equal(official.displayName, "T3 Code (Beta)");
      assert.equal(official.appUserModelId, "com.t3tools.t3code");
      assert.equal(official.baseDir, "/Users/alice/.t3");
      assert.isFalse(official.skipProtocolRegistration);
      assert.isUndefined(official.forkBrand);
    }),
  );

  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.t3/dev");
      assert.equal(production.stateDir, "/Users/alice/.t3/userdata");
    }),
  );
});
