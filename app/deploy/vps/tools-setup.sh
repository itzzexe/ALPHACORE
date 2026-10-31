#!/usr/bin/env bash
# The programs AlphaCore uses to read paper and recordings on this server.
#
#   sudo bash tools-setup.sh                      # tesseract (Arabic + English), poppler, ffmpeg, whisper.cpp + the small model
#   sudo WHISPER_MODEL_NAME=base bash tools-setup.sh   # a smaller, faster, less accurate speech model
#
# Everything installs from Ubuntu's own packages except whisper.cpp, which is
# built from source (about five minutes on two cores) into /opt/whisper.cpp.
# The speech model is downloaded once from Hugging Face. Nothing here opens a
# port or runs as a service: AlphaCore calls these programs itself, one at a
# time, through an allowlist.
#
# At the end AlphaCore is told where whisper and its model are. Re-running is safe.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/alphacore/crucible-core}"
WHISPER_DIR="${WHISPER_DIR:-/opt/whisper.cpp}"
MODEL="${WHISPER_MODEL_NAME:-small}"   # small reads Arabic far better than base, at about twice the time

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/4  tesseract (Arabic and English), poppler, ffmpeg"
apt-get update -q
apt-get install -yq tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng poppler-utils ffmpeg git cmake build-essential

say "2/4  whisper.cpp"
if [ ! -x "$WHISPER_DIR/build/bin/whisper-cli" ]; then
  [ -d "$WHISPER_DIR/.git" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
  cmake -S "$WHISPER_DIR" -B "$WHISPER_DIR/build" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF
  cmake --build "$WHISPER_DIR/build" -j"$(nproc)" --target whisper-cli
fi
echo "  $WHISPER_DIR/build/bin/whisper-cli"

say "3/4  the speech model ($MODEL)"
MODEL_FILE="$WHISPER_DIR/models/ggml-$MODEL.bin"
if [ ! -s "$MODEL_FILE" ]; then
  bash "$WHISPER_DIR/models/download-ggml-model.sh" "$MODEL"
fi
ls -la "$MODEL_FILE"

say "4/4  telling AlphaCore where they are"
cd "$APP_DIR"
node --experimental-sqlite --input-type=module -e "
  const { setSetting } = await import('./src/settings.js');
  setSetting('WHISPER_BIN', '$WHISPER_DIR/build/bin/whisper-cli');
  setSetting('WHISPER_MODEL', '$MODEL_FILE');
  console.log('  WHISPER_BIN and WHISPER_MODEL set');
"
tesseract --list-langs 2>/dev/null | grep -E '^(ara|eng)$' | sed 's/^/  tesseract: /'
say "Done. Paper intake and recordings now read on this machine."
