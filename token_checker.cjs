/**
 * ╔══════════════════════════════════════════════════╗
 * ║       DISCORD TOKEN CHECKER & KILLER v2.0        ║
 * ║       by Azure AI Team                           ║
 * ╚══════════════════════════════════════════════════╝
 * 
 * Usage:
 *   node token_checker.cjs                       # Check từ tokens.txt
 *   node token_checker.cjs -f my_tokens.txt      # Check từ file chỉ định
 *   node token_checker.cjs -t TOKEN1 TOKEN2      # Check trực tiếp
 *   node token_checker.cjs --proxy               # Bật rotating proxy
 *   node token_checker.cjs --no-color            # Tắt màu
 * 
 * Kill Modes:
 *   node token_checker.cjs --kill                # Check → Kill tất cả valid tokens
 *   node token_checker.cjs --kill-only           # Kill thẳng không check info
 *   node token_checker.cjs --kill-invalid        # Kill locked/phone-locked, giữ valid
 *   node token_checker.cjs --kill -y             # Kill không hỏi xác nhận
 * 
 * Output:
 *   results/checked_YYYY-MM-DD_HHmmss.json       # Kết quả đầy đủ
 *   results/valid.txt                             # Token còn sống
 *   results/killed.txt                            # Token đã chết
 *   results/killed_success.txt                    # Token đã kill thành công
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = (() => {
    try { return require('https-proxy-agent'); } catch { return {}; }
})();

// ─── CONFIG ────────────────────────────────────────
const CONFIG = {
    API_BASE: 'https://discord.com/api/v10',
    TIMEOUT_CONNECT: 5000,
    TIMEOUT_READ: 8000,
    JITTER_MIN: 500,    // ms - delay tối thiểu giữa các request
    JITTER_MAX: 1200,   // ms - delay tối đa
    BATCH_SIZE: 1,      // Check từng token 1
    MAX_RETRIES: 2,     // Retry khi gặp 429/network error
    PROXY_FILE: path.join(__dirname, 'proxy.txt'),
    DEFAULT_TOKEN_FILE: path.join(__dirname, 'tokens.txt'),
    RESULTS_DIR: path.join(__dirname, 'results'),
};

// ─── COLORS ────────────────────────────────────────
let useColor = true;
const C = {
    reset: () => useColor ? '\x1b[0m' : '',
    bold: (s) => useColor ? `\x1b[1m${s}\x1b[0m` : s,
    dim: (s) => useColor ? `\x1b[2m${s}\x1b[0m` : s,
    green: (s) => useColor ? `\x1b[38;5;48m${s}\x1b[0m` : s,
    red: (s) => useColor ? `\x1b[38;5;196m${s}\x1b[0m` : s,
    yellow: (s) => useColor ? `\x1b[38;5;220m${s}\x1b[0m` : s,
    blue: (s) => useColor ? `\x1b[38;5;39m${s}\x1b[0m` : s,
    purple: (s) => useColor ? `\x1b[38;5;141m${s}\x1b[0m` : s,
    cyan: (s) => useColor ? `\x1b[38;5;87m${s}\x1b[0m` : s,
    gray: (s) => useColor ? `\x1b[38;5;245m${s}\x1b[0m` : s,
    white: (s) => useColor ? `\x1b[97m${s}\x1b[0m` : s,
    bgGreen: (s) => useColor ? `\x1b[42;30m ${s} \x1b[0m` : `[${s}]`,
    bgRed: (s) => useColor ? `\x1b[41;97m ${s} \x1b[0m` : `[${s}]`,
    bgYellow: (s) => useColor ? `\x1b[43;30m ${s} \x1b[0m` : `[${s}]`,
    bgBlue: (s) => useColor ? `\x1b[44;97m ${s} \x1b[0m` : `[${s}]`,
    bgPurple: (s) => useColor ? `\x1b[45;97m ${s} \x1b[0m` : `[${s}]`,
};

// ─── PROXY MANAGER ─────────────────────────────────
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
            console.log(C.yellow('⚠  Không tìm thấy proxy trong proxy.txt, chạy direct'));
            return;
        }
        this.enabled = true;
        console.log(C.blue(`🔄 Proxy Pool: ${this.proxies.length} proxies loaded`));
    }

    next() {
        if (!this.enabled || this.proxies.length === 0) return null;
        const proxy = this.proxies[this.index % this.proxies.length];
        this.index++;
        return this._toUrl(proxy);
    }

    _toUrl(proxy) {
        const parts = proxy.split(':');
        if (parts.length === 4) {
            // host:port:user:pass
            return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
        } else if (parts.length === 2) {
            // host:port
            return `http://${parts[0]}:${parts[1]}`;
        }
        return `http://${proxy}`;
    }
}

// ─── TOKEN STATUS CLASSIFIER ──────────────────────
function classifyResponse(status, data) {
    switch (status) {
        case 200:
            return {
                status: 'VALID',
                badge: C.bgGreen('VALID'),
                info: data,
            };
        case 401:
            return {
                status: 'KILLED',
                badge: C.bgRed('KILLED'),
                info: { message: 'Token không hợp lệ hoặc đã bị vô hiệu hóa' },
            };
        case 403:
            // Phân biệt locked vs phone verification
            const msg = data?.message || '';
            if (msg.includes('phone') || msg.includes('verify')) {
                return {
                    status: 'PHONE_LOCKED',
                    badge: C.bgYellow('PHONE'),
                    info: { message: 'Yêu cầu xác minh số điện thoại' },
                };
            }
            return {
                status: 'LOCKED',
                badge: C.bgPurple('LOCKED'),
                info: { message: data?.message || 'Tài khoản bị khóa' },
            };
        case 429:
            return {
                status: 'RATE_LIMITED',
                badge: C.bgYellow('429'),
                info: { retry_after: data?.retry_after },
            };
        default:
            return {
                status: 'UNKNOWN',
                badge: C.bgBlue(`${status}`),
                info: data,
            };
    }
}

// ─── JITTER DELAY ──────────────────────────────────
function jitterDelay() {
    const ms = CONFIG.JITTER_MIN + Math.random() * (CONFIG.JITTER_MAX - CONFIG.JITTER_MIN);
    return new Promise(r => setTimeout(r, ms));
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── MASK TOKEN ────────────────────────────────────
function maskToken(token) {
    if (token.length <= 20) return token.slice(0, 6) + '•'.repeat(8) + token.slice(-4);
    return token.slice(0, 10) + '•'.repeat(12) + token.slice(-6);
}

// ─── CHECK SINGLE TOKEN ───────────────────────────
async function checkToken(token, proxyPool, attempt = 0) {
    const headers = {
        'Authorization': token,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };

    const axiosConfig = {
        method: 'GET',
        url: `${CONFIG.API_BASE}/users/@me`,
        headers,
        timeout: CONFIG.TIMEOUT_READ,
        validateStatus: () => true, // Không throw ở bất kỳ status nào
    };

    // Proxy agent
    const proxyUrl = proxyPool.next();
    if (proxyUrl && HttpsProxyAgent) {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
        axiosConfig.timeout = CONFIG.TIMEOUT_CONNECT + CONFIG.TIMEOUT_READ;
    }

    try {
        const res = await axios(axiosConfig);
        const result = classifyResponse(res.status, res.data);

        // Rate limited → retry
        if (result.status === 'RATE_LIMITED' && attempt < CONFIG.MAX_RETRIES) {
            const waitMs = (res.data?.retry_after || 3) * 1000 + 500;
            console.log(C.yellow(`   ⏳ Rate limited, đợi ${(waitMs / 1000).toFixed(1)}s rồi thử lại...`));
            await sleep(waitMs);
            return checkToken(token, proxyPool, attempt + 1);
        }

        return result;
    } catch (err) {
        // Network error → retry với proxy mới
        if (attempt < CONFIG.MAX_RETRIES) {
            console.log(C.gray(`   ↻ Network error, retry (${attempt + 1}/${CONFIG.MAX_RETRIES})...`));
            await sleep(1000);
            return checkToken(token, proxyPool, attempt + 1);
        }
        return {
            status: 'ERROR',
            badge: C.bgRed('ERROR'),
            info: { message: err.code || err.message },
        };
    }
}

// ─── KILL SINGLE TOKEN ────────────────────────────
async function killToken(token, proxyPool, attempt = 0) {
    const headers = {
        'Authorization': token,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };

    const axiosConfig = {
        method: 'POST',
        url: `${CONFIG.API_BASE}/auth/logout`,
        headers,
        data: { provider: null, voip_provider: null },
        timeout: CONFIG.TIMEOUT_READ,
        validateStatus: () => true,
    };

    const proxyUrl = proxyPool.next();
    if (proxyUrl && HttpsProxyAgent) {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
        axiosConfig.timeout = CONFIG.TIMEOUT_CONNECT + CONFIG.TIMEOUT_READ;
    }

    try {
        const res = await axios(axiosConfig);

        if (res.status === 204 || res.status === 200) {
            return { success: true, method: 'logout', status: res.status };
        }

        // Rate limited → retry
        if (res.status === 429 && attempt < CONFIG.MAX_RETRIES) {
            const waitMs = (res.data?.retry_after || 3) * 1000 + 500;
            console.log(C.yellow(`   ⏳ Rate limited, đợi ${(waitMs / 1000).toFixed(1)}s...`));
            await sleep(waitMs);
            return killToken(token, proxyPool, attempt + 1);
        }

        // 401 = token đã chết sẵn
        if (res.status === 401) {
            return { success: true, method: 'already_dead', status: 401 };
        }

        return { success: false, method: 'logout', status: res.status, error: res.data?.message || `HTTP ${res.status}` };
    } catch (err) {
        if (attempt < CONFIG.MAX_RETRIES) {
            console.log(C.gray(`   ↻ Network error, retry kill (${attempt + 1}/${CONFIG.MAX_RETRIES})...`));
            await sleep(1000);
            return killToken(token, proxyPool, attempt + 1);
        }
        return { success: false, method: 'logout', status: 0, error: err.code || err.message };
    }
}

// ─── CONFIRM PROMPT ───────────────────────────────
function confirmPrompt(question) {
    return new Promise((resolve) => {
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
        });
    });
}

// ─── BANNER ────────────────────────────────────────
function printBanner() {
    console.log('');
    console.log(C.purple('  ╔══════════════════════════════════════════╗'));
    console.log(C.purple('  ║') + C.bold(C.white('   ⚡ Token Checker & Killer v2.0 ⚡')) + C.purple('     ║'));
    console.log(C.purple('  ║') + C.gray('        by Azure AI Team') + C.purple('                  ║'));
    console.log(C.purple('  ╚══════════════════════════════════════════╝'));
    console.log('');
}

// ─── PROGRESS BAR ──────────────────────────────────
function progressBar(current, total, width = 30) {
    const pct = current / total;
    const filled = Math.round(width * pct);
    const empty = width - filled;
    const bar = C.green('█'.repeat(filled)) + C.gray('░'.repeat(empty));
    return `${bar} ${C.white(`${current}/${total}`)} ${C.dim(`(${(pct * 100).toFixed(0)}%)`)}`;
}

// ─── PARSE ARGS ────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        tokenFile: CONFIG.DEFAULT_TOKEN_FILE,
        tokens: [],
        useProxy: false,
        killMode: null,   // null | 'kill' | 'kill-only' | 'kill-invalid'
        autoConfirm: false,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '-f':
            case '--file':
                opts.tokenFile = args[++i];
                break;
            case '-t':
            case '--tokens':
                while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                    opts.tokens.push(args[++i]);
                }
                break;
            case '--proxy':
            case '-p':
                opts.useProxy = true;
                break;
            case '--kill':
                opts.killMode = 'kill';
                break;
            case '--kill-only':
                opts.killMode = 'kill-only';
                break;
            case '--kill-invalid':
                opts.killMode = 'kill-invalid';
                break;
            case '-y':
            case '--yes':
                opts.autoConfirm = true;
                break;
            case '--no-color':
                useColor = false;
                break;
            case '-h':
            case '--help':
                printBanner();
                console.log(C.white('  Check Mode:'));
                console.log(C.gray('    node token_checker.cjs                       # Check từ tokens.txt'));
                console.log(C.gray('    node token_checker.cjs -f file.txt           # Check từ file'));
                console.log(C.gray('    node token_checker.cjs -t TOKEN1 TOKEN2      # Check trực tiếp'));
                console.log(C.gray('    node token_checker.cjs --proxy               # Dùng rotating proxy'));
                console.log('');
                console.log(C.red('  Kill Mode:'));
                console.log(C.gray('    node token_checker.cjs --kill                # Check → Kill valid tokens'));
                console.log(C.gray('    node token_checker.cjs --kill-only           # Kill thẳng, không check info'));
                console.log(C.gray('    node token_checker.cjs --kill-invalid        # Kill locked/phone, giữ valid'));
                console.log(C.gray('    node token_checker.cjs --kill -y             # Kill không hỏi xác nhận'));
                console.log('');
                console.log(C.gray('    --no-color                                   # Tắt màu'));
                process.exit(0);
        }
    }
    return opts;
}

// ─── LOAD TOKENS ───────────────────────────────────
function loadTokens(opts) {
    if (opts.tokens.length > 0) return opts.tokens;

    if (!fs.existsSync(opts.tokenFile)) {
        console.log(C.red(`✖  File không tồn tại: ${opts.tokenFile}`));
        console.log(C.gray(`   Tạo file tokens.txt với mỗi dòng 1 token, hoặc dùng: node token_checker.js -t <token>`));
        process.exit(1);
    }

    const raw = fs.readFileSync(opts.tokenFile, 'utf-8');
    const tokens = raw.split('\n')
        .map(l => l.trim().replace(/\r/g, ''))
        .filter(l => l && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith('['));

    if (tokens.length === 0) {
        console.log(C.red('✖  Không tìm thấy token nào trong file'));
        process.exit(1);
    }

    return tokens;
}

// ─── MAIN ──────────────────────────────────────────
async function main() {
    printBanner();

    const opts = parseArgs();
    const tokens = loadTokens(opts);
    const proxyPool = new ProxyPool(CONFIG.PROXY_FILE);

    if (opts.useProxy) proxyPool.enable();

    const modeLabel = opts.killMode
        ? C.red(`☠  ${opts.killMode.toUpperCase()}`)
        : C.blue('🔍 CHECK');

    console.log(C.blue(`📋 Tổng tokens: ${C.bold(C.white(String(tokens.length)))}`));
    console.log(C.gray(`   Mode: ${modeLabel} ${C.gray('|')} ${opts.useProxy ? 'Rotating Proxy' : 'Direct'}`));
    console.log(C.gray(`   Jitter: ${CONFIG.JITTER_MIN}-${CONFIG.JITTER_MAX}ms`));
    console.log(C.gray('─'.repeat(50)));
    console.log('');

    // ─── KILL-ONLY MODE ────────────────────────────
    if (opts.killMode === 'kill-only') {
        if (!opts.autoConfirm) {
            console.log(C.red(C.bold(`  ⚠  SẮP KILL ${tokens.length} TOKENS KHÔNG CHECK!`)));
            const ok = await confirmPrompt(C.yellow('  Xác nhận? (y/N): '));
            if (!ok) {
                console.log(C.gray('\n  Đã hủy.'));
                process.exit(0);
            }
        }
        console.log('');

        let killed = 0, failed = 0, alreadyDead = 0;
        const killedSuccessTokens = [];
        const startTime = Date.now();

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const idx = C.gray(`[${String(i + 1).padStart(String(tokens.length).length)}/${tokens.length}]`);
            const masked = maskToken(token);

            const result = await killToken(token, proxyPool);

            if (result.success && result.method === 'already_dead') {
                alreadyDead++;
                console.log(`  ${idx} ${C.bgYellow('DEAD')}    ${C.gray(masked)} ${C.dim('Đã chết sẵn')}`);
            } else if (result.success) {
                killed++;
                killedSuccessTokens.push(token);
                console.log(`  ${idx} ${C.bgRed('KILLED')}  ${C.gray(masked)} ${C.dim('Logout thành công')}`);
            } else {
                failed++;
                console.log(`  ${idx} ${C.bgBlue('FAIL')}    ${C.gray(masked)} ${C.dim(result.error || 'Unknown')}`);
            }

            if (tokens.length > 5 && (i + 1) % 5 === 0) {
                console.log(`  ${progressBar(i + 1, tokens.length)}`);
            }
            if (i < tokens.length - 1) await jitterDelay();
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('');
        console.log(C.gray('═'.repeat(50)));
        console.log(C.bold(C.red('  ☠  KẾT QUẢ KILL')));
        console.log(C.gray('═'.repeat(50)));
        console.log('');
        console.log(`  ${C.red('💀 Killed')}       ${C.bold(C.red(String(killed)))}`);
        console.log(`  ${C.yellow('⚰️  Already Dead')} ${C.bold(C.yellow(String(alreadyDead)))}`);
        console.log(`  ${C.gray('❌ Failed')}       ${C.bold(C.gray(String(failed)))}`);
        console.log(`  ${C.dim(`⏱  ${elapsed}s`)}`);

        // Save
        if (!fs.existsSync(CONFIG.RESULTS_DIR)) fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
        if (killedSuccessTokens.length > 0) {
            const p = path.join(CONFIG.RESULTS_DIR, 'killed_success.txt');
            fs.writeFileSync(p, killedSuccessTokens.join('\n') + '\n');
            console.log('');
            console.log(C.red(`  💾 Killed → ${p}`));
        }
        console.log('');
        process.exit(0);
    }

    // ─── CHECK MODE (also used by --kill and --kill-invalid) ──
    const stats = { VALID: 0, KILLED: 0, LOCKED: 0, PHONE_LOCKED: 0, ERROR: 0, UNKNOWN: 0 };
    const results = [];
    const validTokens = [];
    const killedTokens = [];
    const lockedTokens = [];
    const startTime = Date.now();

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const idx = C.gray(`[${String(i + 1).padStart(String(tokens.length).length)}/${tokens.length}]`);

        const result = await checkToken(token, proxyPool);
        stats[result.status] = (stats[result.status] || 0) + 1;

        // Display
        const masked = maskToken(token);
        let infoStr = '';

        if (result.status === 'VALID' && result.info) {
            const u = result.info;
            const name = u.global_name || u.username || '?';
            const tag = u.discriminator && u.discriminator !== '0' ? `#${u.discriminator}` : '';
            const flags = [];
            if (u.mfa_enabled) flags.push('🔐MFA');
            if (u.verified) flags.push('✅Email');
            if (u.phone) flags.push('📱Phone');
            if (u.premium_type > 0) flags.push('💎Nitro');
            infoStr = C.cyan(`${name}${tag}`) + ' ' + C.dim(flags.join(' '));
        } else if (result.info?.message) {
            infoStr = C.dim(result.info.message);
        }

        console.log(`  ${idx} ${result.badge} ${C.gray(masked)} ${infoStr}`);

        // Collect
        const entry = {
            token: token,
            status: result.status,
            checked_at: new Date().toISOString(),
        };
        if (result.status === 'VALID' && result.info) {
            entry.user = {
                id: result.info.id,
                username: result.info.username,
                global_name: result.info.global_name,
                email: result.info.email || null,
                phone: result.info.phone || null,
                verified: result.info.verified,
                mfa_enabled: result.info.mfa_enabled,
                premium_type: result.info.premium_type,
            };
            validTokens.push(token);
        } else if (result.status === 'LOCKED' || result.status === 'PHONE_LOCKED') {
            lockedTokens.push(token);
            killedTokens.push(token);
        } else {
            killedTokens.push(token);
        }
        results.push(entry);

        // Progress
        if (tokens.length > 5 && (i + 1) % 5 === 0) {
            console.log(`  ${progressBar(i + 1, tokens.length)}`);
        }

        // Jitter delay (trừ cái cuối)
        if (i < tokens.length - 1) await jitterDelay();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ─── SUMMARY ───────────────────────────────────
    console.log('');
    console.log(C.gray('═'.repeat(50)));
    console.log(C.bold(C.white('  📊 KẾT QUẢ KIỂM TRA')));
    console.log(C.gray('═'.repeat(50)));
    console.log('');
    console.log(`  ${C.green('✔ Valid')}      ${C.bold(C.green(String(stats.VALID)))}`);
    console.log(`  ${C.red('✖ Killed')}     ${C.bold(C.red(String(stats.KILLED)))}`);
    console.log(`  ${C.purple('🔒 Locked')}    ${C.bold(C.purple(String(stats.LOCKED)))}`);
    console.log(`  ${C.yellow('📱 Phone')}     ${C.bold(C.yellow(String(stats.PHONE_LOCKED)))}`);
    console.log(`  ${C.gray('⚠ Error')}      ${C.bold(C.gray(String(stats.ERROR)))}`);
    console.log('');
    console.log(`  ${C.dim(`⏱  Hoàn thành trong ${elapsed}s`)}`);

    // Tỉ lệ sống
    const aliveRate = tokens.length > 0 ? ((stats.VALID / tokens.length) * 100).toFixed(1) : 0;
    const rateColor = aliveRate >= 50 ? C.green : aliveRate >= 20 ? C.yellow : C.red;
    console.log(`  ${C.dim('📈 Tỉ lệ sống:')} ${rateColor(`${aliveRate}%`)}`);
    console.log('');

    // ─── KILL PHASE (after check) ──────────────────
    if (opts.killMode === 'kill' || opts.killMode === 'kill-invalid') {
        let tokensToKill = [];
        let killLabel = '';

        if (opts.killMode === 'kill') {
            tokensToKill = [...validTokens];
            killLabel = `${tokensToKill.length} VALID tokens`;
        } else if (opts.killMode === 'kill-invalid') {
            tokensToKill = [...lockedTokens];
            killLabel = `${tokensToKill.length} LOCKED/PHONE tokens`;
        }

        if (tokensToKill.length === 0) {
            console.log(C.gray('  ℹ  Không có token nào cần kill.'));
        } else {
            console.log(C.gray('═'.repeat(50)));
            console.log(C.bold(C.red(`  ☠  KILL PHASE: ${killLabel}`)));
            console.log(C.gray('═'.repeat(50)));
            console.log('');

            if (!opts.autoConfirm) {
                const ok = await confirmPrompt(C.yellow(`  ⚠  Xác nhận kill ${tokensToKill.length} tokens? (y/N): `));
                if (!ok) {
                    console.log(C.gray('\n  Đã hủy kill phase.'));
                    tokensToKill = [];
                }
            }

            if (tokensToKill.length > 0) {
                let killOk = 0, killFail = 0;
                const killedSuccessTokens = [];

                for (let i = 0; i < tokensToKill.length; i++) {
                    const token = tokensToKill[i];
                    const idx = C.gray(`[${String(i + 1).padStart(String(tokensToKill.length).length)}/${tokensToKill.length}]`);
                    const masked = maskToken(token);

                    const kr = await killToken(token, proxyPool);

                    if (kr.success) {
                        killOk++;
                        killedSuccessTokens.push(token);
                        const method = kr.method === 'already_dead' ? C.dim('đã chết') : C.dim('logout OK');
                        console.log(`  ${idx} ${C.bgRed('KILLED')}  ${C.gray(masked)} ${method}`);
                    } else {
                        killFail++;
                        console.log(`  ${idx} ${C.bgBlue('FAIL')}    ${C.gray(masked)} ${C.dim(kr.error || '?')}`);
                    }

                    if (i < tokensToKill.length - 1) await jitterDelay();
                }

                console.log('');
                console.log(`  ${C.red('💀 Killed:')} ${C.bold(String(killOk))}  ${C.gray('|')}  ${C.gray('❌ Failed:')} ${C.bold(String(killFail))}`);

                // Save killed_success
                if (killedSuccessTokens.length > 0) {
                    if (!fs.existsSync(CONFIG.RESULTS_DIR)) fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
                    const ksPath = path.join(CONFIG.RESULTS_DIR, 'killed_success.txt');
                    fs.writeFileSync(ksPath, killedSuccessTokens.join('\n') + '\n');
                    console.log(C.red(`  💾 Killed success → ${ksPath}`));
                }
            }
        }
        console.log('');
    }

    // ─── SAVE RESULTS ──────────────────────────────
    if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
        fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
    }

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Full JSON report
    const reportPath = path.join(CONFIG.RESULTS_DIR, `checked_${ts}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
        checked_at: now.toISOString(),
        total: tokens.length,
        mode: opts.killMode || 'check',
        stats,
        alive_rate: `${aliveRate}%`,
        elapsed_seconds: parseFloat(elapsed),
        results,
    }, null, 2));

    // Valid tokens
    if (validTokens.length > 0) {
        const validPath = path.join(CONFIG.RESULTS_DIR, 'valid.txt');
        fs.writeFileSync(validPath, validTokens.join('\n') + '\n');
        console.log(C.green(`  💾 Valid tokens → ${validPath}`));
    }

    // Killed tokens
    if (killedTokens.length > 0) {
        const killedPath = path.join(CONFIG.RESULTS_DIR, 'killed.txt');
        fs.writeFileSync(killedPath, killedTokens.join('\n') + '\n');
        console.log(C.red(`  💾 Killed tokens → ${killedPath}`));
    }

    console.log(C.gray(`  💾 Full report  → ${reportPath}`));
    console.log('');

    // Exit code: 0 nếu có ít nhất 1 valid, 1 nếu tất cả chết
    process.exit(stats.VALID > 0 ? 0 : 1);
}

main().catch(err => {
    console.error(C.red(`\n✖  Fatal error: ${err.message}`));
    process.exit(1);
});

