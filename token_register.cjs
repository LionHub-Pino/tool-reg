/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                  DISCORD ACCOUNT GENERATOR v2.0                     ║
 * ║   Manual Captcha (hCaptcha/Turnstile) + Multi-Provider Temp Mail    ║
 * ║   Auto Webhook Alert + Real-time File TXT Persistence (tk:mk:token) ║
 * ║                          by Azure AI Team                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node token_register.cjs                     # Reg 1 account
 *   node token_register.cjs -n 3                # Reg 3 accounts
 *   node token_register.cjs --proxy             # Dùng rotating proxy (proxy.txt)
 *   node token_register.cjs -u "MyUsername"     # Đặt username cụ thể
 *   node token_register.cjs -e "my@email.com"   # Dùng email cụ thể
 *   node token_register.cjs --emails emails.txt # Đọc danh sách email từ file
 *   node token_register.cjs --webhook URL       # Ghi đè Webhook Discord
 *
 * Flow:
 *   1. Lấy proxy sạch + fingerprint + location metadata
 *   2. Tạo email (Mail.tm / GuerrillaMail / TempMail.lol / Custom list)
 *   3. Gửi challenge lên Discord lấy captcha sitekey
 *   4. Tự động nhận diện hCaptcha hoặc Cloudflare Turnstile
 *   5. Mở http://localhost:7890 (Giao diện Apple Liquid Glass) → bạn giải captcha
 *   6. Submit đăng ký kèm token captcha (Dual Header + Body support)
 *   7. Nhận token Discord + Tự động verify email
 *   8. Bắn Discord Webhook thông báo thành công + Lưu tk:mk:token vào txt ngay lập tức
 *
 * Output:
 *   results/accounts_success.txt    # Format: email:password:token
 *   results/accounts.txt            # Format: email:password
 *   results/tokens_new.txt          # Danh sách token sống
 *   results/registered_<time>.json  # Báo cáo JSON chi tiết
 */

const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const WebSocket = require('ws');

const { execFile } = require('child_process');
const BRIDGE_PATH = path.join(__dirname, 'http_bridge.py');

let HttpsProxyAgent = null;
try {
    HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent;
} catch {
    try {
        HttpsProxyAgent = require('https-proxy-agent');
    } catch {}
}

// ─── CONFIG ────────────────────────────────────────
const CONFIG = {
    API_BASE: 'https://discord.com/api/v9',
    CAPTCHA_PORT: 7890,
    WEBHOOK_URL: 'https://discord.com/api/webhooks/1547577083125956729/F1OCPwzXRCIyCEXJvHZOP8-AcLUGimbVmkrylWm0Lc6iaEDZcE5VD8v7655jQyHOfUZc',
    PROXY_FILE: path.join(__dirname, 'proxy.txt'),
    RESULTS_DIR: path.join(__dirname, 'results'),
    ACCOUNTS_FILE: path.join(__dirname, 'results', 'accounts_success.txt'),
    ACCOUNTS_LOGIN_FILE: path.join(__dirname, 'results', 'accounts.txt'),
    TOKENS_FILE: path.join(__dirname, 'results', 'tokens_new.txt'),
    EMAILS_FILE: path.join(__dirname, 'emails.txt'),
    MAX_EMAIL_RETRIES: 5,
    TIMEOUT: 12000,
    JITTER_MIN: 800,
    JITTER_MAX: 1600,
    EMAIL_POLL_INTERVAL: 3000,
    EMAIL_POLL_MAX_WAIT: 90000,
};

// ─── COLORS ────────────────────────────────────────
const C = {
    reset: '\x1b[0m',
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
    bgCyan: (s) => `\x1b[46;30m ${s} \x1b[0m`,
};

// ─── UTILS ─────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter() { return sleep(CONFIG.JITTER_MIN + Math.random() * (CONFIG.JITTER_MAX - CONFIG.JITTER_MIN)); }

function getVNTimeString() {
    return new Date().toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }) + ' (GMT+7)';
}

function generateUsername(custom) {
    if (custom) return custom;
    const adjectives = ['Cool', 'Swift', 'Dark', 'Blue', 'Red', 'Ice', 'Fire', 'Star', 'Moon', 'Sky',
        'Neo', 'Zen', 'Arc', 'Lux', 'Ash', 'Ray', 'Fox', 'Kai', 'Nox', 'Vex', 'Aero', 'Volt', 'Glitch', 'Kite'];
    const nouns = ['Wolf', 'Lion', 'Bear', 'Hawk', 'Storm', 'Blade', 'Knight', 'Shadow', 'Phoenix', 'Rider',
        'Hunter', 'Viper', 'Raven', 'Ghost', 'Titan', 'Nova', 'Fury', 'Sage', 'Echo', 'Drift', 'Pulse', 'Spark'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 89999 + 10000);
    return `${adj}${noun}${num}`.toLowerCase();
}

function generatePassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
    let pass = '';
    for (let i = 0; i < 16; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    return pass + 'A1!';
}

function generateDOB() {
    const year = 1993 + Math.floor(Math.random() * 8); // 1993-2000
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function buildSuperProperties() {
    const sp = {
        os: 'Windows',
        browser: 'Chrome',
        device: '',
        system_locale: 'en-US',
        browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        browser_version: '131.0.0.0',
        os_version: '10',
        referrer: '',
        referring_domain: '',
        referrer_current: '',
        referring_domain_current: '',
        release_channel: 'stable',
        client_build_number: 345000,
        client_event_source: null
    };
    return Buffer.from(JSON.stringify(sp)).toString('base64');
}

const GLOBAL_SP = buildSuperProperties();

function buildHeaders(extra = {}, fingerprint = null) {
    const h = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/register',
        'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'X-Discord-Locale': 'en-US',
        'X-Discord-Timezone': 'Asia/Ho_Chi_Minh',
        'X-Super-Properties': GLOBAL_SP,
        ...extra,
    };
    if (fingerprint) {
        h['X-Fingerprint'] = fingerprint;
    }
    return h;
}

// ─── PROXY POOL (Sticky per account + fail-fast) ────
class ProxyPool {
    constructor(proxyFile) {
        this.proxies = [];
        this.enabled = false;
        this.cooldowns = new Map(); // proxyUrl -> timestamp
        if (proxyFile && fs.existsSync(proxyFile)) {
            const raw = fs.readFileSync(proxyFile, 'utf-8');
            const lines = raw.split('\n')
                .map(l => l.trim().replace(/\r/g, ''))
                .filter(l => l && !l.startsWith('#'));

            for (const line of lines) {
                const parts = line.split(':');
                let formatted = '';
                if (parts.length === 4) {
                    formatted = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
                } else if (parts.length === 2) {
                    formatted = `http://${parts[0]}:${parts[1]}`;
                } else {
                    formatted = `http://${line}`;
                }
                this.proxies.push({ raw: line, url: formatted, ip: parts[0] });
            }
        }
    }

