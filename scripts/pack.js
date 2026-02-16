const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Simple zip script using system zip command (available in GitHub Actions ubuntu-latest)
// Only zips the 'extension' folder content into 'extension.zip'

try {
    console.log('Packing extension...');
    // We use the zip command which is standard in linux environments (GitHub Actions)
    // -r: recursive
    // -j: junk paths (store just filenames)? No, we want the structure relative to extension/
    // But actually, usually extensions are zipped so that manifest.json is at root of zip.

    // Navigate to extension dir and zip everything to ../extension.zip
    execSync('cd extension && zip -r ../extension.zip ./*');

    console.log('✅ Created extension.zip');
} catch (error) {
    console.error('❌ Failed to pack extension:', error.message);
    process.exit(1);
}
