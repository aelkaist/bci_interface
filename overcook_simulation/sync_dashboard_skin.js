import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(projectDir, "public/smartfactory");
const dashboardDir = resolve(projectDir, "../analysis/dashboard/smartfactory");

await mkdir(dashboardDir, { recursive: true });
await cp(sourceDir, dashboardDir, { recursive: true, force: true });

console.log(`Synchronized dashboard replay skin from ${sourceDir}`);