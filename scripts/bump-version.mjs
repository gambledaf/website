import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const versionFilePath = path.resolve(process.cwd(), 'version.json');

let versionData = { version: '1.0.0' };
if (fs.existsSync(versionFilePath)) {
    try {
        const raw = fs.readFileSync(versionFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            versionData = parsed;
        }
    } catch (error) {
        console.warn('[version] Failed to parse version.json, falling back to 1.0.0');
    }
}

const currentVersion = (typeof versionData.version === 'string' ? versionData.version : '1.0.0').trim();
const semverMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);

let nextVersion;
if (semverMatch) {
    const major = Number(semverMatch[1]);
    const minor = Number(semverMatch[2]);
    const patch = Number(semverMatch[3]) + 1;
    nextVersion = `${major}.${minor}.${patch}`;
} else {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    nextVersion = `0.0.${stamp}`;
}

versionData.version = nextVersion;
fs.writeFileSync(versionFilePath, `${JSON.stringify(versionData, null, 2)}\n`, 'utf8');

console.log(`[version] ${currentVersion} -> ${nextVersion}`);
