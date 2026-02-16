const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Script to pack extension for Chrome and Firefox
// Usages: node scripts/pack.js [version]

const version = process.argv[2] || 'unknown';

try {
    console.log('Packing extension for Chrome and Firefox...');

    // Create output directory if it doesn't exist
    // actually we just output to root for simplicity in CI

    // Chrome (v3)
    const chromeZip = `spotify-karaoke-${version}-chrome.zip`;
    console.log(`Creating ${chromeZip}...`);
    // -r recursive, -j junk paths (no), but we want relative to extension/
    // zip target source
    execSync(`cd extension && zip -r ../${chromeZip} ./*`);

    // Firefox (v2/v3) - currently identical source, but we name it distinct
    // In future, we might copy extension/ to extension-firefox/, modify manifest, then zip.
    const firefoxZip = `spotify-karaoke-${version}-firefox.zip`;
    console.log(`Creating ${firefoxZip}...`);
    execSync(`cd extension && zip -r ../${firefoxZip} ./*`);

    console.log('✅ Created release artifacts.');
} catch (error) {
    console.error('❌ Failed to pack extension:', error.message);
    process.exit(1);
}
