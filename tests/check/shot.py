import asyncio, os
from playwright.async_api import async_playwright
async def main():
    root=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
    url='file:///'+os.path.join(root,'index.html').replace(os.sep,'/')
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for scheme,name in [('dark','dark'),('light','light')]:
            pg=await b.new_page(viewport={'width':1440,'height':1000}, color_scheme=scheme)
            await pg.goto(url); await pg.wait_for_timeout(800)
            await pg.screenshot(path=os.path.join(root,'tests','check',f'final_{name}.png'), full_page=True)
            await pg.close()
        await b.close()
asyncio.run(main())
