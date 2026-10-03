/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                 DISCORD TOKEN LIFE-KEEPER & WARMER                  ║
 * ║   Keep-Alive Gateway WebSocket + HypeSquad + Natural Presence       ║
 * ║   Giữ token sống lâu 1 tháng - 1 năm (Anti-Ban & Inactivity Prune) ║
 * ║                          by Azure AI Team                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node token_warmer.cjs                       # Nuôi toàn bộ token từ results/tokens_new.txt
 *   node token_warmer.cjs -f results/tokens_new.txt
 *   node token_warmer.cjs -f results/accounts_success.txt
 *   node token_warmer.cjs --proxy               # Nuôi qua Rotating Proxy
 *   node token_warmer.cjs -t TOKEN_HERE         # Nuôi 1 token cụ thể
 *   node token_warmer.cjs --duration 20         # Giữ online Gateway 20s mỗi token
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
const { execFile } = require('child_process');

let HttpsProxyAgent = null;
try {
    HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent;
} catch {
    try {
        HttpsProxyAgent = require('https-proxy-agent');
    } catch {}
}

const BRIDGE_PATH = path.join(__dirname, 'http_bridge.py');

// ─── CONFIG ────────────────────────────────────────
const CONFIG = {
    API_BASE: 'https://discord.com/api/v9',
    PROXY_FILE: path.join(__dirname, 'proxy.txt'),
    DEFAULT_TOKENS_FILE: path.join(__dirname, 'results', 'tokens_new.txt'),
    ACCOUNTS_FILE: path.join(__dirname, 'results', 'accounts_success.txt'),
    RESULTS_DIR: path.join(__dirname, 'results'),
    TOKENS_LIVE: path.join(__dirname, 'results', 'tokens_live.txt'),
    TOKENS_LOCKED: path.join(__dirname, 'results', 'tokens_locked.txt'),
    TOKENS_DEAD: path.join(__dirname, 'results', 'tokens_dead.txt'),
    TIMEOUT: 12000,
    DEFAULT_DURATION_SEC: 15,
};