    enable() {
        if (this.proxies.length === 0) {
            console.log(C.yellow('⚠  Không tìm thấy proxy trong proxy.txt, chuyển sang Direct'));
            this.enabled = false;
            return;
        }
        this.enabled = true;
        console.log(C.blue(`🔄 Proxy Pool kích hoạt: ${C.bold(String(this.proxies.length))} proxies sẵn sàng`));
    }

    markRateLimited(proxyUrl, retryAfterSec = 120) {
        const until = Date.now() + (retryAfterSec * 1000);
        this.cooldowns.set(proxyUrl, until);
    }

    getProxyForAccount(accountIndex) {
        if (!this.enabled || this.proxies.length === 0) return null;
        const now = Date.now();
        // Tìm proxy không bị cooldown
        for (let i = 0; i < this.proxies.length; i++) {
            const p = this.proxies[(accountIndex + i) % this.proxies.length];
            const cd = this.cooldowns.get(p.url) || 0;
            if (now > cd) {
                return p;
            }
        }
        // Nếu tất cả đều cooldown, chọn cái gần hết cooldown nhất
        return this.proxies[accountIndex % this.proxies.length];
    }

    createAgent(proxyObj) {
        if (!proxyObj || !HttpsProxyAgent) return null;
        try {
            return new HttpsProxyAgent(proxyObj.url);
        } catch {
            return null;
        }
    }
}

// ─── TEMP EMAIL PROVIDERS ──────────────────────────
class TempMailManager {
    constructor() {
        this.customEmails = [];
        this.customIndex = 0;
        if (fs.existsSync(CONFIG.EMAILS_FILE)) {
            try {
                this.customEmails = fs.readFileSync(CONFIG.EMAILS_FILE, 'utf-8')
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l && !l.startsWith('#') && l.includes('@'));
                if (this.customEmails.length > 0) {
                    console.log(C.green(`📧 Đã nạp ${this.customEmails.length} email tùy chỉnh từ ${CONFIG.EMAILS_FILE}`));
                }
            } catch {}
        }
    }

    async generateEmail(attempt = 0, specificEmail = null, preferredProvider = 'tempmaillol') {
        if (specificEmail) {
            return {
                type: 'custom',
                address: specificEmail,
                pollVerifyLink: async () => null,
            };
        }

        if (this.customEmails.length > 0 && this.customIndex < this.customEmails.length) {
            const addr = this.customEmails[this.customIndex++];
            return {
                type: 'custom_file',
                address: addr,
                pollVerifyLink: async () => null,
            };
        }

        // Chu kỳ thử nghiệm các email provider uy tín (Ưu tiên tempmaillol)
        let chosen = 'tempmaillol';
        if (preferredProvider && preferredProvider !== 'auto') {
            chosen = preferredProvider;
        } else {
            const cycle = ['tempmaillol', 'mailtm', 'guerrilla'];
            chosen = cycle[attempt % cycle.length];
        }

        try {
            if (chosen === 'tempmaillol') {
                return await this._generateTempMailLol();
            } else if (chosen === 'guerrilla') {
                return await this._generateGuerrilla();
            } else {
                return await this._generateMailTm();
            }
        } catch (err) {
            try {
                return await this._generateTempMailLol();
            } catch {
                return await this._generateGuerrilla();
            }
        }
    }

    async _generateMailTm() {
        let domain = 'maxxspace.com';
        try {
            const dRes = await axios.get('https://api.mail.tm/domains', { timeout: 6000 });
            const list = dRes.data?.['hydra:member'] || [];
            const active = list.filter(d => d.isActive);
            if (active.length > 0) domain = active[Math.floor(Math.random() * active.length)].domain;
        } catch {}

        const rand = crypto.randomBytes(6).toString('hex');
        const address = `usr${rand}@${domain}`;
        const password = crypto.randomBytes(8).toString('hex') + 'Aa1!';

        await axios.post('https://api.mail.tm/accounts', { address, password }, { timeout: 8000 });
        const auth = await axios.post('https://api.mail.tm/token', { address, password }, { timeout: 8000 });
        const jwt = auth.data?.token;

        return {
            type: 'mail.tm',
            address,
            jwt,
            pollVerifyLink: async (timeoutMs = CONFIG.EMAIL_POLL_MAX_WAIT) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    try {
                        const res = await axios.get('https://api.mail.tm/messages', {
                            headers: { 'Authorization': `Bearer ${jwt}` },
                            timeout: 6000
                        });
                        const msgs = res.data?.['hydra:member'] || [];
                        for (const m of msgs) {
                            const detail = await axios.get(`https://api.mail.tm/messages/${m.id}`, {
                                headers: { 'Authorization': `Bearer ${jwt}` },
                                timeout: 6000
                            });
                            const body = detail.data?.html?.[0] || detail.data?.text || '';
                            const link = extractDiscordLink(body);
                            if (link) return link;
                        }
                    } catch {}
                    await sleep(CONFIG.EMAIL_POLL_INTERVAL);
                }
                return null;
            }
        };
    }

    async _generateTempMailLol() {
        const res = await axios.get('https://api.tempmail.lol/v2/inbox/create', { timeout: 7000 });
        const { address, token } = res.data;
        return {
            type: 'tempmail.lol',
            address,
            token,
            pollVerifyLink: async (timeoutMs = CONFIG.EMAIL_POLL_MAX_WAIT) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    try {
                        const r = await axios.get(`https://api.tempmail.lol/v2/inbox?token=${token}`, { timeout: 6000 });
                        const emails = r.data?.emails || [];
                        for (const em of emails) {
                            const body = em.html || em.body || '';
                            const link = extractDiscordLink(body);
                            if (link) return link;
                        }
                    } catch {}
                    await sleep(CONFIG.EMAIL_POLL_INTERVAL);
                }
                return null;
            }
        };
    }

    async _generateGuerrilla() {
        const init = await axios.get('https://api.guerrillamail.com/ajax.php?f=get_email_address', { timeout: 7000 });
        const sid = init.data.sid_token;
        const userPart = (init.data.email_addr || '').split('@')[0] || `usr${Date.now()}`;
        const address = `${userPart}@sharklasers.com`;

        return {
            type: 'guerrillamail (sharklasers)',
            address,
            sid,
            pollVerifyLink: async (timeoutMs = CONFIG.EMAIL_POLL_MAX_WAIT) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    try {
                        const r = await axios.get(`https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${sid}`, { timeout: 6000 });
                        const list = r.data?.list || [];
                        for (const item of list) {
                            if (item.mail_from?.toLowerCase().includes('discord') || item.mail_subject?.toLowerCase().includes('discord')) {
                                const fetchRes = await axios.get(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${item.mail_id}&sid_token=${sid}`, { timeout: 6000 });
                                const body = fetchRes.data?.mail_body || '';
                                const link = extractDiscordLink(body);
                                if (link) return link;
                            }
                        }
                    } catch {}
                    await sleep(CONFIG.EMAIL_POLL_INTERVAL);
                }
                return null;
            }
        };
    }
}

function extractDiscordLink(body) {
    if (!body) return null;
    const cleanBody = body.replace(/&amp;/g, '&');
    // 1. Tìm href trong thẻ <a> trước
    const hrefMatch = cleanBody.match(/href=["'](https:\/\/click\.discord\.com\/ls\/click\?upn=[^"'\s>]+)["']/i)
        || cleanBody.match(/href=["'](https:\/\/discord\.com\/verify\?token=[^"'\s>]+)["']/i);
    if (hrefMatch) return hrefMatch[1];

    // 2. Tìm link URL raw
    const m = cleanBody.match(/https:\/\/click\.discord\.com\/ls\/click\?upn=[^\s"'<>)]+/i)
        || cleanBody.match(/https:\/\/discord\.com\/verify\?token=[^\s"'<>)]+/i)
        || cleanBody.match(/https:\/\/discord\.com\/api\/v\d+\/auth\/verify\?[^\s"'<>)]+/i);
    if (m) return m[0].replace(/[)>.,;'"]+$/, '');

    // 3. Fallback bất kỳ link Discord verify nào
    const fallback = cleanBody.match(/https:\/\/[^\s"'<>)]*discord[^\s"'<>)]*verify[^\s"'<>)]*/i);
    return fallback ? fallback[0].replace(/[)>.,;'"]+$/, '') : null;
}

// ─── WEBHOOK DISCORD ALERT ─────────────────────────
async function sendRegistrationWebhook({ username, email, password, token, emailVerified, proxyUsed }) {
    if (!CONFIG.WEBHOOK_URL) return;
    try {
        const payload = {
            username: 'Azure Account Generator',
            avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
            embeds: [{
                title: '⚡ Account Discord Đã Tạo Thành Công',
                description: `Tài khoản mới đã được đăng ký và xuất token thành công vào cơ sở dữ liệu.`,
                color: 0x30D158, // iOS Green
                fields: [
                    { name: '👤 Username', value: `\`${username}\``, inline: true },
                    { name: '📧 Email', value: `\`${email}\``, inline: true },
                    { name: '🛡️ Email Status', value: emailVerified ? '🟢 **Đã verify**' : '🟡 **Chưa verify (Token sống)**', inline: true },
                    { name: '🔑 Password', value: `\`${password}\``, inline: false },
                    { name: '🎫 Token Discord', value: `\`\`\`${token}\`\`\``, inline: false },
                    { name: '🌐 Network / Proxy', value: proxyUsed ? `\`${proxyUsed}\`` : '`Direct IP`', inline: true },
                    { name: '🕒 Thời gian (GMT+7)', value: getVNTimeString(), inline: true },
                ],
                footer: { text: 'Azure AI Team • Anti-Lag Auto Reg' },
                timestamp: new Date().toISOString()
            }]
        };
        await axios.post(CONFIG.WEBHOOK_URL, payload, { timeout: 8000 });
        console.log(C.green('  🔔 Webhook: Đã gửi thông báo về Discord thành công!'));
    } catch (err) {
        console.log(C.yellow(`  ⚠  Lỗi gửi webhook: ${err.message}`));
    }
}

