"""Turns the phone frames from `npm run docs:screenshots` into docs/images/run-on-phone.gif.

Needs Pillow:  python3 -m pip install pillow  (a virtualenv is fine), then
    python3 docs/screenshots/make-gif.py
"""

from pathlib import Path

from PIL import Image

here = Path(__file__).parent
frames = sorted((here / "frames").glob("*.png"))
if not frames:
    raise SystemExit("No frames: run `npm run docs:screenshots` first.")

width = 390  # one CSS pixel per GIF pixel on an iPhone-sized screen
images = []
for path in frames:
    image = Image.open(path).convert("RGB")
    image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    images.append(image.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))

# Linger on the first and the last frame.
durations = [1800] + [1400] * (len(images) - 2) + [3000]
out = here.parent / "images" / "run-on-phone.gif"
images[0].save(out, save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=True)
print(f"{out} ({out.stat().st_size // 1024} KB, {len(images)} frames)")
