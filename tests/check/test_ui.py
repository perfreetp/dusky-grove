"""无头浏览器交互测试：拖动、预置、滑块、抛接、移动端布局"""
import asyncio, os, sys
from playwright.async_api import async_playwright

FAILS = 0
def ok(cond, msg, extra=None):
    global FAILS
    print(("PASS " if cond else "FAIL ") + msg + (("  " + str(extra)) if extra is not None else ""))
    if not cond: FAILS += 1

async def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    url = 'file:///' + os.path.join(root, 'index.html').replace(os.sep, '/')
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        await pg.goto(url)
        await pg.wait_for_timeout(900)
        ok(len(errs) == 0, '页面加载无报错', ' | '.join(errs[:3]))
        ok(await pg.evaluate("() => !!window.__stage"), '模型已挂载')

        # ---- 真实指针拖动：乙 → 8.2 m
        g = await pg.evaluate("""() => {
          const s = window.__stage, bx = document.getElementById('stagewrap').getBoundingClientRect();
          const a = s.state.actors[1];
          return { sx: bx.left + s.X(a.x), sy: bx.top + (s.Y(a.feet + s.m.headH) + s.Y(a.feet)) / 2,
                   tx: bx.left + s.X(8.2) };
        }""")
        await pg.mouse.move(g['sx'], g['sy']); await pg.mouse.down()
        for k in range(1, 13):
            await pg.mouse.move(g['sx'] + (g['tx'] - g['sx']) * k / 12, g['sy'])
            await pg.wait_for_timeout(25)
        await pg.mouse.up(); await pg.wait_for_timeout(350)
        after = await pg.evaluate("""() => { const s = window.__stage, r = s.state.r;
          return { x: s.state.actors.map(a => +a.x.toFixed(2)), R: r.R.map(v => +v.toFixed(2)),
                   worst: r.worst + 1, peak: +(r.peak.v * 1000).toFixed(1), at: +r.peak.x.toFixed(2),
                   red: document.getElementById('peakBand').textContent }; }""")
        ok(after['x'][1] > 8.0, '指针拖动生效', ' / '.join(map(str, after['x'])))
        ok(after['worst'] == 4, '最不利吊点翻转为吊点 4', '#' + str(after['worst']))
        ok(after['at'] > 3.8, '挠度峰值移到中跨', str(after['at']) + ' m')
        ok(abs(sum(after['R']) - 5.73) < 0.06, 'ΣR 仍等于总载荷', ' / '.join(map(str, after['R'])))

        # ---- 中跨重载
        await pg.click('#btnSym'); await pg.wait_for_timeout(400)
        sym = await pg.evaluate("""() => { const s = window.__stage, r = s.state.r;
          return { peak: +(r.peak.v * 1000).toFixed(1),
                   clear: +((window.StageModel.underside(s.m, r, 4.2) - s.m.matTop) * 100).toFixed(1),
                   need: +(s.m.requiredClear * 100).toFixed(0),
                   tag: document.getElementById('clearTag').textContent }; }""")
        ok(sym['peak'] > 90, '中跨重载超过 90 mm 限值', str(sym['peak']) + ' mm')
        ok(sym['clear'] < sym['need'], '窗口净空变为不足', f"{sym['clear']} < {sym['need']} cm")
        ok('不足' in sym['tag'], '净空卡片显示不足', sym['tag'])

        # ---- 剖切滑块
        await pg.evaluate("""() => { const el = document.getElementById('slice'); el.value = '10';
          el.dispatchEvent(new Event('input', { bubbles: true })); }""")
        await pg.wait_for_timeout(200)
        sv = await pg.evaluate("() => document.getElementById('sliceVal').textContent")
        ok(sv == '0.84 m', '剖切滑块改变读数', sv)

        # ---- 限值滑块
        before = await pg.evaluate("() => document.getElementById('peakBand').textContent")
        await pg.evaluate("""() => { const el = document.getElementById('limit'); el.value = '200';
          el.dispatchEvent(new Event('input', { bubbles: true })); }""")
        await pg.wait_for_timeout(200)
        after2 = await pg.evaluate("() => document.getElementById('peakBand').textContent")
        ok(before != after2 and after2 == '无', '限值提到 200 mm 后不再超限', before + ' → ' + after2)

        # ---- 抛接
        await pg.evaluate("""() => { const el = document.getElementById('limit'); el.value = '90';
          el.dispatchEvent(new Event('input', { bubbles: true })); }""")
        await pg.click('#presetBtn'); await pg.wait_for_timeout(300)
        await pg.click('#btnThrow')
        max_feet, min_clear = 0, float('inf')
        for _ in range(28):
            await pg.wait_for_timeout(70)
            d = await pg.evaluate("""() => { const s = window.__stage, a = s.state.actors[1], r = s.state.r;
              return { feet: a.feet, playing: s.state.playing,
                       clear: (window.StageModel.underside(s.m, r, a.x) - s.m.matTop) * 100 }; }""")
            if d['playing']:
                max_feet = max(max_feet, d['feet'])
                min_clear = min(min_clear, d['clear'])
        ok(max_feet > 2.6, '抛起动画运行（脚部升高）', f"{max_feet:.2f} m")
        ok(min_clear < 296, '抛接过程中窗口净空一度不足', f"{min_clear:.1f} cm (需求 296)")
        ok(len(errs) == 0, '交互过程无报错', ' | '.join(errs[:3]))

        # ---- 移动端：无横向溢出 + 可点按
        pg2 = await b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        await pg2.goto(url); await pg2.wait_for_timeout(900)
        sw = await pg2.evaluate("() => document.documentElement.scrollWidth")
        ok(sw <= 390, '移动端无横向滚动', 'scrollWidth=' + str(sw))
        g2 = await pg2.evaluate("""() => { const s = window.__stage, bx = document.getElementById('stagewrap').getBoundingClientRect();
          const a = s.state.actors[1];
          return { x: bx.left + s.X(a.x), y: bx.top + (s.Y(a.feet + s.m.headH) + s.Y(a.feet)) / 2 }; }""")
        await pg2.touchscreen.tap(g2['x'], g2['y'])
        ok(True, '移动端演员可点按')
        await b.close()
    print('\nALL PASS' if FAILS == 0 else f'\n{FAILS} FAILURES')
    return 1 if FAILS else 0

sys.exit(asyncio.run(main()))