// ─── FILE PERSISTENCE (LƯU NGAY LẬP TỨC) ───────────
function saveAccountImmediately({ email, password, token, username, emailVerified }) {
    try {
        if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
            fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
        }

        // 1. Lưu format email:password:token
        const fullLine = `${email}:${password}:${token}\n`;
        fs.appendFileSync(CONFIG.ACCOUNTS_FILE, fullLine, 'utf-8');

        // 2. Lưu format email:password (tiện đăng nhập tool / browser)
        const loginLine = `${email}:${password}\n`;
        fs.appendFileSync(CONFIG.ACCOUNTS_LOGIN_FILE, loginLine, 'utf-8');

        // 3. Lưu token riêng
        const tokenLine = `${token}\n`;
        fs.appendFileSync(CONFIG.TOKENS_FILE, tokenLine, 'utf-8');

        console.log(C.green(`  💾 Đã lưu vào ${C.bold(path.basename(CONFIG.ACCOUNTS_FILE))} & ${C.bold(path.basename(CONFIG.TOKENS_FILE))}`));
    } catch (err) {
        console.log(C.red(`  ✖ Lỗi lưu file: ${err.message}`));
    }
}

// ─── CAPTCHA WEB SERVER (Apple Liquid Glass Theme) ──
function serveCaptchaPage() {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>⚡ Discord Captcha Portal | Azure AI</title>
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
            --text-primary: #f5f5f7;
            --text-secondary: #86868b;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
            background: var(--bg-color);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            font-variant-numeric: tabular-nums;
            overflow-x: hidden;
        }
        .outer-card {
            background: var(--surface-outer);
            border: 1px solid var(--specular-border);
            border-radius: 28px;
            padding: 10px;
            box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.1);
            backdrop-filter: blur(40px);
            -webkit-backdrop-filter: blur(40px);
            max-width: 480px;
            width: 100%;
            transform: translateZ(0);
        }
        .inner-card {
            background: var(--surface-inner);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 20px;
            padding: 28px;
            text-align: center;
        }
        .island-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(41, 151, 255, 0.12);
            border: 1px solid rgba(41, 151, 255, 0.3);
            color: var(--ios-blue);
            font-size: 12px;
            font-weight: 600;
            padding: 6px 14px;
            border-radius: 999px;
            margin-bottom: 18px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        .pulse-dot {
            width: 7px;
            height: 7px;
            background: var(--ios-blue);
            border-radius: 50%;
            box-shadow: 0 0 8px var(--ios-blue);
        }
        h1 {
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.5px;
            margin-bottom: 8px;
        }
        p.subtitle {
            color: var(--text-secondary);
            font-size: 14px;
            margin-bottom: 22px;
            line-height: 1.4;
        }
        .meta-box {
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 14px;
            padding: 12px 16px;
            margin-bottom: 20px;
            text-align: left;
            font-size: 13px;
        }
        .meta-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
        }
        .meta-row:last-child { margin-bottom: 0; }
        .meta-label { color: var(--text-secondary); }
        .meta-val { color: var(--text-primary); font-weight: 500; font-family: monospace; }
        .captcha-box {
            min-height: 140px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 15px 0;
        }
        .status-pill {
            padding: 12px 16px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 500;
            margin-top: 14px;
            display: none;
        }
        .status-pill.loading { display: block; background: rgba(255, 159, 10, 0.1); border: 1px solid rgba(255, 159, 10, 0.3); color: var(--ios-orange); }
        .status-pill.waiting { display: block; background: rgba(41, 151, 255, 0.1); border: 1px solid rgba(41, 151, 255, 0.3); color: var(--ios-blue); }
        .status-pill.success { display: block; background: rgba(48, 209, 88, 0.1); border: 1px solid rgba(48, 209, 88, 0.3); color: var(--ios-green); }
        .status-pill.error { display: block; background: rgba(255, 69, 58, 0.1); border: 1px solid rgba(255, 69, 58, 0.3); color: var(--ios-coral); }
        .manual-input {
            margin-top: 18px;
            padding-top: 18px;
            border-top: 1px solid rgba(255,255,255,0.06);
            text-align: left;
        }
        .manual-input label {
            display: block;
            font-size: 11px;
            color: var(--text-secondary);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .input-row {
            display: flex;
            gap: 8px;
        }
        input[type="text"] {
            flex: 1;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--specular-border);
            border-radius: 10px;
            padding: 10px 14px;
            color: #fff;
            font-size: 13px;
            outline: none;
        }
        input[type="text"]:focus {
            border-color: var(--ios-blue);
        }
        button.btn-submit {
            background: var(--ios-blue);
            color: #fff;
            border: none;
            padding: 10px 16px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        button.btn-submit:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <div class="outer-card">
        <div class="inner-card">
            <div class="island-badge">
                <span class="pulse-dot"></span>
                <span>Active Captcha Portal</span>
            </div>
            <h1>Xác Thực Discord</h1>
            <p class="subtitle">Giải captcha bên dưới để hoàn tất việc đăng ký tài khoản tự động</p>

            <div class="meta-box">
                <div class="meta-row">
                    <span class="meta-label">Account Số:</span>
                    <span class="meta-val" id="meta-account">#1</span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">Username:</span>
                    <span class="meta-val" id="meta-username">Đang tạo...</span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">Email:</span>
                    <span class="meta-val" id="meta-email">Đang tạo...</span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">Dịch Vụ Captcha:</span>
                    <span class="meta-val" id="meta-service">Đang đợi config...</span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">Proxy Đang Gán:</span>
                    <span class="meta-val" id="meta-proxy" style="color: var(--ios-blue);">Direct</span>
                </div>
            </div>

            <div id="captcha-wrap" class="captcha-box">
                <div id="status-init" class="status-pill loading">⏳ Đang lấy captcha challenge từ Discord...</div>
            </div>

            <div id="status-box" class="status-pill"></div>

            <div class="manual-input">
                <label>Hoặc dán Token Captcha thủ công (nếu có):</label>
                <div class="input-row">
                    <input type="text" id="manual-token" placeholder="P0_eyJhbGciOi..." />
                    <button class="btn-submit" onclick="submitManual()">Gửi</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const urlParams = new URLSearchParams(window.location.search);
        const accountNum = urlParams.get('n') || '1';
        document.getElementById('meta-account').textContent = '#' + accountNum;

        let isLoaded = false;

        async function fetchConfig() {
            try {
                const res = await fetch('/captcha-config');
                const data = await res.json();
                if (data.username) document.getElementById('meta-username').textContent = data.username;
                if (data.email) document.getElementById('meta-email').textContent = data.email;
                if (data.service) document.getElementById('meta-service').textContent = data.service.toUpperCase();
                if (data.proxy) document.getElementById('meta-proxy').textContent = data.proxy;

                if (!data.sitekey) {
                    setTimeout(fetchConfig, 1500);
                    return;
                }

                if (!isLoaded) {
                    isLoaded = true;
                    document.getElementById('status-init').style.display = 'none';
                    renderCaptcha(data);
                }
            } catch (e) {
                setTimeout(fetchConfig, 2000);
            }
        }

        function renderCaptcha(config) {
            const wrap = document.getElementById('captcha-wrap');
            wrap.innerHTML = '';

            if (config.service === 'turnstile') {
                const script = document.createElement('script');
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
                script.async = true;
                script.defer = true;
                document.head.appendChild(script);

                const widgetDiv = document.createElement('div');
                widgetDiv.className = 'cf-turnstile';
                widgetDiv.setAttribute('data-sitekey', config.sitekey);
                widgetDiv.setAttribute('data-callback', 'onCaptchaSolved');
                widgetDiv.setAttribute('data-theme', 'dark');
                wrap.appendChild(widgetDiv);
            } else {
                // hCaptcha default
                const script = document.createElement('script');
                script.src = 'https://js.hcaptcha.com/1/api.js?onload=onHCaptchaLoaded&render=explicit&host=discord.com';
                script.async = true;
                script.defer = true;
                document.head.appendChild(script);

                window.onHCaptchaLoaded = function() {
                    const div = document.createElement('div');
                    div.id = 'hcap-box';
                    div.setAttribute('data-sitekey', config.sitekey);
                    if (config.rqdata) {
                        div.setAttribute('data-rqdata', config.rqdata);
                    }
                    wrap.appendChild(div);

                    const opts = {
                        sitekey: config.sitekey,
                        theme: 'dark',
                        callback: onCaptchaSolved,
                        host: 'discord.com',
                    };
                    if (config.rqdata) {
                        opts.rqdata = config.rqdata;
                        opts['data-rqdata'] = config.rqdata;
                        opts.data = config.rqdata;
                    }
                    try {
                        const widgetId = hcaptcha.render('hcap-box', opts);
                        if (config.rqdata && hcaptcha.setData) {
                            hcaptcha.setData(widgetId, { rqdata: config.rqdata });
                        }
                    } catch (e) {
                        console.error('Render err:', e);
                    }
                };
            }
        }

        function onCaptchaSolved(token) {
            const el = document.getElementById('status-box');
            el.className = 'status-pill waiting';
            el.textContent = '⏳ Đang gửi captcha token đến engine đăng ký...';

            fetch('/captcha-callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ captcha_key: token })
            })
            .then(r => r.json())
            .then(data => {
                if (data.ok) {
                    el.className = 'status-pill success';
                    el.textContent = '✅ Đã xác thực Captcha thành công! Kiểm tra kết quả tại Terminal.';
                } else {
                    el.className = 'status-pill error';
                    el.textContent = '❌ Lỗi server: ' + (data.error || 'Unknown');
                }
            })
            .catch(() => {
                el.className = 'status-pill error';
                el.textContent = '❌ Lỗi kết nối mạng!';
            });
        }

        function submitManual() {
            const token = document.getElementById('manual-token').value.trim();
            if (token) onCaptchaSolved(token);
        }

        fetchConfig();
    </script>
