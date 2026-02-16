$baseUrl = "https://raw.githubusercontent.com/takuyaa/kuromoji.js/master/dict/"
$dictDir = "extension/content/dict"
$libDir = "extension/content/lib"

# Ensure directories exist
New-Item -ItemType Directory -Force -Path $dictDir
New-Item -ItemType Directory -Force -Path $libDir

# Libraries
$libs = @{
    "kuroshiro.min.js" = "https://unpkg.com/kuroshiro@1.2.0/dist/kuroshiro.min.js"
    "kuroshiro-analyzer-kuromoji.min.js" = "https://unpkg.com/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js"
    "aromanize.js" = "https://unpkg.com/aromanize@0.1.5/aromanize.js"
}

foreach ($name in $libs.Keys) {
    echo "Downloading $name..."
    Invoke-WebRequest -Uri $libs[$name] -OutFile "$libDir/$name"
}

# Dictionary Files
$dicts = @(
    "base.dat.gz",
    "check.dat.gz",
    "tid.dat.gz",
    "tid_map.dat.gz",
    "tid_pos.dat.gz",
    "unk.dat.gz",
    "unk_map.dat.gz",
    "unk_pos.dat.gz",
    "unk_char.dat.gz",
    "unk_compat.dat.gz",
    "unk_invoke.dat.gz"
)

foreach ($file in $dicts) {
    echo "Downloading $file..."
    Invoke-WebRequest -Uri "$baseUrl$file" -OutFile "$dictDir/$file"
}

echo "Download complete."
