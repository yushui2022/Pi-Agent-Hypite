#!/usr/bin/env bash
# Optional Windows/WSL acceleration: every byte is backed by a G-drive cache image.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CACHE=/mnt/g/DevCache/Temp/pi-agent-hypite/workers-p0
IMAGE="$CACHE/build-cache.ext4"
MOUNT=/mnt/pi-studio-p0-build
mkdir -p "$CACHE" "$MOUNT"
# Never reformat an existing file/device. The only mkfs target is this newly created cache file.
if [[ ! -e "$IMAGE" ]]; then
  truncate -s 8G "$IMAGE"
  mkfs.ext4 -q -F "$IMAGE"
fi
if mountpoint -q "$MOUNT"; then
  echo 'Build mount is already in use; finish that build before retrying.' >&2
  exit 1
fi
mount -o loop "$IMAGE" "$MOUNT"
finish() {
  mkdir -p "$CACHE/source-build/logs"
  for entry in logs/build.log ffmpeg/ffbuild/config.log x264/config.log; do
    if [[ -f "$MOUNT/$entry" ]]; then cp "$MOUNT/$entry" "$CACHE/source-build/logs/fast-${entry//\//-}"; fi
  done
  cd /
  sync
  umount "$MOUNT"
}
trap finish EXIT
if [[ -f "$CACHE/build-transfer.tar" && ! -d "$MOUNT/emsdk" ]]; then
  tar -xf "$CACHE/build-transfer.tar" -C "$MOUNT"
fi
export P0_BUILD_ROOT="$MOUNT" P0_NATIVE_GIT=1
bash "$SCRIPT_DIR/build-source.sh"
mkdir -p "$CACHE/source-build/release" "$CACHE/source-build/logs"
cp -a "$MOUNT/release/." "$CACHE/source-build/release/"
cp "$MOUNT/logs/build.log" "$CACHE/source-build/logs/fast-build.log"
echo "Verified build artifacts exported to $CACHE/source-build/release"
