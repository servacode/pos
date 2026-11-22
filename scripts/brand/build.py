"""Every logo file of the app comes from ONE file: scripts/brand/serva-logo-source.svg (the owner's logo).

To change the logo everywhere: replace that file (keep the name), then run
    pnpm brand
(or: python scripts/brand/build.py). It writes, from that one file and without redrawing it:
  apps/web/public/brand/serva-logo.svg   the logo as it is (Logo component, landing header and footer)
  apps/web/public/brand/serva-mark.svg   the same drawing cut to the square around the «S» (LogoMark, AppIcon,
                                         the folded sidebar)
  apps/web/public/favicon.svg            the browser tab icon (the mark)
  apps/web/public/favicon-48.png, icon-192.png, icon-512.png, apple-touch-icon.png   the mark as pictures,
                                         drawn by headless Chrome (set CHROME to its path if it is elsewhere)
MARK_BOX is the square of the «S» in the drawing's own units and CUT the part of it given to the letter «e»
next to the «S»: set them again if a new logo puts its mark elsewhere.
"""
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scripts' / 'brand' / 'serva-logo-source.svg'
PUBLIC = ROOT / 'apps' / 'web' / 'public'
MARK_BOX = (100, 190, 720)  # x, y, side
CUT = (722, 500)  # from this x to the right, and below this y, belongs to «erva»
CHROME = os.environ.get('CHROME', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
TILE = '#ffffff'  # the icons' ground, so the blue and green read on any home screen


def inner(svg: str) -> str:
    """The drawing inside the outer <svg>, without the XML header and the title."""
    body = svg[svg.index('>', svg.index('<svg')) + 1 : svg.rindex('</svg>')]
    return re.sub(r'<title>.*?</title>', '', body, flags=re.S).strip()


def mark_svg(svg: str, ground: str | None) -> str:
    x, y, side = MARK_BOX
    cx, cy = CUT
    keep = f'{x},{y} {x + side},{y} {x + side},{cy} {cx},{cy} {cx},{y + side} {x},{y + side}'
    tile = f'<rect x="{x}" y="{y}" width="{side}" height="{side}" rx="{side * 0.22:.0f}" fill="{ground}"/>' if ground else ''
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {side} {side}">{tile}'
        f'<clipPath id="m"><polygon points="{keep}"/></clipPath><g clip-path="url(#m)">{inner(svg)}</g></svg>\n'
    )


def picture(svg: str, size: int, out: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / 'icon.svg').write_text(svg, encoding='utf-8')
        page = Path(tmp) / 'icon.html'
        page.write_text(
            '<html><body style="margin:0;background:transparent">'
            f'<img src="icon.svg" width="{size}" height="{size}" style="display:block"></body></html>',
            encoding='utf-8',
        )
        subprocess.run(
            [CHROME, '--headless', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
             f'--window-size={size},{size}', f'--screenshot={out}', page.as_uri()],
            check=True, capture_output=True,
        )


def main() -> None:
    svg = SOURCE.read_text(encoding='utf-8')
    (PUBLIC / 'brand').mkdir(parents=True, exist_ok=True)
    (PUBLIC / 'brand' / 'serva-logo.svg').write_text(svg, encoding='utf-8')
    (PUBLIC / 'brand' / 'serva-mark.svg').write_text(mark_svg(svg, None), encoding='utf-8')
    tiled = mark_svg(svg, TILE)
    (PUBLIC / 'favicon.svg').write_text(tiled, encoding='utf-8')
    for size, name in ((48, 'favicon-48.png'), (192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')):
        picture(tiled, size, PUBLIC / name)
    print('logo files rewritten from', SOURCE.relative_to(ROOT))


if __name__ == '__main__':
    main()
