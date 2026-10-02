import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const API_TARGET = process.env.API_TARGET || (process.env.VERCEL ? "" : "http://localhost:8787");

/**
 * Anything Vite exposes to the browser must be non-secret. This fails the
 * build instead of shipping a provider key inside the bundle.
 */
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|APIKEY)/i;
const OPENROUTER_KEY = /^sk-or-(?:v1-)?[A-Za-z0-9_-]{16,}/;

function secretGuard(mode) {
  const exposed = loadEnv(mode, process.cwd(), "VITE_");

  const suspect = Object.entries(exposed)
    .filter(([, v]) => v && (OPENROUTER_KEY.test(v) || (SECRET_NAME.test(v) && v.length > 12)))
    .map(([k]) => k);

  // A VITE_ var that merely *contains* a real secret from the environment is
  // just as bad as one that is named like it.
  const secrets = Object.entries(process.env)
    .filter(([k, v]) => !k.startsWith("VITE_") && SECRET_NAME.test(k) && v && v.length >= 16)
    .map(([, v]) => v);
  for (const [name, value] of Object.entries(exposed)) {
    if (value && secrets.some(s => value.includes(s))) suspect.push(name);
  }

  if (suspect.length) {
    throw new Error(
      `\n  Refusing to build: ${[...new Set(suspect)].join(", ")} would be inlined into the browser bundle.\n` +
      `  VITE_* variables are public. Move provider credentials to server/.env, which only Node reads.\n`,
    );
  }
}

export default defineConfig(({ mode }) => {
  secretGuard(mode);

  return {
    plugins: [react(), viteSingleFile()],
    server: {
      port: 5173,
      proxy: API_TARGET ? {
        "/api": { target: API_TARGET, changeOrigin: true },
      } : undefined,
    },
    build: {
      target: "esnext",
      assetsInlineLimit: 100000000,
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: true,
        },
      },
    },
  };
});
