# language: Python 3.10+, file: auto_bridge.py
# intercept captcha request từ tool, auto-solve, gửi token về /captcha-callback
# install: pip install playwright hcaptcha-challenger httpx && playwright install chromium && python -m hcaptcha_challenger --install

import asyncio, httpx

TOOL_PORT = 7890  # port của tool reg

async def get_sitekey_from_tool():
    async with httpx.AsyncClient() as c:
        r = await c.get(f"http://localhost:{TOOL_PORT}/captcha-config", timeout=10)
        return r.json()

async def auto_solve_and_inject():
    print("[*] chờ tool bật lên...")

    while True:
        try:
            cfg = await get_sitekey_from_tool()
            sitekey = cfg.get("sitekey")
            if sitekey:
                print(f"[+] bắt được sitekey: {sitekey[:20]}...")
                break
        except:
            pass
        await asyncio.sleep(1)

    rqdata  = cfg.get("rqdata", "")
    service = cfg.get("service", "hcaptcha")

    print(f"[*] service: {service}, auto-solving...")

    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"]
        )
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/131.0.0.0 Safari/537.36"
        )
        page = await ctx.new_page()

        rqdata_js = f'rqdata: "{rqdata}",' if rqdata else ''
        html = f"""<html><body>
        <script src="https://js.hcaptcha.com/1/api.js?onload=onLoad&render=explicit" async defer></script>
        <div id="cap"></div>
        <script>
        window._token = null;
        function onLoad(){{
            hcaptcha.render('cap', {{
                sitekey: '{sitekey}',
                callback: t => {{ window._token = t; }},
                {rqdata_js}
                host: 'discord.com',
                theme: 'dark'
            }});
        }}
        </script></body></html>"""

        await page.set_content(html)

        try:
            import hcaptcha_challenger.agents as agents
            agent = agents.AgentT(page=page)
            await page.wait_for_timeout(2000)
            await agent.handle_checkbox()
            await page.wait_for_timeout(1000)
            await agent.collect()
            await agent.handle_classification()
            await page.wait_for_timeout(3000)
        except Exception as e:
            print(f"[!] AI solver lỗi: {e}")
            print("[*] fallback: chờ manual solve tại localhost:7890")
            await page.wait_for_timeout(60000)

        token = await page.evaluate("() => window._token || ''")
        await browser.close()

        if not token:
            print("[!] không lấy được token")
            return

        print(f"[+] token: {token[:50]}...")

        async with httpx.AsyncClient() as c:
            r = await c.post(
                f"http://localhost:{TOOL_PORT}/captcha-callback",
                json={"captcha_key": token},
                timeout=10
            )
            print(f"[+] injected: {r.json()}")

        await asyncio.sleep(3)
        await auto_solve_and_inject()

if __name__ == "__main__":
    asyncio.run(auto_solve_and_inject())
