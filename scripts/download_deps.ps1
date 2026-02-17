# download_deps.ps1 — Fetch and bundle all romanization library dependencies
# Run from repo root: .\scripts\download_deps.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LibDir = Join-Path $RepoRoot "extension\content\lib"
$DictDir = Join-Path $RepoRoot "extension\dict"
$TempDir = Join-Path $RepoRoot "_build_temp"

Write-Host "=== Spotify Karaoke - Dependency Download ===" -ForegroundColor Cyan
Write-Host "Lib dir:  $LibDir"
Write-Host "Dict dir: $DictDir"
Write-Host ""

# Ensure directories exist
New-Item -ItemType Directory -Force -Path $LibDir | Out-Null
New-Item -ItemType Directory -Force -Path $DictDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# ─────────────────────────────────────────────
# 1. Install npm packages into temp dir
# ─────────────────────────────────────────────
Write-Host "[1/5] Installing npm packages..." -ForegroundColor Yellow
Push-Location $TempDir

# Create a minimal package.json
@"
{ "private": true, "type": "commonjs" }
"@ | Out-File -FilePath "package.json" -Encoding utf8

npm install --save `
    "@romanize/korean@^0.1.3" `
    "@sglkc/kuroshiro@^1.0.1" `
    "@sglkc/kuroshiro-analyzer-kuromoji@^1.0.1" `
    "@sglkc/kuromoji@^1.1.0" `
    "pinyin-pro@^3.27.0" `
    "arabic-services@^1.0.8" `
    esbuild

Pop-Location
Write-Host "  Done." -ForegroundColor Green

# ─────────────────────────────────────────────
# 2. Bundle libraries as IIFE globals via esbuild
# ─────────────────────────────────────────────
Write-Host "[2/5] Bundling libraries with esbuild..." -ForegroundColor Yellow

$esbuild = Join-Path $TempDir "node_modules\.bin\esbuild.cmd"

# --- Korean ---
$KoreanEntry = Join-Path $TempDir "korean_entry.js"
@"
const { romanize } = require('@romanize/korean');
window.koreanRomanize = { romanize };
"@ | Out-File -FilePath $KoreanEntry -Encoding utf8

& $esbuild $KoreanEntry --bundle --minify --format=iife --outfile="$LibDir\korean-romanize.min.js" --platform=browser
Write-Host "  korean-romanize.min.js" -ForegroundColor Green

# --- Pinyin Pro ---
$PinyinEntry = Join-Path $TempDir "pinyin_entry.js"
@"
const { pinyin, html } = require('pinyin-pro');
window.pinyinPro = { pinyin, html };
"@ | Out-File -FilePath $PinyinEntry -Encoding utf8

& $esbuild $PinyinEntry --bundle --minify --format=iife --outfile="$LibDir\pinyin-pro.min.js" --platform=browser
Write-Host "  pinyin-pro.min.js" -ForegroundColor Green

# --- Kuroshiro + Analyzer ---
$KuroshiroEntry = Join-Path $TempDir "kuroshiro_entry.js"
@"
const Kuroshiro = require('@sglkc/kuroshiro');
const KuromojiAnalyzer = require('@sglkc/kuroshiro-analyzer-kuromoji');
window.Kuroshiro = Kuroshiro.default || Kuroshiro;
window.KuromojiAnalyzer = KuromojiAnalyzer.default || KuromojiAnalyzer;
"@ | Out-File -FilePath $KuroshiroEntry -Encoding utf8

& $esbuild $KuroshiroEntry --bundle --minify --format=iife --outfile="$LibDir\kuroshiro.min.js" --platform=browser --external:path --external:fs
Write-Host "  kuroshiro.min.js" -ForegroundColor Green

# --- Arabic Services ---
$ArabicEntry = Join-Path $TempDir "arabic_entry.js"
@"
const ArabicServices = require('arabic-services');
window.ArabicServices = ArabicServices.default || ArabicServices;
"@ | Out-File -FilePath $ArabicEntry -Encoding utf8

& $esbuild $ArabicEntry --bundle --minify --format=iife --outfile="$LibDir\arabic-services.min.js" --platform=browser
Write-Host "  arabic-services.min.js" -ForegroundColor Green

# ─────────────────────────────────────────────
# 3. Download CDN-available libraries
# ─────────────────────────────────────────────
Write-Host "[3/5] Downloading CDN libraries..." -ForegroundColor Yellow

# Cyrillic to Translit
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/cyrillic-to-translit-js@3.2.1/dist/bundle.js" `
    -OutFile "$LibDir\cyrillic-to-translit.min.js" -UseBasicParsing
Write-Host "  cyrillic-to-translit.min.js" -ForegroundColor Green

# Sanscript (Indic transliteration) — root-level file, not in /dist
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@indic-transliteration/sanscript@1.3.3/sanscript.js" `
    -OutFile "$LibDir\sanscript.min.js" -UseBasicParsing
Write-Host "  sanscript.min.js" -ForegroundColor Green

# Transliteration (yf-hk fork) — already exists, skip if present
if (-not (Test-Path "$LibDir\transliteration.min.js")) {
    Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/transliteration@2/dist/browser/bundle.umd.min.js" `
        -OutFile "$LibDir\transliteration.min.js" -UseBasicParsing
    Write-Host "  transliteration.min.js (fresh download)" -ForegroundColor Green
} else {
    Write-Host "  transliteration.min.js (already exists)" -ForegroundColor DarkGray
}

# ─────────────────────────────────────────────
# 4. Copy kuromoji dictionary files
# ─────────────────────────────────────────────
Write-Host "[4/5] Copying kuromoji dictionary files..." -ForegroundColor Yellow

$KuromojiDictSrc = Join-Path $TempDir "node_modules\@sglkc\kuromoji\dict"
if (Test-Path $KuromojiDictSrc) {
    Copy-Item -Path "$KuromojiDictSrc\*" -Destination $DictDir -Force
    $dictCount = (Get-ChildItem $DictDir).Count
    Write-Host "  Copied $dictCount dict files to extension/dict/" -ForegroundColor Green
} else {
    Write-Host "  WARNING: kuromoji dict dir not found at $KuromojiDictSrc" -ForegroundColor Red
}

# ─────────────────────────────────────────────
# 5. Clean up
# ─────────────────────────────────────────────
Write-Host "[5/5] Cleaning up temp directory..." -ForegroundColor Yellow
Remove-Item -Recurse -Force $TempDir
Write-Host "  Done." -ForegroundColor Green

Write-Host ""
Write-Host "=== All dependencies downloaded successfully! ===" -ForegroundColor Cyan
Write-Host "Libraries in: $LibDir"
Write-Host "Dict files in: $DictDir"
