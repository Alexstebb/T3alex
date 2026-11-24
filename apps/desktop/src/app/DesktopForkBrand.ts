import { type ForkBrand, resolveForkBrand } from "../../../../scripts/lib/fork-brand.ts";

export { resolveForkBrand };
export type DesktopForkBrand = ForkBrand;

declare const __T3CODE_FORK_BRAND__: string | undefined;

/** The brand this bundle was packed with (T3CODE_FORK_BRAND); undefined in a normal build and in tests. */
export const bakedForkBrand = resolveForkBrand(
  typeof __T3CODE_FORK_BRAND__ === "undefined" ? undefined : __T3CODE_FORK_BRAND__,
);
