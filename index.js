/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║             DISCORD ACCOUNT SUITE - CLOUD WEB DASHBOARD             ║
 * ║     Apple Liquid Glass (iOS Edition) + Anti-Lag 120fps Architecture  ║
 * ║               Optimized for Pterodactyl Node.js Hosting             ║
 * ║                          by Azure AI Team                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || 25963, 10);
const RESULTS_DIR = path.join(__dirname, 'results');
const TOKENS_NEW = path.join(RESULTS_DIR, 'tokens_new.txt');
const TOKENS_LIVE = path.join(RESULTS_DIR, 'tokens_live.txt');
const TOKENS_LOCKED = path.join(RESULTS_DIR, 'tokens_locked.txt');
const TOKENS_DEAD = path.join(RESULTS_DIR, 'tokens_dead.txt');
const ACCOUNTS_FILE = path.join(RESULTS_DIR, 'accounts_success.txt');

if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

let activeProcess = null;
let activeProcessName = null;
const recentLogs = [];
const MAX_LOGS = 100;

function addLog(msg) {
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const line = `[${time}] ${msg}`;
    recentLogs.push(line);
    if (recentLogs.length > MAX_LOGS) recentLogs.shift();
    console.log(line);
}

function countLines(filePath) {
    if (!fs.existsSync(filePath)) return 0;
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return data.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
    } catch {
        return 0;
    }
}

function getTokens(filePath, limit = 50) {
    if (!fs.existsSync(filePath)) return [];
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const lines = data.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        return lines.slice(-limit).reverse();
    } catch {
        return [];
    }
}

// ─── HTTP SERVER ───────────────────────────────────
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS & Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ─── API: STATS ────────────────────────────────
    if (url.pathname === '/api/stats') {
        const stats = {
            totalAccounts: countLines(ACCOUNTS_FILE),
            totalNew: countLines(TOKENS_NEW),
            totalLive: countLines(TOKENS_LIVE),
            totalLocked: countLines(TOKENS_LOCKED),
            totalDead: countLines(TOKENS_DEAD),
            uptimeSec: Math.floor(process.uptime()),
            memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            isRunning: Boolean(activeProcess),
            runningTask: activeProcessName,
            port: PORT,
            nodeVersion: process.version
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
        return;
    }

    // ─── API: TOKENS LIST ──────────────────────────
    if (url.pathname === '/api/tokens') {
        const type = url.searchParams.get('type') || 'new';
        let targetFile = TOKENS_NEW;
        if (type === 'live') targetFile = TOKENS_LIVE;
        if (type === 'locked') targetFile = TOKENS_LOCKED;
        if (type === 'dead') targetFile = TOKENS_DEAD;
        if (type === 'accounts') targetFile = ACCOUNTS_FILE;

        const list = getTokens(targetFile);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type, count: list.length, items: list }));
        return;
    }

    // ─── API: LOGS ─────────────────────────────────
    if (url.pathname === '/api/logs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: recentLogs, isRunning: Boolean(activeProcess) }));
        return;
    }

    // ─── API: RUN WARMER ───────────────────────────
    if (url.pathname === '/api/action/warmer' && req.method === 'POST') {
        if (activeProcess) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Tác vụ "${activeProcessName}" đang chạy, vui lòng chờ!` }));
            return;
        }

        addLog('🚀 Khởi chạy Token Warmer & Keep-Alive...');
        activeProcessName = 'Token Warmer (Nuôi Token)';
        activeProcess = spawn('node', ['token_warmer.cjs', '--duration', '15'], { cwd: __dirname });

        activeProcess.stdout.on('data', (d) => {
            const lines = d.toString().split('\n').filter(Boolean);
            lines.forEach(l => addLog(l.replace(/\x1b\[[0-9;]*m/g, '')));
        });

        activeProcess.stderr.on('data', (d) => {
            addLog(`✖ Lỗi: ${d.toString().trim()}`);
        });

        activeProcess.on('close', (code) => {
            addLog(`🏁 Token Warmer kết thúc (Exit code: ${code})`);
            activeProcess = null;
            activeProcessName = null;
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Đã kích hoạt Token Warmer thành công!' }));
        return;
    }

    // ─── HTML DASHBOARD (Apple Liquid Glass) ───────
    if (url.pathname === '/' || url.pathname === '/index.html') {
        const stats = {
            totalAccounts: countLines(ACCOUNTS_FILE),
            totalNew: countLines(TOKENS_NEW),
            totalLive: countLines(TOKENS_LIVE),
            port: PORT
        };

        const html = renderAppleLiquidGlassUI(stats);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
    addLog(`✨ Server Dashboard đã kích hoạt tại http://0.0.0.0:${PORT}`);
});

