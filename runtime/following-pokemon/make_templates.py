"""Generate empty, original I4 billboard containers. No game assets are copied."""
from pathlib import Path
import ndspy.texture

def generate():
    output = Path(__file__).resolve().parents[2] / 'src/assets/following'
    output.mkdir(exist_ok=True)
    for size in (32, 64):
        for count in (6, 8):
            resource = ndspy.texture.NSBTX()
            exponent = {32: 2, 64: 3}[size]
            params = (exponent << 4) | (exponent << 7) | (3 << 10) | 0x2000
            resource.textures = [(f'following{i}', ndspy.texture.Texture(
                0, 0, params, size | size << 11, bytes(size * size // 2), b'')) for i in range(count)]
            resource.palettes = [('following', ndspy.texture.Palette(0, 0, 0, bytes(32)))]
            (output / f'template-{size}-{count}.btx').write_bytes(resource.save())

if __name__ == '__main__':
    generate()
