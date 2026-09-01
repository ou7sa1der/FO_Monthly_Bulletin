import { access, copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve("_site");
const publicFiles = ["index.html", "style.css", "app.js", "firebase-config.js"];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const filename of publicFiles) {
  await copyFile(path.resolve(filename), path.join(outputDir, filename));
}

const archiveDir = path.resolve("bulletins");
if (await access(archiveDir).then(() => true).catch(() => false)) {
  await cp(archiveDir, path.join(outputDir, "bulletins"), { recursive: true });
}

await writeFile(path.join(outputDir, ".nojekyll"), "", "utf8");
console.log(`Built GitHub Pages artifact in ${outputDir}.`);
