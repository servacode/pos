"""Every logo file of the app comes from ONE picture: scripts/brand/serva-logo-source.png.

To change the logo everywhere: replace that file (keep the name), then run
    pnpm brand
(or: python scripts/brand/build.py). It rewrites, from that one picture and without redrawing it:
  apps/web/public/brand/serva-logo.webp, serva-logo@2x.webp  the logo (Logo component, landing header/footer)
  apps/web/public/brand/serva-mark.webp                      the square crop (LogoMark, AppIcon, folded sidebar)
  apps/web/public/favicon.svg, favicon-48.png                the browser tab icon
  apps/web/public/icon-192.png, icon-512.png                 the installed app icons
  apps/web/public/apple-touch-icon.png                       the iPhone home-screen icon
The square crop is the centre of the left part of the picture (where the «S» sits); set MARK_BOX below if a
new picture puts its mark elsewhere. Needs Pillow (pip install pillow).
"""
import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts' / 'brand' / 'serva-logo-source.png'
PUBLIC = ROOT / 'apps' / 'web' / 'public'
# The square around the mark, as fractions of the picture (left, top, size): for the current picture the «S».
MARK_BOX = (0.0716, 0.1758, 0.4688)


def rounded(img: Image.Image, radius: float) -> Image.Image:
    img = img.convert('RGBA')
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], round(img.width * radius), fill=255)
    img.putalpha(mask)
    return img


def main() -> None:
    src = Image.open(SOURCE).convert('RGB')
    w, h = src.size
    (PUBLIC / 'brand').mkdir(parents=True, exist_ok=True)
    for width, name in ((480, 'serva-logo.webp'), (960, 'serva-logo@2x.webp')):
        src.resize((width, round(width * h / w)), Image.LANCZOS).save(PUBLIC / 'brand' / name, quality=95, method=6)
    left, top, size = MARK_BOX
    side = round(size * w)
    x, y = round(left * w), round(top * h)
    mark = src.crop((x, y, x + side, y + side))
    mark.resize((256, 256), Image.LANCZOS).save(PUBLIC / 'brand' / 'serva-mark.webp', quality=92, method=6)
    rounded(mark.resize((192, 192), Image.LANCZOS), 0.22).save(PUBLIC / 'icon-192.png', optimize=True)
    rounded(mark.resize((512, 512), Image.LANCZOS), 0.22).save(PUBLIC / 'icon-512.png', optimize=True)
    mark.resize((180, 180), Image.LANCZOS).save(PUBLIC / 'apple-touch-icon.png', optimize=True)
    rounded(mark.resize((48, 48), Image.LANCZOS), 0.22).save(PUBLIC / 'favicon-48.png', optimize=True)
    tab = io.BytesIO()
    mark.resize((64, 64), Image.LANCZOS).save(tab, 'PNG', optimize=True)
    data = base64.b64encode(tab.getvalue()).decode()
    (PUBLIC / 'favicon.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><clipPath id="r"><rect width="64" height="64" rx="14"/>'
        f'</clipPath><image width="64" height="64" clip-path="url(#r)" href="data:image/png;base64,{data}"/></svg>\n',
        encoding='utf-8',
    )
    print('logo files rewritten from', SOURCE.relative_to(ROOT))


if __name__ == '__main__':
    main()
