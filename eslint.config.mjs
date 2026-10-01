import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /*
    `vendor/` is somebody else's code, copied verbatim so a refresh is a
    re-copy rather than a merge (see vendor/arkplay-engine/README.md). Linting
    it would ask us to EDIT it, which is the one thing that must not happen —
    and its rules are ours, not theirs: the renderer has a function called
    `cover` that calls one called `use`, which the React hook rules read as a
    hook in a non-component and fail on.
  */
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "vendor/**"]),
]);

export default eslintConfig;
