#!/usr/bin/env python3
import sys
import os
import json
import hashlib
import urllib.request
import urllib.error
import http.cookiejar

def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            print(json.dumps({'status': 0, 'error': 'No input provided'}))
            return
        req_data = json.loads(raw_input)
    except Exception as e:
        print(json.dumps({'status': 0, 'error': f'Invalid JSON input: {e}'}))
        return

    url = req_data.get('url')
    method = req_data.get('method', 'GET').upper()
    headers = req_data.get('headers', {})
    data = req_data.get('data')
    proxy = req_data.get('proxy')
    timeout = req_data.get('timeout', 15)
    session_id = req_data.get('session_id')

    encoded_data = json.dumps(data).encode('utf-8') if data is not None else None

    handlers = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({'http': proxy, 'https': proxy}))

    cookie_jar = None
    cookie_file = None
    if session_id:
        sess_hash = hashlib.md5(str(session_id).encode()).hexdigest()
        cookie_file = f'/tmp/discord_sess_{sess_hash}.txt'
        cookie_jar = http.cookiejar.LWPCookieJar(cookie_file)
        if os.path.exists(cookie_file):
            try:
                cookie_jar.load(ignore_discard=True, ignore_expires=True)
            except Exception:
                pass
        handlers.append(urllib.request.HTTPCookieProcessor(cookie_jar))

    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)

    try:
        with opener.open(req, timeout=timeout) as res:
            res_body = res.read().decode('utf-8')
            try:
                parsed = json.loads(res_body)
            except:
                parsed = res_body

            if cookie_jar and cookie_file:
                try:
                    cookie_jar.save(ignore_discard=True, ignore_expires=True)
                except Exception:
                    pass

            cookies_list = []
            if cookie_jar:
                for c in cookie_jar:
                    cookies_list.append(f"{c.name}={c.value}")

            print(json.dumps({
                'status': res.status,
                'data': parsed,
                'final_url': res.geturl(),
                'headers': dict(res.headers),
                'cookies': '; '.join(cookies_list)
            }))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        try:
            parsed = json.loads(err_body)
        except:
            parsed = err_body

        if cookie_jar and cookie_file:
            try:
                cookie_jar.save(ignore_discard=True, ignore_expires=True)
            except Exception:
                pass

        cookies_list = []
        if cookie_jar:
            for c in cookie_jar:
                cookies_list.append(f"{c.name}={c.value}")

        print(json.dumps({
            'status': e.code,
            'data': parsed,
            'final_url': e.geturl() if hasattr(e, 'geturl') else None,
            'headers': dict(e.headers) if hasattr(e, 'headers') else {},
            'cookies': '; '.join(cookies_list)
        }))
    except Exception as e:
        print(json.dumps({'status': 0, 'error': str(e)}))

if __name__ == '__main__':
    main()
