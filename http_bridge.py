#!/usr/bin/env python3
import sys
import json
import urllib.request
import urllib.error

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

    encoded_data = json.dumps(data).encode('utf-8') if data is not None else None

    handlers = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({'http': proxy, 'https': proxy}))
    opener = urllib.request.build_opener(*handlers)

    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
    try:
        with opener.open(req, timeout=timeout) as res:
            res_body = res.read().decode('utf-8')
            try:
                parsed = json.loads(res_body)
            except:
                parsed = res_body
            print(json.dumps({'status': res.status, 'data': parsed}))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        try:
            parsed = json.loads(err_body)
        except:
            parsed = err_body
        print(json.dumps({'status': e.code, 'data': parsed}))
    except Exception as e:
        print(json.dumps({'status': 0, 'error': str(e)}))

if __name__ == '__main__':
    main()
