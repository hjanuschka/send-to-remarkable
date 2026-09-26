import { build } from "esbuild";
import { copyFile, cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/background.ts", "src/content.ts", "src/options.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: "dist",
  logLevel: "info",
});

await copyFile("manifest.json", "dist/manifest.json");
await copyFile("options.html", "dist/options.html");
await cp("icons", "dist/icons", { recursive: true });
console.log("dist/ ready - load it via chrome://extensions -> Load unpacked");
