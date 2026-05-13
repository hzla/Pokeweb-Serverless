#!/usr/bin/env python3

"""
Pixel-art upscaler for AI animation pipelines.

Purpose:
96x96 sprite
→ upscale 4x/8x with nearest-neighbor
→ feed into AI animation
→ later downscale back to 96x96

Why nearest-neighbor?
- preserves hard pixel edges
- preserves palette structure
- avoids blur/anti-aliasing
- ideal for pixel-art AI workflows

Usage:
python upscale_sprite.py input.png

Optional:
python upscale_sprite.py input.png 8
"""

from PIL import Image
import sys
import os

# -----------------------------
# CONFIG
# -----------------------------

DEFAULT_SCALE = 8

# -----------------------------
# ARGUMENTS
# -----------------------------

if len(sys.argv) < 2:
    print("Usage: python upscale_sprite.py input.png [scale]")
    sys.exit(1)

input_path = sys.argv[1]

if len(sys.argv) >= 3:
    scale = int(sys.argv[2])
else:
    scale = DEFAULT_SCALE

# -----------------------------
# LOAD IMAGE
# -----------------------------

img = Image.open(input_path).convert("RGBA")

w, h = img.size

# -----------------------------
# UPSCALE
# -----------------------------

upscaled = img.resize(
    (w * scale, h * scale),
    Image.NEAREST
)

# -----------------------------
# OUTPUT PATH
# -----------------------------

base, ext = os.path.splitext(input_path)

output_path = f"{base}_{scale}x.png"

# -----------------------------
# SAVE
# -----------------------------

upscaled.save(output_path)

print(f"Saved: {output_path}")
print(f"{w}x{h} -> {w*scale}x{h*scale}")