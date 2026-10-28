#!/usr/bin/env python3
"""Builds the claude.ai-hosted copy of the site into dist/hosted/.

On claude.ai the page a link opens is the only one that gets the built-in database,
so the hosted copy is arranged around the app:
  index.html         the app (root page; uses the page's database for backup, groups, insights)
  about/index.html   the landing page, with links pointed back at the app
  assets/...         screenshots used by the landing page

The root page is written without <!doctype>, <html>, <head> or <body>: claude.ai wraps it.
Run from the repo root:  python3 tools/build_hosted.py
"""
import pathlib, re, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist' / 'hosted'

def inner(html):
    head = html.split('<head>', 1)[1].split('</head>', 1)[0]
    body = html.split('<body>', 1)[1].rsplit('</body>', 1)[0]
    keep = [l for l in head.splitlines() if not re.search(r'charset|name="viewport"', l)]
    return '\n'.join(keep) + '\n' + body

def replace(text, old, new):
    if old not in text:
        raise SystemExit(f'build_hosted: expected text not found: {old!r}')
    return text.replace(old, new)

def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / 'about').mkdir(parents=True)

    app = (ROOT / 'app' / 'index.html').read_text(encoding='utf-8')
    app = replace(app, "const ABOUT_URL = '../index.html';", "const ABOUT_URL = 'about/index.html';")
    app = replace(app, "'../mentor/index.html'", "'#mentor'")
    app = replace(app, "'../insights/index.html'", "'#insights'")
    (OUT / 'index.html').write_text(inner(app), encoding='utf-8')

    land = (ROOT / 'index.html').read_text(encoding='utf-8')
    for old, new in [('href="app/index.html#dashboard"', 'href="../#dashboard"'),
                     ('href="app/index.html"', 'href="../"'),
                     ('href="mentor/index.html"', 'href="../#mentor"'),
                     ('href="insights/index.html"', 'href="../#insights"'),
                     ('src="assets/', 'src="../assets/')]:
        land = replace(land, old, new)
    (OUT / 'about' / 'index.html').write_text(land, encoding='utf-8')

    shutil.copytree(ROOT / 'assets', OUT / 'assets', ignore=shutil.ignore_patterns('portal.*'))
    print('built', OUT)
    for p in sorted(OUT.rglob('*')):
        if p.is_file():
            print(' ', p.relative_to(OUT))

if __name__ == '__main__':
    main()
