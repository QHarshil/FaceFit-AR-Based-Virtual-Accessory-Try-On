#!/usr/bin/env bash
# Records a webcam clip for the replay harness (macOS, AVFoundation).
# Usage: eval/fixtures/record.sh <name> [seconds]
# CRF 12 keeps sensor noise close to the live feed, so jitter measured on the
# replay is comparable to jitter on a live camera.
set -euo pipefail

name="${1:?usage: record.sh <name> [seconds]}"
seconds="${2:-12}"
device="${FACEFIT_CAMERA:-0}"
out_dir="$(cd "$(dirname "$0")" && pwd)/recordings"
mkdir -p "$out_dir"

echo "Recording ${seconds}s from camera ${device} in 3s: $out_dir/$name.mp4"
sleep 3
ffmpeg -hide_banner -loglevel warning -y \
  -f avfoundation -framerate 30 -video_size 1280x720 -pixel_format uyvy422 -i "${device}:none" \
  -t "$seconds" -c:v libx264 -preset slow -crf 12 -pix_fmt yuv420p \
  "$out_dir/$name.mp4"
echo "Wrote $out_dir/$name.mp4"