// ─── APPLE LIQUID GLASS UI (iOS Edition) ───────────
function renderAppleLiquidGlassUI(initialStats) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>⚡ Discord Cloud Suite | Apple Liquid Glass</title>
    <style>
        :root {
            --bg-color: #070a10;
            --surface-outer: rgba(255, 255, 255, 0.05);
            --surface-inner: rgba(255, 255, 255, 0.03);
            --specular-border: rgba(255, 255, 255, 0.12);
            --ios-blue: #2997ff;
            --ios-green: #30d158;
            --ios-coral: #ff453a;
            --ios-orange: #ff9f0a;
            --ios-purple: #bf5af2;
            --text-primary: #ffffff;
            --text-secondary: rgba(255, 255, 255, 0.65);
            --text-tertiary: rgba(255, 255, 255, 0.4);
            --font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-tap-highlight-color: transparent;
        }

        body {
            background-color: var(--bg-color);
            background-image: 
                radial-gradient(at 0% 0%, rgba(41, 151, 255, 0.12) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(191, 90, 242, 0.08) 0px, transparent 50%);
            color: var(--text-primary);
            font-family: var(--font-family);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px 16px 40px 16px;
            overflow-x: hidden;
            font-variant-numeric: tabular-nums;
        }

        /* ─── DYNAMIC ISLAND ─── */
        .dynamic-island {
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(30px);
            -webkit-backdrop-filter: blur(30px);
            border: 1px solid var(--specular-border);
            border-radius: 40px;
            padding: 10px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
            transform: translateZ(0);
        }

        .island-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--ios-green);
            box-shadow: 0 0 10px var(--ios-green);
            animation: pulseDot 2s infinite ease-in-out;
        }

        @keyframes pulseDot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.85); }
        }

        .island-text {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            letter-spacing: -0.2px;
        }

        /* ─── CONTAINER ─── */
        .container {
            width: 100%;
            max-width: 600px;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        /* ─── DOPPELRAND GLASS CARDS ─── */
        .card-outer {
            background: var(--surface-outer);
            backdrop-filter: blur(25px);
            -webkit-backdrop-filter: blur(25px);
            border: 1px solid var(--specular-border);
            border-radius: 24px;
            padding: 8px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
            transform: translateZ(0);
        }

        .card-inner {
            background: var(--surface-inner);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 18px;
            padding: 20px;
        }

        .card-title {
            font-size: 17px;
            font-weight: 700;
            letter-spacing: -0.3px;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        /* ─── STATS GRID ─── */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
        }

        .stat-box {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 14px;
            padding: 14px;
        }

        .stat-label {
            font-size: 12px;
            color: var(--text-secondary);
            margin-bottom: 6px;
        }

        .stat-value {
            font-size: 26px;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: var(--text-primary);
        }

        /* ─── BUTTONS ─── */
        .btn-group {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 16px;
        }

        .btn {
            background: var(--ios-blue);
            color: #ffffff;
            border: none;
            border-radius: 14px;
            padding: 14px 20px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: opacity 0.2s, transform 0.1s;
            transform: translateZ(0);
        }

        .btn:active {
            transform: scale(0.98) translateZ(0);
            opacity: 0.85;
        }

        .btn-secondary {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid var(--specular-border);
            color: var(--text-primary);
        }

        /* ─── CONSOLE / LOGS ─── */
        .console-box {
            background: #04060a;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 12px;
            font-family: "SF Mono", Menlo, Consolas, monospace;
            font-size: 12px;
            color: #d1d5db;
            height: 180px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-all;
        }

        /* ─── TOAST NOTIFICATION ─── */
        .toast {
            position: fixed;
            bottom: 30px;
            background: rgba(20, 20, 24, 0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--specular-border);
            padding: 12px 24px;
            border-radius: 30px;
            color: #ffffff;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
            transform: translateY(100px) translateZ(0);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
            z-index: 999;
        }

        .toast.show {
            transform: translateY(0) translateZ(0);
            opacity: 1;
        }
    </style>
</head>
<body>

    <!-- DYNAMIC ISLAND -->
    <div class="dynamic-island">
        <div class="island-dot"></div>
        <div class="island-text">Meowlix Cloud Node • Port ${initialStats.port}</div>
    </div>

    <div class="container">

        <!-- THỐNG KÊ TỔNG QUAN -->
        <div class="card-outer">
            <div class="card-inner">
                <div class="card-title">
                    <span>📊 Tổng Quan Tài Khoản</span>
                    <span style="font-size: 12px; color: var(--ios-blue); cursor: pointer;" onclick="refreshStats()">Làm mới ⟳</span>
                </div>
                <div class="stats-grid">
                    <div class="stat-box">
                        <div class="stat-label">Tổng Account Đã Reg</div>
                        <div class="stat-value" id="val-accs">${initialStats.totalAccounts}</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">Token Mới (New)</div>
                        <div class="stat-value" style="color: var(--ios-blue);" id="val-new">${initialStats.totalNew}</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">Token Sống (LIVE)</div>
                        <div class="stat-value" style="color: var(--ios-green);" id="val-live">${initialStats.totalLive}</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">Trạng Thái Node</div>
                        <div class="stat-value" style="font-size: 18px; color: var(--ios-green);">ONLINE</div>
                    </div>
                </div>

                <div class="btn-group">
                    <button class="btn" onclick="runWarmer()">
                        <span>🔥</span> Nuôi Dàn Token (Keep-Alive Gateway)
                    </button>
                    <button class="btn btn-secondary" onclick="copyAllLiveTokens()">
                        <span>📋</span> Sao Chép Danh Sách Token Sống
                    </button>
                </div>
            </div>
        </div>

        <!-- LOGS TIẾN TRÌNH REALTIME -->
        <div class="card-outer">
            <div class="card-inner">
                <div class="card-title">
                    <span>📡 Nhật Ký Hoạt Động (Logs)</span>
                    <span style="font-size: 11px; color: var(--text-tertiary);" id="log-status">Sẵn sàng</span>
                </div>
                <div class="console-box" id="console">Đang kết nối trung tâm điều khiển Cloud...</div>
            </div>
        </div>

    </div>

    <!-- TOAST -->
    <div class="toast" id="toast">Thông báo</div>

    <script>
        function showToast(msg) {
            const t = document.getElementById('toast');
            t.innerText = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2500);
        }

        async function refreshStats() {
            try {
                const res = await fetch('/api/stats');
                const data = await res.json();
                document.getElementById('val-accs').innerText = data.totalAccounts;
                document.getElementById('val-new').innerText = data.totalNew;
                document.getElementById('val-live').innerText = data.totalLive;
            } catch (e) {}
        }

        async function updateLogs() {
            try {
                const res = await fetch('/api/logs');
                const data = await res.json();
                const box = document.getElementById('console');
                if (data.logs && data.logs.length > 0) {
                    box.innerText = data.logs.join('\\n');
                    box.scrollTop = box.scrollHeight;
                }
                const statusSpan = document.getElementById('log-status');
                if (data.isRunning) {
                    statusSpan.innerText = 'Đang chạy tác vụ...';
                    statusSpan.style.color = '#30d158';
                } else {
                    statusSpan.innerText = 'Đang chờ';
                    statusSpan.style.color = 'rgba(255, 255, 255, 0.4)';
                }
            } catch (e) {}
        }

        async function runWarmer() {
            showToast('Đang kích hoạt Token Warmer...');
            try {
                const res = await fetch('/api/action/warmer', { method: 'POST' });
                const data = await res.json();
                if (data.error) showToast(data.error);
                else showToast(data.message);
            } catch (e) {
                showToast('Lỗi gửi lệnh!');
            }
        }

        async function copyAllLiveTokens() {
            try {
                const res = await fetch('/api/tokens?type=live');
                const data = await res.json();
                if (!data.items || data.items.length === 0) {
                    showToast('Chưa có token Live nào trong danh sách!');
                    return;
                }
                await navigator.clipboard.writeText(data.items.join('\\n'));
                showToast('Đã sao chép ' + data.items.length + ' token vào bộ nhớ tạm!');
            } catch (e) {
                showToast('Không thể sao chép tự động!');
            }
        }

        setInterval(updateLogs, 2500);
        setInterval(refreshStats, 8000);
        updateLogs();
    </script>
</body>
</html>`;
}