// ─── COLORS ────────────────────────────────────────
const C = {
    reset: (s) => `\x1b[0m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    green: (s) => `\x1b[38;5;48m${s}\x1b[0m`,
    red: (s) => `\x1b[38;5;196m${s}\x1b[0m`,
    yellow: (s) => `\x1b[38;5;220m${s}\x1b[0m`,
    blue: (s) => `\x1b[38;5;39m${s}\x1b[0m`,
    purple: (s) => `\x1b[38;5;141m${s}\x1b[0m`,
    cyan: (s) => `\x1b[38;5;87m${s}\x1b[0m`,
    gray: (s) => `\x1b[38;5;245m${s}\x1b[0m`,
    white: (s) => `\x1b[97m${s}\x1b[0m`,
    bgGreen: (s) => `\x1b[42;30m ${s} \x1b[0m`,
    bgRed: (s) => `\x1b[41;97m ${s} \x1b[0m`,
    bgYellow: (s) => `\x1b[43;30m ${s} \x1b[0m`,
    bgBlue: (s) => `\x1b[44;97m ${s} \x1b[0m`,
};

function getVNTimeString() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())} ${pad(vnTime.getDate())}/${pad(vnTime.getMonth() + 1)}/${vnTime.getFullYear()} (GMT+7)`;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── PROXY POOL ────────────────────────────────────
class ProxyPool {
    constructor(proxyFile) {
        this.proxies = [];
        this.index = 0;
        this.enabled = false;
        if (proxyFile && fs.existsSync(proxyFile)) {
            const raw = fs.readFileSync(proxyFile, 'utf-8');
            this.proxies = raw.split('\n')
                .map(l => l.trim().replace(/\r/g, ''))
                .filter(l => l && !l.startsWith('#'));
        }
    }

    enable() {
        if (this.proxies.length === 0) {
            console.log(C.yellow('  ⚠  Không tìm thấy proxy trong proxy.txt, tiếp tục bằng Direct IP.'));
            return;
        }
        this.enabled = true;
        console.log(C.blue(`  🌐 Đã nạp ${this.proxies.length} proxy từ proxy.txt`));
    }

    next() {
        if (!this.enabled || this.proxies.length === 0) return null;
        const raw = this.proxies[this.index % this.proxies.length];
        this.index++;
        const parts = raw.split(':');
        let url;
        if (parts.length === 4) {
            url = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
        } else if (parts.length === 2) {
            url = `http://${parts[0]}:${parts[1]}`;
        } else {
            url = raw.startsWith('http') ? raw : `http://${raw}`;
        }
        return { raw, url, ip: parts[0] };
    }
}

// ─── HTTP BRIDGE ───────────────────────────────────
function discordHttp({ url, method = 'GET', headers = {}, data = null, proxy = null, timeout = 12 }) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({ url, method, headers, data, proxy, timeout });
        const child = execFile('python3', [BRIDGE_PATH], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (err) return resolve({ status: 0, error: err.message });
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (e) {
                resolve({ status: 0, error: 'JSON parse error: ' + stdout });
            }
        });
        child.stdin.write(payload);
        child.stdin.end();
    });
}

function getSuperProperties() {
    const props = {
        os: "Windows",
        os_version: "10",
        browser: "Chrome",
        browser_version: "131.0.0.0",
        client_build_number: 345000,
        release_channel: "stable"
    };
    return Buffer.from(JSON.stringify(props)).toString('base64');
}

// ─── TOKEN HEALTH CHECK ────────────────────────────
async function checkTokenHealth(token, proxyUrl) {
    try {
        const res = await discordHttp({
            url: `${CONFIG.API_BASE}/users/@me`,
            method: 'GET',
            headers: {
                'Authorization': token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'X-Super-Properties': getSuperProperties()
            },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000
        });

        if (res.status === 200 && res.data?.id) {
            const u = res.data;
            return {
                status: 'LIVE',
                id: u.id,
                username: u.username,
                tag: `${u.username}#${u.discriminator || '0'}`,
                email: u.email || 'N/A',
                phone: u.phone || 'None',
                verified: Boolean(u.verified),
                mfa_enabled: Boolean(u.mfa_enabled),
                flags: u.flags || 0,
            };
        } else if (res.status === 401) {
            return { status: 'DEAD', error: 'Token không hợp lệ hoặc đã bị vô hiệu hóa (401)' };
        } else if (res.status === 403) {
            const msg = res.data?.message || '';
            if (msg.includes('phone') || res.data?.code === 40002) {
                return { status: 'LOCKED', error: 'Yêu cầu xác minh số điện thoại (Phone Lock)' };
            }
            return { status: 'DEAD', error: `Bị khóa (403): ${msg}` };
        } else {
            return { status: 'UNKNOWN', error: `HTTP ${res.status}: ${JSON.stringify(res.data)}` };
        }
    } catch (e) {
        return { status: 'ERROR', error: e.message };
    }
}

// ─── JOIN HYPESQUAD HOUSE ──────────────────────────
async function joinHypeSquad(token, proxyUrl) {
    try {
        const houseId = Math.floor(Math.random() * 3) + 1; // 1: Bravery, 2: Brilliance, 3: Balance
        const houseNames = { 1: 'Bravery', 2: 'Brilliance', 3: 'Balance' };
        const res = await discordHttp({
            url: `${CONFIG.API_BASE}/hypesquad/online`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Origin': 'https://discord.com',
                'Referer': 'https://discord.com/channels/@me',
                'X-Super-Properties': getSuperProperties()
            },
            data: { house_id: houseId },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000
        });
        return (res.status === 204 || res.status === 200) ? houseNames[houseId] : null;
    } catch {
        return null;
    }
}

// ─── UPDATE CLIENT PREFERENCES & PROFILE ───────────
async function updateClientPreferences(token, proxyUrl) {
    try {
        await discordHttp({
            url: `${CONFIG.API_BASE}/users/@me/settings`,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Origin': 'https://discord.com',
                'Referer': 'https://discord.com/channels/@me',
                'X-Super-Properties': getSuperProperties()
            },
            data: {
                theme: 'dark',
                developer_mode: false,
                animate_emoji: true,
                render_reactions: true,
                gif_auto_play: true,
                locale: 'en-US',
                status: 'online'
            },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000
        });
        return true;
    } catch {
        return false;
    }
}

// ─── GATEWAY WEBSOCKET KEEP-ALIVE ──────────────────
function keepAliveGatewayWebSocket(token, proxyUrl, durationSec = 15, activityName = null) {
    return new Promise((resolve) => {
        let ws;
        let heartbeatTimer = null;
        let finished = false;

        const cleanup = () => {
            if (finished) return;
            finished = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            try {
                if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                    ws.close(1000, 'Normal Closure');
                }
            } catch {}
        };

        const timer = setTimeout(() => {
            cleanup();
            resolve({ success: true, reason: 'Duration completed' });
        }, durationSec * 1000);

        try {
            const wsOpts = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Origin': 'https://discord.com'
                }
            };
            if (proxyUrl && HttpsProxyAgent) {
                wsOpts.agent = new HttpsProxyAgent(proxyUrl);
            }

            ws = new WebSocket('wss://gateway.discord.gg/?v=9&encoding=json', wsOpts);

            ws.on('message', (rawData) => {
                try {
                    const msg = JSON.parse(rawData.toString());
                    // Opcode 10: Hello -> Gửi Heartbeat + IDENTIFY
                    if (msg.op === 10) {
                        const interval = msg.d.heartbeat_interval;
                        ws.send(JSON.stringify({ op: 1, d: null }));
                        heartbeatTimer = setInterval(() => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ op: 1, d: null }));
                            }
                        }, Math.min(interval, 8000));

                        const activities = [];
                        if (activityName) {
                            activities.push({
                                name: activityName,
                                type: 0, // Playing
                                created_at: Date.now()
                            });
                        }

                        const identifyPayload = {
                            op: 2,
                            d: {
                                token,
                                capabilities: 16381,
                                properties: {
                                    os: 'Windows',
                                    browser: 'Chrome',
                                    device: '',
                                    system_locale: 'en-US',
                                    browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                                    browser_version: '131.0.0.0',
                                    os_version: '10',
                                    release_channel: 'stable',
                                    client_build_number: 345000,
                                    client_event_source: null
                                },
                                presence: {
                                    status: 'online',
                                    since: 0,
                                    activities,
                                    afk: false
                                },
                                compress: false,
                                client_state: {
                                    guild_versions: {},
                                    highest_last_message_id: '0',
                                    read_state_version: 0,
                                    user_guild_settings_version: -1,
                                    user_settings_version: -1
                                }
                            }
                        };
                        ws.send(JSON.stringify(identifyPayload));
                    }
                } catch {}
            });

            ws.on('error', (err) => {
                cleanup();
                clearTimeout(timer);
                resolve({ success: false, reason: err.message });
            });

            ws.on('close', () => {
                cleanup();
                clearTimeout(timer);
                resolve({ success: true, reason: 'Closed cleanly' });
            });
        } catch (e) {
            cleanup();
            clearTimeout(timer);
            resolve({ success: false, reason: e.message });
        }
    });
}

// ─── EXTRACT TOKENS FROM FILE / STRING ─────────────
function extractTokensFromFile(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const tokens = [];

    for (const line of lines) {
        if (line.startsWith('#')) continue;
        // Nếu là format email:pass:token
        const colonParts = line.split(':');
        if (colonParts.length >= 3 && colonParts[2].length > 40) {
            tokens.push(colonParts[2]);
            continue;
        }
        // Match base64 token regex Discord
        const tokenMatch = line.match(/[MNO][a-zA-Z0-9_-]{23,28}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27,45}/);
        if (tokenMatch) {
            tokens.push(tokenMatch[0]);
        } else if (line.length > 50 && !line.includes(' ')) {
            tokens.push(line);
        }
    }
    return [...new Set(tokens)];
}

// ─── CLI PARSER ────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        tokenFile: null,
        singleToken: null,
        useProxy: false,
        duration: CONFIG.DEFAULT_DURATION_SEC,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '-f':
            case '--file':
                opts.tokenFile = args[++i];
                break;
            case '-t':
            case '--token':
                opts.singleToken = args[++i];
                break;
            case '--proxy':
            case '-p':
                opts.useProxy = true;
                break;
            case '--duration':
            case '-d':
                opts.duration = parseInt(args[++i]) || CONFIG.DEFAULT_DURATION_SEC;
                break;
            case '-h':
            case '--help':
                console.log(`
  Usage:
    node token_warmer.cjs                       # Nuôi tokens từ results/tokens_new.txt
    node token_warmer.cjs -f tokens.txt         # Nuôi từ file tùy chọn
    node token_warmer.cjs -t "TOKEN_HERE"       # Nuôi 1 token cụ thể
    node token_warmer.cjs --proxy               # Nuôi qua Rotating Proxy
    node token_warmer.cjs --duration 20         # Giữ online Gateway 20 giây
                `);
                process.exit(0);
        }
    }
    return opts;
}

// ─── MAIN ──────────────────────────────────────────
async function main() {
    console.log('');
    console.log(C.purple('  ╔══════════════════════════════════════════════════════════════╗'));
    console.log(C.purple('  ║') + C.bold(C.white('         ⚡ DISCORD TOKEN LIFE-KEEPER & WARMER ⚡             ')) + C.purple('║'));
    console.log(C.purple('  ║') + C.gray('  Keep-Alive Gateway + HypeSquad + Natural Presence Simulator ') + C.purple('║'));
    console.log(C.purple('  ║') + C.cyan('                 by Azure AI Team                             ') + C.purple('║'));
    console.log(C.purple('  ╚══════════════════════════════════════════════════════════════╝'));
    console.log('');

    const opts = parseArgs();
    const proxyPool = new ProxyPool(CONFIG.PROXY_FILE);
    if (opts.useProxy) proxyPool.enable();

    let tokens = [];
    if (opts.singleToken) {
        tokens = [opts.singleToken];
    } else {
        const targetFile = opts.tokenFile || (fs.existsSync(CONFIG.DEFAULT_TOKENS_FILE) ? CONFIG.DEFAULT_TOKENS_FILE : CONFIG.ACCOUNTS_FILE);
        if (!fs.existsSync(targetFile)) {
            console.log(C.red(`  ✖ Không tìm thấy file token: ${targetFile}`));
            console.log(C.yellow('  💡 Hãy chạy tool reg trước hoặc chỉ định file: node token_warmer.cjs -f <file_token>'));
            process.exit(1);
        }
        console.log(C.blue(`  📂 Đang nạp danh sách token từ: ${C.bold(path.basename(targetFile))}`));
        tokens = extractTokensFromFile(targetFile);
    }

    if (tokens.length === 0) {
        console.log(C.yellow('  ⚠ Không tìm thấy token hợp lệ nào trong file!'));
        process.exit(0);
    }

    console.log(C.green(`  📋 Tìm thấy ${C.bold(String(tokens.length))} token cần bảo dưỡng / nuôi live!`));
    console.log(C.gray(`  ⏱ Thời gian online Gateway mỗi token: ${opts.duration}s`));
    console.log(C.gray('─'.repeat(55)));

    if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
        fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
    }

    const liveTokens = [];
    const lockedTokens = [];
    const deadTokens = [];

    const activities = [
        'Grand Theft Auto V',
        'Visual Studio Code',
        'Minecraft',
        'Valorant',
        'Spotify',
        'Cyberpunk 2077',
        'League of Legends',
        'Counter-Strike 2',
        'Apex Legends',
        'Chilling'
    ];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const num = i + 1;
        const shortToken = token.slice(0, 24) + '...' + token.slice(-6);
        console.log(`\n  ${C.bold(C.white(`[${num}/${tokens.length}]`))} ${C.cyan(shortToken)}`);

        const proxyObj = proxyPool.next();
        const proxyUrl = proxyObj ? proxyObj.url : null;
        if (proxyObj) console.log(C.gray(`    🌐 Proxy: ${proxyObj.ip}`));

        // 1. Kiểm tra sức khỏe Token
        process.stdout.write(`    ${C.gray('🩺 Kiểm tra trạng thái...')} `);
        const health = await checkTokenHealth(token, proxyUrl);

        if (health.status === 'LIVE') {
            console.log(C.bgGreen('LIVE'));
            console.log(`    ${C.gray('👤 Username:')} ${C.white(health.tag)} | ${C.gray('🛡️ Verified:')} ${health.verified ? C.green('Có') : C.yellow('Chưa')} | ${C.gray('📱 Phone:')} ${health.phone}`);

            // 2. Gia nhập HypeSquad nếu cần
            process.stdout.write(`    ${C.gray('🛡️ Cập nhật HypeSquad...')} `);
            const house = await joinHypeSquad(token, proxyUrl);
            if (house) {
                console.log(C.green(`OK (${house})`));
            } else {
                console.log(C.gray('Đã có / Skip'));
            }

            // 3. Cập nhật Settings
            await updateClientPreferences(token, proxyUrl);

            // 4. Mở WebSocket Gateway Keep-Alive
            const randomActivity = activities[Math.floor(Math.random() * activities.length)];
            process.stdout.write(`    ${C.gray(`🔌 Giữ online Gateway (${opts.duration}s, Playing "${randomActivity}")...`)} `);
            const kwRes = await keepAliveGatewayWebSocket(token, proxyUrl, opts.duration, randomActivity);
            if (kwRes.success) {
                console.log(C.green('HOÀN TẤT'));
            } else {
                console.log(C.yellow(`Skip (${kwRes.reason})`));
            }

            liveTokens.push(token);
            fs.appendFileSync(CONFIG.TOKENS_LIVE, `${token}\n`, 'utf-8');

        } else if (health.status === 'LOCKED') {
            console.log(C.bgYellow('PHONE LOCKED'));
            console.log(C.yellow(`    ⚠ ${health.error}`));
            lockedTokens.push(token);
            fs.appendFileSync(CONFIG.TOKENS_LOCKED, `${token}\n`, 'utf-8');

        } else {
            console.log(C.bgRed('DEAD / INVALID'));
            console.log(C.red(`    ✖ ${health.error}`));
            deadTokens.push(token);
            fs.appendFileSync(CONFIG.TOKENS_DEAD, `${token}\n`, 'utf-8');
        }

        if (i < tokens.length - 1) {
            await sleep(1000);
        }
    }

    // ─── TỔNG KẾT ──────────────────────────────────────
    console.log('\n' + C.gray('═'.repeat(55)));
    console.log(C.bold(C.white('  📊 BÁO CÁO BẢO DƯỠNG TOKEN DISCORD')));
    console.log(C.gray('═'.repeat(55)));
    console.log(`  ${C.green('🟢 Token Sống Khỏe (LIVE):')}   ${C.bold(C.green(String(liveTokens.length)))} → ${path.basename(CONFIG.TOKENS_LIVE)}`);
    console.log(`  ${C.yellow('🟡 Token Khóa Phone (LOCKED):')} ${C.bold(C.yellow(String(lockedTokens.length)))} → ${path.basename(CONFIG.TOKENS_LOCKED)}`);
    console.log(`  ${C.red('🔴 Token Chết (DEAD):')}         ${C.bold(C.red(String(deadTokens.length)))} → ${path.basename(CONFIG.TOKENS_DEAD)}`);
    console.log(`  ${C.cyan('🕒 Mốc hoàn thành:')}             ${getVNTimeString()}`);
    console.log(C.gray('═'.repeat(55)) + '\n');
}

main().catch(err => {
    console.error(C.red(`\n✖ Lỗi nghiêm trọng: ${err.message}`));
    process.exit(1);
});