</body>
</html>`;
}

function startCaptchaServer() {
    return new Promise((resolve) => {
        let captchaResolve = null;
        let currentCaptchaConfig = null;

        const server = http.createServer((req, res) => {
            if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(serveCaptchaPage());
                return;
            }

            if (req.method === 'GET' && req.url === '/captcha-config') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(currentCaptchaConfig || {}));
                return;
            }

            if (req.method === 'POST' && req.url === '/captcha-callback') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const { captcha_key } = JSON.parse(body);
                        if (captcha_key && captchaResolve) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ ok: true }));
                            captchaResolve(captcha_key);
                            captchaResolve = null;
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ ok: false, error: 'No key or not ready' }));
                        }
                    } catch {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
                    }
                });
                return;
            }

            res.writeHead(404);
            res.end();
        });

        server.listen(CONFIG.CAPTCHA_PORT, '0.0.0.0', () => {
            resolve({
                server,
                setCaptchaConfig: (config) => {
                    currentCaptchaConfig = config;
                },
                waitForCaptcha: () => {
                    return new Promise((r) => {
                        captchaResolve = r;
                    });
                },
                close: () => server.close(),
            });
        });
    });
}

// ─── DISCORD CLIENT PROPERTIES ───────────────────
function getSuperProperties() {
    const props = {
        os: "Windows",
        browser: "Chrome",
        device: "",
        system_locale: "en-US",
        browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        browser_version: "131.0.0.0",
        os_version: "10",
        referrer: "",
        referring_domain: "",
        referrer_current: "",
        referring_domain_current: "",
        release_channel: "stable",
        client_build_number: 344837,
        client_event_source: null
    };
    return Buffer.from(JSON.stringify(props)).toString('base64');
}

// ─── DISCORD TLS-FRIENDLY HTTP BRIDGE ─────────────
function discordHttp({ url, method = 'GET', headers = {}, data = null, proxy = null, timeout = 15, sessionId = null }) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({ url, method, headers, data, proxy, timeout, session_id: sessionId });
        const child = execFile('python3', [BRIDGE_PATH], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (err) {
                return resolve({ status: 0, error: err.message });
            }
            try {
                const res = JSON.parse(stdout.trim());
                resolve(res);
            } catch (e) {
                resolve({ status: 0, error: 'JSON parse error: ' + stdout });
            }
        });
        child.stdin.write(payload);
        child.stdin.end();
    });
}

// ─── DISCORD REGISTRATION PIPELINE ────────────────
async function fetchFingerprint(proxyUrl, sessionId = null) {
    try {
        const superProps = getSuperProperties();
        const res = await discordHttp({
            url: `${CONFIG.API_BASE}/experiments`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'X-Super-Properties': superProps
            },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000,
            sessionId
        });
        return res.data?.fingerprint || null;
    } catch {
        return null;
    }
}

async function requestChallenge({ username, email, password, dob, proxyUrl, fingerprint = null, sessionId = null }) {
    const superProps = getSuperProperties();
    const payload = {
        email,
        username,
        global_name: username,
        password,
        invite: null,
        consent: true,
        date_of_birth: dob,
        unique_username_registration: true
    };

    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/register',
        'X-Super-Properties': superProps,
        ...(fingerprint ? { 'X-Fingerprint': fingerprint } : {})
    };

    const res = await discordHttp({
        url: `${CONFIG.API_BASE}/auth/register`,
        method: 'POST',
        headers,
        data: payload,
        proxy: proxyUrl,
        timeout: CONFIG.TIMEOUT / 1000,
        sessionId
    });

    if (res.data?.captcha_sitekey) {
        return {
            needsCaptcha: true,
            sitekey: res.data.captcha_sitekey,
            rqdata: res.data.captcha_rqdata || null,
            rqtoken: res.data.captcha_rqtoken || null,
            sessionId: res.data.captcha_session_id || null,
            service: res.data.captcha_service || 'hcaptcha',
        };
    }

    if ((res.status === 200 || res.status === 201) && res.data?.token) {
        return { needsCaptcha: false, success: true, data: res.data };
    }

    return { needsCaptcha: false, status: res.status, data: res.data };
}

async function submitFinalRegistration({ username, email, password, dob, captchaKey, rqtoken, sessionId, service = 'hcaptcha', proxyUrl, fingerprint = null, accountSessionId = null }) {
    const superProps = getSuperProperties();
    const payload = {
        email,
        username,
        global_name: username,
        password,
        invite: null,
        consent: true,
        date_of_birth: dob,
        unique_username_registration: true,
        captcha_key: captchaKey,
        captcha_service: service || 'hcaptcha',
        ...(rqtoken ? { captcha_rqtoken: rqtoken } : {}),
        ...(sessionId ? { captcha_session_id: sessionId } : {}),
    };

    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/register',
        'X-Captcha-Key': captchaKey,
        'X-Super-Properties': superProps,
        ...(fingerprint ? { 'X-Fingerprint': fingerprint } : {}),
        ...(rqtoken ? { 'X-Captcha-Rqtoken': rqtoken } : {}),
        ...(sessionId ? { 'X-Captcha-Session-Id': sessionId } : {}),
        ...(service ? { 'X-Captcha-Service': service } : {}),
    };

    const res = await discordHttp({
        url: `${CONFIG.API_BASE}/auth/register`,
        method: 'POST',
        headers,
        data: payload,
        proxy: proxyUrl,
        timeout: CONFIG.TIMEOUT / 1000,
        sessionId: accountSessionId
    });

    return { status: res.status, data: res.data };
}

async function resendVerificationEmail(token, proxyUrl, accountSessionId = null, fingerprint = null) {
    try {
        const superProps = getSuperProperties();
        const res = await discordHttp({
            url: `${CONFIG.API_BASE}/auth/verify/resend`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Origin': 'https://discord.com',
                'Referer': 'https://discord.com/channels/@me',
                'X-Super-Properties': superProps,
                ...(fingerprint ? { 'X-Fingerprint': fingerprint } : {})
            },
            data: {},
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000,
            sessionId: accountSessionId
        });
        return res.status === 204 || res.status === 200;
    } catch {
        return false;
    }
}

async function verifyEmailToken(verifyUrl, token, proxyUrl, accountSessionId = null, fingerprint = null) {
    try {
        let emailToken = null;

        // 1. Kiểm tra trực tiếp token trong query param của URL
        const directMatch = verifyUrl.match(/[?&]token=([^&"'\s<>#]+)/i);
        if (directMatch) {
            emailToken = directMatch[1];
        }

        // 2. Nếu là SendGrid link click.discord.com hoặc chưa có token, GET link để follow redirect
        if (!emailToken || verifyUrl.includes('click.discord.com')) {
            const res1 = await discordHttp({
                url: verifyUrl,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9'
                },
                proxy: proxyUrl,
                timeout: CONFIG.TIMEOUT / 1000,
                sessionId: accountSessionId
            });

            const finalUrl = res1.final_url || '';
            const matchFinal = finalUrl.match(/[?&]token=([^&"'\s<>#]+)/i);
            if (matchFinal) {
                emailToken = matchFinal[1];
            } else {
                const loc = res1.headers?.location || res1.headers?.Location || '';
                const matchLoc = loc.match(/[?&]token=([^&"'\s<>#]+)/i);
                if (matchLoc) {
                    emailToken = matchLoc[1];
                } else {
                    const bodyStr = typeof res1.data === 'string' ? res1.data : JSON.stringify(res1.data || {});
                    const matchBody = bodyStr.match(/[?&]token=([^&"'\s<>#]+)/i) || bodyStr.match(/"token":\s*"([^"]+)"/);
                    if (matchBody) emailToken = matchBody[1];
                }
            }
        }

        if (!emailToken) {
            return { success: false, error: 'Không trích xuất được email token từ link xác thực' };
        }

        // 3. Gửi verify token lên Discord API
        const superProps = getSuperProperties();
        const res2 = await discordHttp({
            url: `${CONFIG.API_BASE}/auth/verify`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Origin': 'https://discord.com',
                'Referer': 'https://discord.com/verify',
                'X-Super-Properties': superProps,
                ...(fingerprint ? { 'X-Fingerprint': fingerprint } : {})
            },
            data: {
                captcha_key: null,
                token: emailToken
            },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000,
            sessionId: accountSessionId
        });

        if (res2.status === 200 || res2.status === 201) {
            const updatedToken = res2.data?.token || token;
            return { success: true, token: updatedToken, data: res2.data };
        }
        return { success: false, error: `HTTP ${res2.status}: ${JSON.stringify(res2.data)}` };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─── GATEWAY WEBSOCKET WARMUP & HEARTBEAT ─────────
function connectGatewayWebSocket(token, proxyUrl, durationMs = 12000) {
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
            resolve(true);
        }, durationMs);

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
                    // Opcode 10: HELLO -> Bắt đầu Heartbeat & Gửi IDENTIFY
                    if (msg.op === 10) {
                        const interval = msg.d.heartbeat_interval;
                        // Gửi heartbeat đầu tiên
                        ws.send(JSON.stringify({ op: 1, d: null }));
                        heartbeatTimer = setInterval(() => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ op: 1, d: null }));
                            }
                        }, Math.min(interval, 8000));

                        // Gửi Opcode 2: IDENTIFY (Mô phỏng đầy đủ Discord Web Client)
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
                                    referrer: '',
                                    referring_domain: '',
                                    referrer_current: '',
                                    referring_domain_current: '',
                                    release_channel: 'stable',
                                    client_build_number: 345000,
                                    client_event_source: null
                                },
                                presence: {
                                    status: 'online',
                                    since: 0,
                                    activities: [],
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
                    // Opcode 0: READY -> Discord đã xác nhận session của User
                    if (msg.op === 0 && msg.t === 'READY') {
                        // User session đã được thiết lập thành công
                    }
                } catch {}
            });

            ws.on('error', () => {
                cleanup();
                clearTimeout(timer);
                resolve(false);
            });

            ws.on('close', () => {
                cleanup();
                clearTimeout(timer);
                resolve(true);
            });
        } catch {
            cleanup();
            clearTimeout(timer);
            resolve(false);
        }
    });
}

// ─── TOKEN LONG-LIFE WARMUP (PHƯƠNG PHÁP SỐNG 1 THÁNG - 1 NĂM) ───
async function warmupAccount({ token, proxyUrl, accountSessionId, fingerprint, username }) {
    console.log(C.blue('\n  🔥 [LIVE WARMUP] Bắt đầu kích hoạt phương pháp nuôi token sống lâu...'));

    // 1. Tham gia HypeSquad House (Tăng Trust Score uy tín cao)
    try {
        process.stdout.write(`    ${C.gray('🛡️  Gia nhập HypeSquad House...')} `);
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
                'X-Super-Properties': getSuperProperties(),
                ...(fingerprint ? { 'X-Fingerprint': fingerprint } : {})
            },
            data: { house_id: houseId },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000,
            sessionId: accountSessionId
        });
        if (res.status === 204 || res.status === 200) {
            console.log(C.green(`OK (House of ${houseNames[houseId]})`));
        } else {
            console.log(C.yellow(`Skip (HTTP ${res.status})`));
        }
    } catch {
        console.log(C.yellow('Skip'));
    }

    // 2. Thiết lập Client Settings chuẩn (Dark theme, locale en-US, reactions)
    try {
        process.stdout.write(`    ${C.gray('⚙️  Cấu hình Client Settings chuẩn (Dark theme, locale)...')} `);
        const res = await discordHttp({
            url: `${CONFIG.API_BASE}/users/@me/settings`,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Origin': 'https://discord.com',
                'Referer': 'https://discord.com/channels/@me',
                'X-Super-Properties': getSuperProperties(),
                ...(fingerprint ? { 'X-Fingerprint': fingerprint } : {})
            },
            data: {
                theme: 'dark',
                developer_mode: false,
                animate_emoji: true,
                render_reactions: true,
                gif_auto_play: true,
                inline_attachment_media: true,
                inline_embed_media: true,
                enable_tts_command: false,
                locale: 'en-US',
                status: 'online'
            },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000,
            sessionId: accountSessionId
        });
        if (res.status === 200) {
            console.log(C.green('OK'));
        } else {
            console.log(C.yellow(`Skip (HTTP ${res.status})`));
        }
    } catch {
        console.log(C.yellow('Skip'));
    }

    // 3. Cập nhật Profile Bio & Pronouns tự nhiên
    try {
        process.stdout.write(`    ${C.gray('👤 Cập nhật Profile Bio & Pronouns...')} `);
        const bios = [
            'just chilling ☕',
            'gaming and coding 🎮',
            'listening to music 🎧',
            'vibing with friends ✨',
            'silent observer 🌙',
            'student & tech enthusiast',
            'lofi beats & good vibes',
            'afk most of the time 🌿'
        ];
        const pronounsList = ['he/him', 'they/them', 'she/her', 'he/they'];
        const randomBio = bios[Math.floor(Math.random() * bios.length)];
        const randomPronouns = pronounsList[Math.floor(Math.random() * pronounsList.length)];

        const res = await discordHttp({
            url: `${CONFIG.API_BASE}/users/%40me/profile`,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Origin': 'https://discord.com',
                'Referer': 'https://discord.com/channels/@me',
                'X-Super-Properties': getSuperProperties(),
                ...(fingerprint ? { 'X-Fingerprint': fingerprint } : {})
            },
            data: {
                bio: randomBio,
                pronouns: randomPronouns
            },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000,
            sessionId: accountSessionId
        });
        if (res.status === 200) {
            console.log(C.green(`OK ("${randomBio}")`));
        } else {
            console.log(C.yellow(`Skip (HTTP ${res.status})`));
        }
    } catch {
        console.log(C.yellow('Skip'));
    }

    // 4. Mô phỏng Client Navigation Telemetry
    try {
        await discordHttp({
            url: `${CONFIG.API_BASE}/users/@me/library`,
            method: 'GET',
            headers: { 'Authorization': token, 'X-Super-Properties': getSuperProperties() },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000,
            sessionId: accountSessionId
        });
        await discordHttp({
            url: `${CONFIG.API_BASE}/users/@me/affinities/users`,
            method: 'GET',
            headers: { 'Authorization': token, 'X-Super-Properties': getSuperProperties() },
            proxy: proxyUrl,
            timeout: CONFIG.TIMEOUT / 1000,
            sessionId: accountSessionId
        });
    } catch {}

    // 5. Kết nối Gateway WebSocket & Gửi IDENTIFY (Yếu tố quyết định sống lâu)
    try {
        process.stdout.write(`    ${C.gray('🔌 Kết nối Gateway WebSocket (IDENTIFY + 12s Heartbeat)...')} `);
        const gwSuccess = await connectGatewayWebSocket(token, proxyUrl, 12000);
        if (gwSuccess) {
            console.log(C.green('READY (Session active & Heartbeat online)'));
        } else {
            console.log(C.yellow('Skip (Gateway timeout)'));
        }
    } catch (e) {
        console.log(C.yellow(`Skip (${e.message})`));
    }

    console.log(C.green('  ✅ [LIVE WARMUP] Đã hoàn tất kích hoạt! Token có độ tin cậy tối đa.\n'));
}

// ─── CLI PARSER ────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        count: 1,
        useProxy: false,
        customUsername: null,
        customEmail: null,
        webhookUrl: CONFIG.WEBHOOK_URL,
        provider: 'tempmaillol',
        skipWarmup: false,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '-n':
            case '--count':
                opts.count = parseInt(args[++i]) || 1;
                opts.count = Math.min(Math.max(opts.count, 1), 20);
                break;
            case '--proxy':
            case '-p':
                opts.useProxy = true;
                break;
            case '--username':
            case '-u':
                opts.customUsername = args[++i];
                break;
            case '--email':
            case '-e':
                opts.customEmail = args[++i];
                break;
            case '--provider':
            case '-m':
                opts.provider = args[++i];
                break;
            case '--webhook':
            case '-w':
                opts.webhookUrl = args[++i];
                break;
            case '--skip-warmup':
                opts.skipWarmup = true;
                break;
            case '-h':
            case '--help':
                console.log(`
  Usage:
    node token_register.cjs                   # Đăng ký 1 account + Auto Verify Mail + Live Warmup
    node token_register.cjs -n 3              # Đăng ký 3 accounts
    node token_register.cjs --proxy           # Dùng rotating proxy
    node token_register.cjs -u "MyName"       # Tùy chỉnh username
    node token_register.cjs -e "my@email.com" # Dùng email chỉ định
    node token_register.cjs -m tempmaillol    # Chọn provider (tempmaillol / guerrilla / mailtm)
    node token_register.cjs -w "WEBHOOK_URL"  # Webhook Discord nhận alert
    node token_register.cjs --skip-warmup     # Bỏ qua bước Live Warmup (nếu cần reg nhanh)
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
    console.log(C.purple('  ║') + C.bold(C.white('        ⚡ DISCORD ACCOUNT GENERATOR v2.0 ⚡                 ')) + C.purple('║'));
    console.log(C.purple('  ║') + C.gray('   Manual Captcha + Multi-Provider Temp Mail + Auto Webhook    ') + C.purple('║'));
    console.log(C.purple('  ║') + C.cyan('                 by Azure AI Team                             ') + C.purple('║'));
    console.log(C.purple('  ╚══════════════════════════════════════════════════════════════╝'));
    console.log('');

    const opts = parseArgs();
    if (opts.webhookUrl) CONFIG.WEBHOOK_URL = opts.webhookUrl;

    const proxyPool = new ProxyPool(CONFIG.PROXY_FILE);
    if (opts.useProxy) proxyPool.enable();

    const mailManager = new TempMailManager();

    console.log(C.blue(`📋 Kế hoạch: Đăng ký ${C.bold(C.white(String(opts.count)))} account(s)`));
    console.log(C.gray(`   Chế độ mạng: ${opts.useProxy ? 'Rotating Sticky Proxy' : 'Direct IP'}`));
    console.log(C.gray(`   Lưu kết quả: ${CONFIG.ACCOUNTS_FILE}`));
    console.log(C.gray(`   Webhook Alert: ${CONFIG.WEBHOOK_URL ? C.green('Bật') : C.yellow('Tắt')}`));
    console.log(C.gray('─'.repeat(55)));

    // Khởi động server Captcha cục bộ
    console.log(C.yellow('\n🌐 Đang khởi chạy Captcha Server tại cổng 7890...'));
    const captchaServer = await startCaptchaServer();
    console.log(C.green(`✅ Captcha server đã sẵn sàng!`));
    console.log(C.bold(C.cyan(`   👉 Mở trình duyệt truy cập: http://localhost:${CONFIG.CAPTCHA_PORT}\n`)));

    const registeredAccounts = [];

    for (let i = 0; i < opts.count; i++) {
        const num = i + 1;
        console.log(C.gray('─'.repeat(55)));
        console.log(C.bold(C.white(`  📝 Đang xử lý Account #${num}/${opts.count}`)));

        // Chọn proxy sticky cho toàn bộ phiên của account này
        let proxyObj = proxyPool.getProxyForAccount(i);
        let agent = proxyPool.createAgent(proxyObj);
        if (proxyObj) {
            console.log(C.gray(`  🌐 Proxy: ${proxyObj.ip}`));
        }

        const accountSessionId = crypto.randomUUID();
        const username = generateUsername(opts.count === 1 ? opts.customUsername : null);
        const password = generatePassword();
        const dob = generateDOB();

        // Lấy fingerprint và khởi tạo session cookie
        process.stdout.write(`  ${C.gray('🔍 Lấy fingerprint & session...')} `);
        const fingerprint = await fetchFingerprint(proxyObj ? proxyObj.url : null, accountSessionId);
        if (fingerprint) {
            console.log(C.green('OK'));
        } else {
            console.log(C.yellow('Skip (thử trực tiếp)'));
        }

        let regSuccess = false;
        let finalToken = null;
        let activeEmailObj = null;

        // Vòng lặp thử các email provider nếu dính EMAIL_ALREADY_REGISTERED
        for (let attempt = 0; attempt < CONFIG.MAX_EMAIL_RETRIES; attempt++) {
            activeEmailObj = await mailManager.generateEmail(attempt, opts.customEmail, opts.provider);
            console.log(`\n  ${C.gray('👤 Username:')} ${C.cyan(username)}`);
            console.log(`  ${C.gray('📧 Email:')}    ${C.cyan(activeEmailObj.address)} ${C.dim(`(${activeEmailObj.type})`)}`);
            console.log(`  ${C.gray('🔑 Password:')} ${C.cyan(password)}`);

            process.stdout.write(`  ${C.blue('📡 Yêu cầu Captcha Challenge từ Discord...')} `);
            const challenge = await requestChallenge({
                username,
                email: activeEmailObj.address,
                password,
                dob,
                proxyUrl: proxyObj ? proxyObj.url : null,
                fingerprint,
                sessionId: accountSessionId
            });

            if (challenge.needsCaptcha) {
                console.log(C.green(`OK → ${challenge.service} (Sitekey: ${challenge.sitekey.slice(0, 10)}...)`));

                captchaServer.setCaptchaConfig({
                    sitekey: challenge.sitekey,
                    rqdata: challenge.rqdata,
                    service: challenge.service,
                    username,
                    email: activeEmailObj.address,
                    proxy: proxyObj ? proxyObj.raw : 'Direct',
                });

                console.log(C.yellow(`  🧩 Đang đợi bạn giải captcha trên trình duyệt (http://localhost:${CONFIG.CAPTCHA_PORT}?n=${num})...`));
                const captchaKey = await captchaServer.waitForCaptcha();
                console.log(C.green('  ✅ Captcha Token đã nhận!'));

                process.stdout.write(`  ${C.blue('📡 Đang gửi thông tin đăng ký...')} `);
                const submitRes = await submitFinalRegistration({
                    username,
                    email: activeEmailObj.address,
                    password,
                    dob,
                    captchaKey,
                    rqtoken: challenge.rqtoken,
                    sessionId: challenge.sessionId,
                    service: challenge.service,
                    proxyUrl: proxyObj ? proxyObj.url : null,
                    fingerprint,
                    accountSessionId
                });

                if ((submitRes.status === 200 || submitRes.status === 201) && submitRes.data?.token) {
                    finalToken = submitRes.data.token;
                    regSuccess = true;
                    console.log(C.bgGreen('THÀNH CÔNG'));
                    break;
                } else {
                    console.log(C.bgRed('THẤT BẠI'));
                    console.log(C.red(`  ❌ HTTP ${submitRes.status}: ${JSON.stringify(submitRes.data)}`));
                    if (submitRes.data?.errors?.email) {
                        console.log(C.yellow('  ⚠  Email không hợp lệ hoặc đã đăng ký, thử lại với email mới...'));
                        continue;
                    }
                    break;
                }

            } else if (challenge.success) {
                finalToken = challenge.data.token;
                regSuccess = true;
                console.log(C.bgGreen('THÀNH CÔNG (Không cần captcha)'));
                break;
            } else {
                console.log(C.red('FAIL'));
                if (challenge.data?.errors?.email) {
                    console.log(C.yellow(`  ⚠  Email bị từ chối (${activeEmailObj.type}), tự động chuyển email provider khác...`));
                    continue;
                }
                if (challenge.data?.retry_after) {
                    console.log(C.yellow(`  ⚠  ${proxyObj ? 'Proxy ' + proxyObj.ip : 'Direct IP'} bị Rate-limit (${challenge.data.retry_after}s).`));
                    if (proxyObj) {
                        proxyPool.markRateLimited(proxyObj.url, challenge.data.retry_after);
                        if (proxyPool.enabled) {
                            proxyObj = proxyPool.getProxyForAccount(i + attempt + 1);
                            console.log(C.blue(`  🔄 Đã xoay sang Proxy mới: ${proxyObj ? proxyObj.ip : 'Direct'}`));
                        }
                    } else {
                        const waitSec = Math.ceil(challenge.data.retry_after) + 2;
                        console.log(C.yellow(`  ⏳ Đang đợi hết rate-limit Direct IP (${waitSec}s)...`));
                        await sleep(waitSec * 1000);
                    }
                    continue;
                }
                break;
            }
        }

        // Xử lý kết quả sau khi đăng ký
        if (regSuccess && finalToken) {
            console.log(`  ${C.green('🎫 Token Ban Đầu:')} ${C.dim(finalToken)}`);

            // Verify email nếu có hỗ trợ
            let emailVerified = false;
            if (activeEmailObj && activeEmailObj.pollVerifyLink) {
                console.log(C.gray('  📧 Đang chờ link verify từ hộp thư đến...'));

                // Tự động trigger gửi lại mail sau 5 giây nếu chưa nhận được
                const resendTimer = setTimeout(async () => {
                    await resendVerificationEmail(finalToken, proxyObj ? proxyObj.url : null, accountSessionId, fingerprint);
                }, 5000);

                const verifyLink = await activeEmailObj.pollVerifyLink(45000);
                clearTimeout(resendTimer);

                if (verifyLink) {
                    process.stdout.write(`  ${C.blue('📧 Xác thực Email token...')} `);
                    const vRes = await verifyEmailToken(verifyLink, finalToken, proxyObj ? proxyObj.url : null, accountSessionId, fingerprint);
                    if (vRes.success) {
                        emailVerified = true;
                        if (vRes.token) finalToken = vRes.token;
                        console.log(C.bgGreen('VERIFIED'));
                    } else {
                        console.log(C.yellow(`SKIP (${vRes.error || 'Lỗi link'})`));
                    }
                } else {
                    console.log(C.yellow('  ⚠  Không nhận được email verify kịp thời (Token vẫn hoạt động)'));
                }
            }

            // Kích hoạt cơ chế Live Warmup (giúp token sống lâu 1 tháng - 1 năm)
            if (!opts.skipWarmup) {
                await warmupAccount({
                    token: finalToken,
                    proxyUrl: proxyObj ? proxyObj.url : null,
                    accountSessionId,
                    fingerprint,
                    username
                });
            }

            // 1. Lưu lập tức vào file TXT (Append)
            saveAccountImmediately({
                email: activeEmailObj.address,
                password,
                token: finalToken,
                username,
                emailVerified
            });

            // 2. Bắn Webhook Discord Alert
            await sendRegistrationWebhook({
                username,
                email: activeEmailObj.address,
                password,
                token: finalToken,
                emailVerified,
                proxyUsed: proxyObj ? proxyObj.ip : null
            });

            registeredAccounts.push({
                index: num,
                username,
                email: activeEmailObj.address,
                password,
                dob,
                token: finalToken,
                email_verified: emailVerified,
                registered_at: new Date().toISOString()
            });

            console.log(C.green(`  🎉 Account #${num} hoàn thành xuất sắc!\n`));
        } else {
            console.log(C.red(`  ❌ Không thể hoàn tất Account #${num}\n`));
        }

        if (i < opts.count - 1) {
            console.log(C.gray('  ⏳ Đợi jitter trước lượt tiếp theo...'));
            await jitter();
        }
    }

    // ─── TỔNG KẾT ──────────────────────────────────────
    console.log(C.gray('═'.repeat(55)));
    console.log(C.bold(C.white('  📊 TỔNG KẾT TIẾN TRÌNH')));
    console.log(C.gray('═'.repeat(55)));
    const successList = registeredAccounts.filter(a => a.token);
    console.log(`  ${C.green('✅ Thành công:')} ${C.bold(C.green(String(successList.length)))}`);
    console.log(`  ${C.red('❌ Thất bại:')}   ${C.bold(C.red(String(opts.count - successList.length)))}`);
    console.log(`  ${C.cyan('🕒 Hoàn thành:')} ${getVNTimeString()}`);
    console.log('');

    captchaServer.close();
    process.exit(0);
}

main().catch(err => {
    console.error(C.red(`\n✖ Lỗi nghiêm trọng: ${err.message}`));
    process.exit(1);
});
