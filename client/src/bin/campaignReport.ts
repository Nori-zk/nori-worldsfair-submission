#!/usr/bin/env node
// Writes OUT/report.md and OUT/dashboard.html from a campaign's events.
// Usage: campaign-report <config.json> <OUT dir>
import { loadConfig, loadEnv } from '../keeper/config.js';
import { Keeper } from '../keeper/keeper.js';
import { writeReport } from '../scenarios/report.js';

const [configPath, outDir] = process.argv.slice(2);
if (!configPath || !outDir) {
    console.error('Usage: campaign-report <config.json> <OUT dir>');
    process.exit(1);
}
loadEnv();
const keeper = await Keeper.connect(loadConfig(configPath));
await writeReport(outDir, keeper);
console.log(`Wrote ${outDir}/report.md and ${outDir}/dashboard.html`);
process.exit(0);
