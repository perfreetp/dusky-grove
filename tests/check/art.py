import asyncio, os
from playwright.async_api import async_playwright

async def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    body = open(os.path.join(root, 'artifact.html'), encoding='utf-8').read()
    hdr = ('<!doctype html><html><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
           '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);'
           'padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
           'img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n')
    wrap = os.path.join(root, 'tests', 'check', '_wrapped.html')
    open(wrap, 'w', encoding='utf-8').write(hdr + body + '\n</body></html>')
    url = 'file:///' + wrap.replace(os.sep, '/')
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(url)
        await pg.wait_for_timeout(900)
        print('artifact errors:', errs[:3] or 'none')
        print('scrollWidth:', await pg.evaluate("() => document.documentElement.scrollWidth"))
        print('stage:', await pg.evaluate("() => window.__stage ? 'mounted' : 'missing'"))
        await pg.screenshot(path=os.path.join(root, 'tests', 'check', 'artifact_view.png'), full_page=True)
        await b.close()

asyncio.run(main())
