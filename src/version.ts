declare const __CLIDEV_VERSION__: string | undefined;

/** Injected by tsup `define`; falls back when running through tsx. */
export const VERSION =
  typeof __CLIDEV_VERSION__ === "string" && __CLIDEV_VERSION__.length > 0
    ? __CLIDEV_VERSION__
    : "0.1.0";
