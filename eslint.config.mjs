// Flat config for ESLint 9. `next lint` is deprecated and, with no config
// present, drops into an interactive prompt — which is what made the CI
// lint step hang. eslint-config-next 15 still ships the legacy shareable
// config, so it is loaded through FlatCompat.
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
});

export default [
  { ignores: [".next/**", "node_modules/**", "src/**", "scripts/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
