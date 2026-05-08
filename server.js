const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
require('dotenv').config();
const querystring = require('querystring');
const { Server } = require('socket.io');
const cors = require('cors');
const ModemService = require('./modem-service');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

function sanitizeIp(val) {
    if (!val) return '';
    // If it's a URL, extract just the hostname/IP
    if (val.startsWith('http')) {
        try {
            const url = new URL(val);
            return url.hostname;
        } catch (e) {
            return val.replace(/^https?:\/\//, '').split('/')[0];
        }
    }
    return val.trim().replace(/[^\d.COMcom:]/g, "");
}

// --- GLOBAL ERROR HANDLERS ---
process.on('uncaughtException', (err) => {
    console.error('💥 [CRITICAL] Uncaught Exception:', err.message);
    if (err.stack) console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- TELEGRAM SETTINGS ---
function sendTelegram(msg, targetId = null, buttons = null, replyKeyboard = null) {
    const token = settings.tgToken;
    const chatId = targetId || settings.tgChatId;
    if (!token || !chatId || chatId === 'WEB_PORTAL') {
        if (chatId !== 'WEB_PORTAL') console.log('🚫 TG Send Skip: Token or ChatID missing.');
        else console.log('🌐 Web Portal Action: ' + msg.replace(/<[^>]*>/g, ''));
        return;
    }
    
    const payload = {
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML'
    };

    if (buttons && buttons.length > 0) {
        payload.reply_markup = {
            inline_keyboard: buttons.map(row => row.map(btn => ({
                text: btn.text,
                callback_data: btn.data
            })))
        };
    } else if (replyKeyboard) {
        payload.reply_markup = replyKeyboard;
    }

    const data = JSON.stringify(payload);
    const options = {
        hostname: 'api.telegram.org', port: 443, method: 'POST',
        path: `/bot${token}/sendMessage`,
        timeout: 15000,
        headers: { 
            'Content-Type': 'application/json', 
            'Content-Length': Buffer.byteLength(data),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
    };
    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) console.log(`❌ TG Send Error: Status ${res.statusCode}`);
        res.on('data', () => {}); 
    });
    req.on('error', (e) => console.error('‼️ TG Network Error:', e.message));
    req.write(data);
    req.end();
}

function sendTelegramFile(filePath, chatId = null, type = 'document') {
    const token = settings.tgToken;
    const targetId = chatId || settings.tgChatId;
    if (!token || !targetId || targetId === 'WEB_PORTAL') return;

    const method = type === 'photo' ? 'sendPhoto' : 'sendDocument';
    const boundary = '----WebKitFormBoundary' + crypto.randomBytes(10).toString('hex');
    const fileName = path.basename(filePath);
    
    try {
        const fileData = fs.readFileSync(filePath);
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="${type}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const footer = `\r\n--${boundary}--\r\n`;
        const payload = Buffer.concat([
            Buffer.from(header),
            fileData,
            Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${targetId}`),
            Buffer.from(footer)
        ]);

        const options = {
            hostname: 'api.telegram.org', port: 443, method: 'POST',
            path: `/bot${token}/${method}`,
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': payload.length
            }
        };

        const req = https.request(options, (res) => {
            res.on('data', () => {});
        });
        req.on('error', (e) => console.error('‼️ TG File Error:', e.message));
        req.write(payload);
        req.end();
    } catch (e) { console.error('File Read Error:', e.message); }
}

let lastUpdateId = 0;
let tgPollingTimeout = null;

function pollTelegram() {
    if (tgPollingTimeout) clearTimeout(tgPollingTimeout);
    
    const token = settings.tgToken;
    if (!token || token.length < 10) {
        tgPollingTimeout = setTimeout(pollTelegram, 5000);
        return;
    }
    
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
    const options = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 25000
    };

    const req = https.get(url, options, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.ok && data.result) {
                    for (let update of data.result) {
                        lastUpdateId = update.update_id;
                        try {
                            if (update.message) handleTgMessage(update.message);
                            if (update.callback_query) handleTgCallback(update.callback_query);
                        } catch (err) { console.error('❌ [TG] Handler Error:', err.message); }
                    }
                }
            } catch (e) { /* Parse error */ }
            tgPollingTimeout = setTimeout(pollTelegram, 1000);
        });
    });
    
    if (lastUpdateId % 20 === 0 && lastUpdateId !== 0) console.log('💓 [TG] Connection stable...');
    
    req.on('timeout', () => { req.destroy(); tgPollingTimeout = setTimeout(pollTelegram, 1000); });
    req.on('error', (e) => {
        // Only log errors that are not timeouts to avoid spam
        if (!e.message.includes('timeout') && !e.message.includes('ECONNREFUSED') && !e.message.includes('ECONNRESET')) {
            console.error('‼️ [TG] Connection Error:', e.message);
        }
        tgPollingTimeout = setTimeout(pollTelegram, 5000);
    });
}

function handleTgCallback(query) {
    const chatId = query.message.chat.id.toString();
    const data = query.data; 
    const adminId = (settings.tgChatId || "").toString().trim();
    if (chatId !== adminId) return;

    // Answer callback to remove loading state in TG
    const token = settings.tgToken;
    https.get(`https://api.telegram.org/bot${token}/answerCallbackQuery?callback_query_id=${query.id}`, () => {});

    if (tgSessions[chatId]) {
        handleTgMessage({ chat: { id: chatId }, text: data });
    } else if (data.startsWith('buy_')) {
        handleBuyCard(chatId, data.replace('buy_', ''));
    } else if (data.startsWith('idoom_')) {
        const parts = data.split('_');
        handleIdoomRecharge(chatId, parts[1], parts[2]);
    } else if (data.startsWith('oor_')) {
        const parts = data.split('_');
        const phone = parts[1];
        const optionId = parts[2];
        const offer = OOREDOO_OFFERS.find(o => o.optionId === optionId);
        
        let modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'ooredoo' && m.data.online);
        if (!modem) modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'sama' && m.data.online);
        
        if (modem) {
            const pin = modem.config.pin || '00000';
            const ussd = `*585*${phone}*${optionId}*${pin}#`;
            sendTelegram(`⏳ جاري إرسال العرض ${offer ? offer.name : optionId} إلى ${phone}...`, chatId);
            
            modem.executeUssdSequence([ussd, '1']).then(res => {
                sendTelegram(`✅ تم تنفيذ العرض بنجاح!\nالرد: ${res || 'تم'}`, chatId);
            });
        } else {
            sendTelegram('❌ لا يوجد مودم Ooredoo أو Sama متصل!', chatId);
        }
    }
}

const tgSessions = {}; // Track active USSD sessions

async function handleTgMessage(msg) {
    try {
        if (!msg || !msg.text) return;
        const text = msg.text.trim();
        const chatId = msg.chat.id.toString().trim();
        const adminId = (settings.tgChatId || "").toString().trim();
        
        console.log(`📩 [TG] Message from ${chatId}: ${text}`);

        // 0. Active Captcha Session Handling
        if (tgSessions[chatId] && (tgSessions[chatId].type === 'idoom_captcha' || tgSessions[chatId].type === 'idoom_captcha_2')) {
            const sess = tgSessions[chatId];
            try {
                sendTelegram("⚙️ <b>Soumission...</b>", chatId);
                await sess.page.type('input[name="userCode"]', text); 
                if (sess.type === 'idoom_captcha') {
                    const btn = await sess.page.$('input[value="CONFIRMER"]');
                    if (btn) await btn.click(); else await sess.page.click('button[type="submit"]'); 
                    await new Promise(r => setTimeout(r, 4500));
                    if ((await sess.page.content()).includes('RECHARGER')) {
                        await completeIdoomStep2(chatId, sess.page, sess.browser, sess.card, sess.cardIndex, sess.phone);
                    } else {
                        sendTelegram("❌ Captcha Incorrect.", chatId);
                        await sess.browser.close();
                    }
                } else {
                    const btn = await sess.page.$('input[value="RECHARGER"]');
                    if (btn) await btn.click(); else await sess.page.click('input[type="submit"]'); 
                    await new Promise(r => setTimeout(r, 5000));
                    sendTelegram("🏁 Opération terminée.", chatId);
                    await sess.browser.close();
                }
            } catch (e) {
                sendTelegram(`❌ Erreur: ${e.message}`, chatId);
                if (sess.browser) await sess.browser.close();
            }
            delete tgSessions[chatId];
            return;
        }

        // 1. Authorization Check
        if (!adminId || chatId !== adminId) {
            const replyData = JSON.parse(fs.readFileSync(AUTO_REPLY_FILE, 'utf8') || '{}');
            sendTelegram(replyData.message || "👋 Bienvenue!", chatId);
            if (adminId) sendTelegram(`👤 Visiteur: <code>${chatId}</code>`, adminId);
            return;
        }

        // 2. Idoom 9-digit Detection
        const idoomMatch = text.match(/^(0\d{8}|02\d{8})$/);
        if (idoomMatch) {
            console.log(`🎯 [IDOOM] Detected Idoom number: ${idoomMatch[1]}`);
            delete tgSessions[chatId];
            sendIdoomMenu(chatId, idoomMatch[1]);
            return;
        }

        // 3. USSD Menu Reply (Numeric)
        if (/^\d+$/.test(text) && tgSessions[chatId]) {
            const sess = tgSessions[chatId];
            const mKey = typeof sess === 'string' ? sess : sess.modemKey;
            const modem = activeModems[mKey];
            if (modem && modem.serial?.isOpen) {
                modem.serial.write(`AT+CUSD=1,"${text}"\r\n`);
                return;
            }
        }

        // 4. USSD Direct Start (*...#)
        if (text.startsWith('*') && text.endsWith('#')) {
            let op = text.includes('610') ? 'Mobilis' : (text.includes('710') ? 'Djezzy' : 'Ooredoo');
            const modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === op.toLowerCase() && m.data.online);
            if (modem) {
                tgSessions[chatId] = { modemKey: modem.key };
                modem.notifyChatId = chatId;
                modem.ussdInProgress = true;
                modem.checkBalance(text);
                return;
            }
        }

        // 5. Offer Inquiry (10 digits)
        const inqMatch = text.match(/^(\d{10})$/);
        if (inqMatch) {
            const phone = inqMatch[1];
            let op = phone.startsWith('05') ? 'Ooredoo' : (phone.startsWith('06') ? 'Mobilis' : 'Djezzy');
            let iOp = op; // Correct mapping: use the actual operator modem
            let modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === iOp.toLowerCase() && m.data.online);
            // Fallback to 'Sama' if no specific operator modem is online (for dealer setups)
            if (!modem) modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'sama' && m.data.online);
            if (modem) {
                const pin = modem.config.pin || '00000';
                
                if (op === 'Ooredoo' && OOREDOO_OFFERS.length > 0) {
                    let buttons = [];
                    for(let i=0; i<OOREDOO_OFFERS.length; i+=2) {
                        let row = [{ text: OOREDOO_OFFERS[i].name, data: `oor_${phone}_${OOREDOO_OFFERS[i].optionId}` }];
                        if (OOREDOO_OFFERS[i+1]) row.push({ text: OOREDOO_OFFERS[i+1].name, data: `oor_${phone}_${OOREDOO_OFFERS[i+1].optionId}` });
                        buttons.push(row);
                    }
                    sendTelegram(`اختر العرض المناسب للرقم ${phone}:`, chatId, buttons);
                    return;
                }

                let ussd = (op === 'Mobilis') ? `*610*${phone}#` : (op === 'Ooredoo' ? `*585*${phone}*${pin}#` : `*710*${phone}#`);
                tgSessions[chatId] = { modemKey: modem.key, targetPhone: phone, targetOp: op };
                modem.notifyChatId = chatId;
                modem.ussdInProgress = true;
                modem.checkBalance(ussd);
                return;
            }
        }

        // 6. Flexy Transfer (10 digits * amount)
        const flxMatch = text.match(/^(\d{10})[* ](\d+)$/);
        if (flxMatch) {
            const phone = flxMatch[1], amount = flxMatch[2];
            let op = phone.startsWith('05') ? 'Ooredoo' : (phone.startsWith('06') ? 'Mobilis' : 'Djezzy');
            const modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === op.toLowerCase() && m.data.online);
            if (modem) {
                const pin = modem.config.pin || '00000';
                let ussd = (op === 'Mobilis') ? `*630*${phone}*04*${amount}*${pin}#` : (op === 'Ooredoo' ? `*580*${phone}*${amount}*${pin}#` : `*710*${phone}*${amount}*${pin}#`);
                sendTelegram(`⏳ Transfert de ${amount} DA vers ${phone}...`);
                modem.ussdInProgress = true; modem.pendingAction = 'Transfer';
                modem.pendingAmount = parseFloat(amount); modem.lastTargetPhone = phone;
                modem.checkBalance(ussd);
                return;
            }
        }

        // 7. System Commands
        const low = text.toLowerCase();
        
        const menu = {
            keyboard: [
                [{"text": "💰 معرفة الرصيد"}, {"text": "📊 حالة السيرفر"}],
                [{"text": "💳 البطاقات المتوفرة"}, {"text": "🆔 معرفي (ID)"}]
            ],
            resize_keyboard: true,
            is_persistent: true
        };

        if (low.includes('balance') || text.includes('رصيد') || text === '💰 معرفة الرصيد') {
            const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8') || '[]');
            const c = clients.find(cl => cl.id.toString() === chatId);
            if (c) sendTelegram(`💰 Solde: <code>${c.balance.toFixed(2)} DA</code>`, chatId);
            else sendTelegram(`❌ Compte non activé. ID: <code>${chatId}</code>`, chatId);
        } else if (text.includes('/status') || text === '📊 حالة السيرفر') {
            let s = "📊 Status:\n";
            for (let k in activeModems) s += `• ${k}: ${activeModems[k].data.online ? '✅' : '❌'} - ${activeModems[k].data.balance} DA\n`;
            sendTelegram(s, chatId);
        } else if (text.includes('/start')) {
            sendTelegram("👋 Flexy Server Bot prêt.", chatId, null, menu);
        } else if (text.includes('/cards') || text === '💳 البطاقات المتوفرة') {
            sendCardsMenu(chatId);
        } else if (text === '🆔 معرفي (ID)') {
            sendTelegram(`🆔 معرفك (ID) هو:\n<code>${chatId}</code>`, chatId);
        } else {
            sendTelegram("👋 أنت في القائمة الرئيسية. الرجاء اختيار إجراء من القائمة بالأسفل:", chatId, null, menu);
        }

    } catch (err) {
        console.error('❌ handleTgMessage Error:', err);
    }
}

function sendCardsMenu(chatId) {
    // ...
}

function sendIdoomMenu(chatId, phone) {
    try {
        const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8') || '[]');
        const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8') || '[]');
        
        const idoomProducts = products.filter(p => p.name.toLowerCase().includes('idoom'));
        console.log(`🔎 [IDOOM] Found ${idoomProducts.length} Idoom products in DB.`);
        
        let msg = `📞 <b>Idoom Algerie Telecom</b>\nNuméro : <code>${phone}</code>\n\nChoisissez une carte de recharge :`;
        const buttons = [];
        
        idoomProducts.forEach(p => {
            const stock = cards.filter(c => c.productId === p.id && !c.used).length;
            console.log(`📦 [IDOOM] Product ${p.name}: ${stock} in stock.`);
            if (stock > 0) {
                buttons.push([{ text: `${p.name} (${stock})`, data: `idoom_${p.id}_${phone}` }]);
            }
        });

        if (buttons.length === 0) {
            sendTelegram(`❌ Aucune carte Idoom disponible en stock.\n\nNuméro : <code>${phone}</code>`, chatId);
        } else {
            sendTelegram(msg, chatId, buttons);
        }
    } catch (e) { console.error('Idoom Menu Error:', e); }
}

async function handleIdoomRechargeNoCaptcha(chatId, card, cardIndex, phone) {
    try {
        let sessionCookies = '';

        const makeRequest = (path, postData = null, extraHeaders = {}) => {
            return new Promise((resolve, reject) => {
                const options = {
                    hostname: 'paiement.algerietelecom.dz',
                    path: path,
                    method: postData ? 'POST' : 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
                        'X-Requested-With': 'dz.algerietelecom.rd.e_paiement',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Referer': 'https://paiement.algerietelecom.dz/',
                        ...extraHeaders
                    }
                };

                if (sessionCookies) options.headers['Cookie'] = sessionCookies;

                if (postData) {
                    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    options.headers['Content-Length'] = Buffer.byteLength(postData);
                }

                const req = https.request(options, (res) => {
                    let data = '';
                    if (res.headers['set-cookie']) {
                        const newCookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
                        sessionCookies = sessionCookies ? `${sessionCookies}; ${newCookies}` : newCookies;
                    }
                    res.on('data', d => data += d);
                    res.on('end', () => resolve({ data, statusCode: res.statusCode, headers: res.headers }));
                });
                req.on('error', reject);
                if (postData) req.write(postData);
                req.end();
            });
        };

        console.log(`📡 [IDOOM][API] تهيئة الجلسة (Session Initialization)...`);
        await makeRequest('/index.php?p=portail');
        await makeRequest('/index.php?p=voucher_internet&produit=in');

        console.log(`🚀 [IDOOM][API] المرحلة 1: التحقق من الرقم ${phone}...`);
        const step1Data = querystring.stringify({
            'nd': phone,
            'validerADSL': 'Confirmer',
            'source': 'app'
        });

        const res1 = await makeRequest('/index.php?p=voucher_internet&produit=in', step1Data);
        
        if (!res1.data.includes('name="voucher"') && !res1.data.includes('id="voucher"')) {
            if (res1.data.includes('userCode') || res1.data.includes('captcha')) {
                console.log(`❌ [IDOOM][API] فشل المرحلة 1: الموقع لا يزال يطلب الكابتشا.`);
            } else {
                console.log(`❌ [IDOOM][API] فشل المرحلة 1: لم يتم العثور على حقل الكود.`);
            }
            return false;
        }

        console.log(`🚀 [IDOOM][API] المرحلة 2: إرسال الكود ${card.pin}...`);
        const step2Data = querystring.stringify({
            'voucher': card.pin,
            'recharge': 'Recharger',
            'source': 'app',
            'produit': 'in'
        });

        const res2 = await makeRequest('/index.php?p=voucher_internet', step2Data, {
            'Origin': 'https://paiement.algerietelecom.dz',
            'User-Agent': 'Algérie Télécom/1.0 (dz.algerietelecom.rd.e_paiement; build:1; Android 11; API 30)'
        });
        const resultHtml = res2.data.toLowerCase();

        if (resultHtml.includes('succès') || resultHtml.includes('rechargé') || 
            resultHtml.includes('réussie') || resultHtml.includes('félicitation') ||
            resultHtml.includes('validée') || resultHtml.includes('effectuée')) {
            await finalizeIdoomSuccess(chatId, card, cardIndex, phone);
            return true;
        } else {
            fs.writeFileSync('data/idoom_api_fail.html', res2.data);
            if (resultHtml.includes('sécurité incorrect') || resultHtml.includes('usercode')) {
                console.log(`❌ [IDOOM][API] فشل المرحلة 2: الموقع لا يزال يطلب الكابتشا.`);
            } else if (resultHtml.includes('recharge incorrect') || resultHtml.includes('vcode incorrect')) {
                console.log(`❌ [IDOOM][API] فشل المرحلة 2: كود البطاقة غير صحيح.`);
            } else {
                console.log(`❌ [IDOOM][API] فشل المرحلة 2: خطأ غير معروف (راجع idoom_api_fail.html).`);
            }
            return false;
        }

    } catch (e) {
        console.error(`⚠️ [IDOOM][API] Error:`, e.message);
        return false;
    }
}

async function solveCaptchaAnyCaptcha(imagePath) {
    const key = process.env.ANYCAPTCHA_KEY;
    if (!key) return null;

    const domains = ['azcaptcha.com', 'anycaptcha.com', 'api.anycaptcha.com'];
    const imageBase64 = fs.readFileSync(imagePath, { encoding: 'base64' });
    
    for (const domain of domains) {
        try {
            console.log(`📡 [AI] Attempting captcha solve via ${domain}...`);
            const createTaskBody = JSON.stringify({
                clientKey: key,
                task: { type: "ImageToTextTask", body: imageBase64 }
            });

            const createTaskRes = await new Promise((resolve, reject) => {
                const req = https.request(`https://${domain}/createTask`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                }, (res) => {
                    let data = '';
                    res.on('data', d => data += d);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
                req.write(createTaskBody);
                req.end();
            });

            if (createTaskRes.errorId !== 0) {
                console.error(`❌ [AI] ${domain} Error:`, createTaskRes.errorDescription);
                continue; // Try next domain
            }

            const taskId = createTaskRes.taskId;
            console.log(`📡 [AI] Task Created on ${domain}: ${taskId}`);

            // Poll for result
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 2000));
                const getResultRes = await new Promise((resolve, reject) => {
                    const req = https.request(`https://${domain}/getTaskResult`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    }, (res) => {
                        let data = '';
                        res.on('data', d => data += d);
                        res.on('end', () => {
                            try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
                        });
                    });
                    req.on('error', reject);
                    req.write(JSON.stringify({ clientKey: key, taskId }));
                    req.end();
                });

                if (getResultRes.status === 'ready') {
                    console.log(`✅ [AI] Solved via ${domain}: ${getResultRes.solution.text}`);
                    return getResultRes.solution.text;
                }
                if (getResultRes.errorId !== 0) break;
            }
        } catch (e) {
            console.error(`⚠️ [AI] Domain ${domain} failed:`, e.message);
        }
    }
    return null;
}

async function handleIdoomRecharge(chatId, productId, phone) {
    let browser;
    try {
        const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8') || '[]');
        const cardIndex = cards.findIndex(c => c.productId === productId && !c.used);
        
        if (cardIndex === -1) return sendTelegram("❌ <b>Rupture de stock :</b> Aucune carte Idoom disponible pour ce montant.", chatId);
        
        const card = cards[cardIndex];
        sendTelegram(`⏳ <b>Démarrage de l'automatisation (Mode Rapide)...</b>\nNuméro : <code>${phone}</code>\nTentative de recharge sans captcha...`, chatId);
        
        // --- NEW NO-CAPTCHA FLOW ---
        const apiSuccess = await handleIdoomRechargeNoCaptcha(chatId, card, cardIndex, phone);
        if (apiSuccess) {
            console.log(`✅ [IDOOM][API] Success for ${phone}`);
            return;
        }

        console.log(`⚠️ [IDOOM][API] No-Captcha method failed. Falling back to Puppeteer...`);
        sendTelegram(`⚠️ <b>Mode Rapide échoué.</b> Passage au mode simulateur (avec Captcha)...`, chatId);

        // Automation Engine (Puppeteer Fallback)
        try {
            const puppeteer = require('puppeteer-extra');
            const StealthPlugin = require('puppeteer-extra-plugin-stealth');
            puppeteer.use(StealthPlugin());

            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
            const page = await browser.newPage();
            
            console.log(`🚀 [IDOOM] Navigating for ${phone}...`);
            await page.goto('https://paiement.at.dz/index.php?p=voucher_internet&produit=in', { waitUntil: 'networkidle2' });

            // Fill Form initially
            await page.waitForSelector('#nd', { timeout: 10000 });
            await page.type('#nd', phone);
            
            let solved = false;
            for (let attempt = 1; attempt <= 10; attempt++) {
                console.log(`🤖 [IDOOM] Step 1 Attempt ${attempt}...`);
                
                // Ensure phone is still there (site clears it on error)
                await page.evaluate((ph) => {
                    const nd = document.querySelector('#nd');
                    if (nd && !nd.value) nd.value = ph;
                }, phone);

                // Advanced Image Processing via CSS
                await page.evaluate((att) => {
                    const img = document.querySelector('#captcha') || document.querySelector('a.lien-recherger img');
                    if (img) {
                        img.style.width = '350px'; 
                        img.style.height = 'auto';
                        img.style.filter = 'contrast(300%) grayscale(100%)';
                        img.style.backgroundColor = 'white';
                    }
                }, attempt);
                
                await new Promise(r => setTimeout(r, 1000));
                const captchaImg = await page.$('#captcha') || await page.$('a.lien-recherger img');
                if (captchaImg) await captchaImg.screenshot({ path: `data/idoom_captcha_s1_${attempt}.png` });
                
                let captchaText = await solveCaptchaAnyCaptcha(`data/idoom_captcha_s1_${attempt}.png`);
                
                if (captchaText && captchaText.length >= 3) {
                    console.log(`🤖 [IDOOM] AI Guess: ${captchaText}`);
                    
                    // Clear and type captcha specifically in userCode field
                    await page.click('input[name="userCode"]', { clickCount: 3 }).catch(() => {});
                    await page.keyboard.press('Backspace');
                    await page.type('input[name="userCode"]', captchaText); 
                    
                    // Submit Step 1 using specific Name if available
                    const submitted = await page.evaluate((ph) => {
                        const nd = document.querySelector('#nd');
                        if (nd) { 
                            nd.value = ph; 
                            const event = new Event('input', { bubbles: true });
                            nd.dispatchEvent(event);
                        }
                        const btn = document.querySelector('input[name="validerADSL"]') || document.querySelector('input.btn-green');
                        if (btn) { 
                            btn.scrollIntoView();
                            btn.click(); 
                            return true; 
                        }
                        return false;
                    }, phone);
                    if (!submitted) {
                        console.log('⚠️ [IDOOM] Button not found via JS, trying puppeteer click...');
                        await page.click('input.btn-green').catch(async () => { await page.keyboard.press('Enter'); });
                    }
                    
                    await new Promise(r => setTimeout(r, 6000));
                    await page.screenshot({ path: `data/debug_step1_attempt_${attempt}.png` }); 
                    await page.screenshot({ path: `data/idoom_live.png` }); // Public live view
                    
                    // Wait for navigation and strictly check for Step 2 elements
                    await new Promise(r => setTimeout(r, 3000));
                    const url = page.url();
                    const isStep2 = await page.evaluate(() => {
                        return window.location.href.includes('suite') || (!!document.querySelector('#voucher') && document.querySelector('#voucher').offsetParent !== null);
                    });
                    
                    if (isStep2) {
                        solved = true;
                        console.log(`✅ [IDOOM] Step 1 Success (URL: ${url})! Moving to Step 2...`);
                        await completeIdoomStep2(chatId, page, browser, card, cardIndex, phone);
                        break;
                    } else {
                        const content = await page.content();
                        const errMsg = await page.evaluate(() => {
                            const errs = Array.from(document.querySelectorAll('.alert, .error, .titre-rouge, b, font[color="red"]'));
                            return errs.map(e => e.innerText).join(' | ').substring(0, 200);
                        });
                        console.log(`❌ [AI] Step 1 did not proceed (URL: ${url}). Page Error: ${errMsg}`);
                        if (content.includes('incorrect') || true) {
                            console.log(`🔄 [AI] Refreshing captcha for attempt ${attempt + 1}...`);
                            try {
                                const refresh = await page.$('a[href*="refresh"]');
                                if (refresh) {
                                    await refresh.click();
                                    await new Promise(r => setTimeout(r, 2000));
                                } else {
                                    await page.goto('https://paiement.at.dz/index.php?p=voucher_internet&produit=in', { waitUntil: 'networkidle2' });
                                }
                                // Re-fill phone always to be safe
                                await page.click('#nd', { clickCount: 3 });
                                await page.keyboard.press('Backspace');
                                await page.type('#nd', phone);
                            } catch(e) { console.error('Refresh Error:', e.message); }
                        }
                    }
                }
            }

            if (!solved) {
                sendTelegram(`🧩 <b>AI a échoué.</b> Veuillez entrer le code :`, chatId);
                const cImg = await page.$('#captcha');
                if (cImg) await cImg.screenshot({ path: 'data/manual_captcha.png' });
                sendTelegramFile('data/manual_captcha.png', chatId, 'photo');
                tgSessions[chatId] = { type: 'idoom_captcha', browser, page, cardIndex, phone, card };
            }

        } catch (e) {
            console.error('Puppeteer Error:', e.message);
            sendTelegram(`⚠️ <b>Mode Manuel :</b> ${e.message}`, chatId);
        } finally {
            // browser.close is handled inside completeIdoomStep2 or here if it fails before
        }
    } catch (e) { console.error('Idoom Recharge Error:', e); }
}

async function completeIdoomStep2(chatId, page, browser, card, cardIndex, phone) {
    try {
        console.log(`🤖 [IDOOM] Step 2: Entering Recharge Card for ${phone}...`);
        
        try {
            await page.waitForSelector('#voucher', { timeout: 15000 });
        } catch (e) {
            console.log("⚠️ [IDOOM] Step 2 Selector (#voucher) not found. Checking content...");
            const content = await page.content();
            if (!content.includes('voucher') && !content.includes('vcode')) {
                sendTelegram(`❌ <b>Échec Step 2 :</b> Formulaire non trouvé.`, chatId);
                if (browser) await browser.close();
                return;
            }
        }
        
        // Type Card PIN
        await page.click('#voucher', { clickCount: 3 }).catch(() => {});
        await page.keyboard.press('Backspace');
        await page.type('#voucher', card.pin);
        console.log(`🔑 [IDOOM] PIN entered: ${card.pin}`);
        
        const hasCaptcha = await page.evaluate(() => !!document.querySelector('#captcha') || !!document.querySelector('a.lien-recherger img'));
        
        if (hasCaptcha) {
            let solved = false;
            for (let attempt = 1; attempt <= 10; attempt++) {
                console.log(`🤖 [IDOOM] Step 2 Captcha Attempt ${attempt}...`);
                
                // Aggressively re-fill PIN every attempt
                await page.click('#voucher', { clickCount: 3 }).catch(() => {});
                await page.keyboard.press('Backspace');
                await page.type('#voucher', card.pin);
                console.log(`🔑 [IDOOM] PIN re-verified/typed: ${card.pin}`);

                await page.evaluate(() => {
                    const img = document.querySelector('#captcha') || document.querySelector('a.lien-recherger img');
                    if (img) { img.style.width = '350px'; img.style.filter = 'contrast(300%) grayscale(100%)'; }
                });
                
                await new Promise(r => setTimeout(r, 1000));
                const captchaImg = await page.$('#captcha') || await page.$('a.lien-recherger img');
                if (captchaImg) {
                    await captchaImg.screenshot({ path: `data/idoom_captcha_s2_${attempt}.png` });
                    await captchaImg.screenshot({ path: `data/idoom_live.png` }); // Zoom in on captcha for UI
                }
                
                let captchaText = await solveCaptchaAnyCaptcha(`data/idoom_captcha_s2_${attempt}.png`);
                
                if (captchaText && captchaText.length >= 3) {
                    console.log(`🤖 [IDOOM] Step 2 AI Guess: ${captchaText}`);
                    
                    await page.evaluate((txt) => {
                        const target = document.querySelector('input[name="userCode"]');
                        if (target) { target.value = txt; return true; }
                        return false;
                    }, captchaText);
                    
                    await page.click('input[name="userCode"]').catch(() => {});
                    await page.type('input[name="userCode"]', captchaText).catch(() => {});

                    const currentPin = await page.evaluate(() => document.querySelector('#voucher')?.value);
                    console.log(`🔍 [IDOOM] PIN value before click: ${currentPin}`);

                    const rechargeBtn = 'input[name="recharge"]';
                    const btnFound = await page.$(rechargeBtn);
                    if (btnFound) {
                        await btnFound.click();
                    } else {
                        await page.evaluate(() => {
                            const btn = document.querySelector('input[name="recharge"]') || document.querySelector('input.btn-green');
                            if (btn) { btn.scrollIntoView(); btn.click(); }
                        });
                    }

                    console.log("⏳ [IDOOM] Waiting 15s for processing...");
                    await new Promise(r => setTimeout(r, 15000));
                    const contentAfter = await page.content();
                    
                    if (contentAfter.toLowerCase().includes('succès') || contentAfter.toLowerCase().includes('rechargé') || 
                        contentAfter.toLowerCase().includes('réussie') || contentAfter.toLowerCase().includes('félicitation') ||
                        contentAfter.toLowerCase().includes('validée') || contentAfter.toLowerCase().includes('effectuée')) {
                        solved = true;
                        await finalizeIdoomSuccess(chatId, card, cardIndex, phone);
                        break;
                    } else if (contentAfter.toLowerCase().includes('sécurité incorrect') || contentAfter.toLowerCase().includes('usercode')) {
                        console.log(`❌ [AI] Step 2 Incorrect Captcha, refreshing...`);
                        const refresh = await page.$('a.lien-recherger') || await page.$('a[href*="refresh"]');
                        if (refresh) {
                            await refresh.click();
                            await new Promise(r => setTimeout(r, 4000));
                        } else {
                            await page.reload({ waitUntil: 'networkidle2' });
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    } else if (contentAfter.toLowerCase().includes('recharge incorrect') || contentAfter.toLowerCase().includes('vcode incorrect')) {
                        console.log(`❌ [AI] Step 2 Incorrect PIN (${card.pin}). Stopping.`);
                        sendTelegram(`❌ <b>Code de recharge incorrect :</b> <code>${card.pin}</code>`, chatId);
                        solved = true; // Stop loop
                        break;
                    } else {
                        console.log(`❌ [AI] Step 2 Unknown Error. Content length: ${contentAfter.length}`);
                    }
                }
            }
            if (!solved) sendTelegram(`🧩 <b>AI Step 2 a échoué.</b> Veuillez finir manuellement.`, chatId);
        } else {
            console.log("🚀 [IDOOM] No captcha detected in Step 2. Submitting...");
            await page.click('input.btn-green').catch(async () => { await page.keyboard.press('Enter'); });
            await new Promise(r => setTimeout(r, 8000));
            const content = await page.content();
            if (content.includes('succès') || content.includes('rechargé') || content.includes('réussie') || content.includes('félicitation')) {
                await finalizeIdoomSuccess(chatId, card, cardIndex, phone);
            } else {
                console.log("❌ [IDOOM] Step 2 Submission failed without captcha.");
                await page.screenshot({ path: 'data/debug_step2_failed.png' });
            }
        }
    } catch (e) {
        console.error('Step 2 Error:', e.message);
        sendTelegram(`❌ <b>Erreur Step 2 :</b> ${e.message}`, chatId);
    } finally {
        if (browser) await browser.close();
    }
}

async function finalizeIdoomSuccess(chatId, card, cardIndex, phone) {
    try {
        const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
        cards[cardIndex].used = true;
        cards[cardIndex].usedBy = chatId;
        cards[cardIndex].usedAt = new Date().toISOString();
        fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
        
        const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
        const product = products.find(p => p.id === card.productId);
        const client = clients.find(c => c.id.toString() === chatId.toString());
        
        const now = new Date();
        const dateStr = now.toLocaleDateString('fr-FR');
        const timeStr = now.toLocaleTimeString('fr-FR');
        
        // Detailed Info Extraction
        const productName = product ? product.name : 'Idoom Recharge';
        const internetType = productName.toLowerCase().includes('fiber') ? 'Idoom Fibre' : 'Idoom ADSL/VDSL';
        
        if (client && product) {
            client.balance -= product.price;
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
            
            const msg = `✅ <b>Recharge Idoom Réussie !</b>\n\n` +
                        `📞 Numéro : <code>${phone}</code>\n` +
                        `🌐 Type : <b>${internetType}</b>\n` +
                        `📦 Offre : <b>${productName}</b>\n` +
                        `📅 Date : <code>${dateStr}</code>\n` +
                        `⏰ Heure : <code>${timeStr}</code>\n` +
                        `💰 Nouveau solde : <b>${client.balance.toFixed(2)} DA</b>\n\n` +
                        `تمت عملية الشحن بنجاح وتحديث الرصيد.`;
            
            sendTelegram(msg, chatId);
        }
        addLog('Idoom', chatId, 'Success', `${phone} - ${productName}`);
    } catch (e) { console.error('Finalize Success Error:', e); }
}

function handleBuyCard(chatId, productId) {
    try {
        const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
        const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));

        const product = products.find(p => p.id === productId);
        const client = clients.find(c => c.id.toString() === chatId.toString());

        if (!product) return sendTelegram("❌ Produit invalide.", chatId);
        if (!client) return sendTelegram("❌ Client non trouvé. Veuillez contacter l'administrateur.", chatId);
        
        if (client.balance < product.price) {
            return sendTelegram(`❌ Solde insuffisant.\nPrix : ${product.price} DA\nVotre solde : ${client.balance} DA`, chatId);
        }

        const cardIndex = cards.findIndex(c => c.productId === productId && !c.used);
        if (cardIndex === -1) {
            return sendTelegram("❌ Désolé, ce produit est en rupture de stock.", chatId);
        }

        const card = cards[cardIndex];
        
        // Idoom PIN Validation (must be 16 digits)
        if (productId.startsWith('idm') && (!/^\d{16}$/.test(card.pin))) {
            console.log(`⚠️ [IDOOM] Invalid PIN found: ${card.pin}. Skipping...`);
            return sendTelegram(`⚠️ <b>Erreur :</b> Le code de recharge en stock (${card.pin}) est invalide (doit être 16 chiffres).`, chatId);
        }

        // Transaction
        card.used = true;
        card.usedBy = chatId;
        card.usedAt = new Date().toISOString();
        
        client.balance -= product.price;

        fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

        const cardText = card.pin + (card.serial ? `\nS/N: <code>${card.serial}</code>` : '');
        sendTelegram(`✅ <b>Achat réussi !</b>\n\nProduit : ${product.name}\nPrix : ${product.price} DA\nCode : <code>${card.pin}</code>${card.serial ? `\nS/N: <code>${card.serial}</code>` : ''}\n\nNouveau solde : ${client.balance} DA`, chatId);
        
        addLog('Achat', chatId, 'Success', `${product.name} (${product.price} DA)`);
    } catch (e) { 
        console.error('Buy Error:', e);
        sendTelegram("❌ Une erreur est survenue lors de l'achat.", chatId);
    }
}

const FILES = {
    mobilis: 'data/mobilis.json',
    ooredoo: 'data/ooredoo.json',
    djezzy: 'data/djezzy.json',
    sama: 'data/sama.json'
};
const MODEMS_FILE_OLD = 'data/modems.json';
const SETTINGS_FILE = 'data/settings.json';
const PRODUCTS_FILE = 'data/products.json';
const CARDS_FILE = 'data/cards.json';
const CLIENTS_FILE = 'data/clients.json';
const SALES_FILE = 'data/sales.json';
const AUTO_REPLY_FILE = 'data/auto_reply.json';

if (!fs.existsSync('data')) fs.mkdirSync('data');

// Initialize Files
Object.values(FILES).forEach(f => { if (!fs.existsSync(f)) fs.writeFileSync(f, '[]'); });

function loadAllModems() {
    let all = [];
    // Migration from old unified file
    if (fs.existsSync(MODEMS_FILE_OLD)) {
        try {
            const oldData = JSON.parse(fs.readFileSync(MODEMS_FILE_OLD, 'utf8') || '[]');
            oldData.forEach(m => {
                const op = (m.operator || 'mobilis').toLowerCase();
                const f = FILES[op];
                if (f) {
                    const data = JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
                    if (!data.find(x => (x.port || x.ip) === (m.port || m.ip))) {
                        data.push(m);
                        fs.writeFileSync(f, JSON.stringify(data, null, 2));
                    }
                }
            });
            // Keep the old file renamed for safety
            fs.renameSync(MODEMS_FILE_OLD, MODEMS_FILE_OLD + '.bak');
            console.log('✅ [SYSTEM] Migration to multi-file storage complete.');
        } catch (e) { console.error('Migration Error:', e); }
    }

    Object.values(FILES).forEach(f => {
        try {
            const data = JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
            all = all.concat(data);
        } catch (e) {}
    });
    return all;
}

if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, '[]');
if (!fs.existsSync(CARDS_FILE)) fs.writeFileSync(CARDS_FILE, '[]');
if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, '[]');
if (!fs.existsSync(SALES_FILE)) fs.writeFileSync(SALES_FILE, '[]');
if (!fs.existsSync(AUTO_REPLY_FILE)) {
    const defaultReply = {
        message: "👋 <b>Bienvenue chez Flexy Server!</b>\n\nNos services :\n- Flexy Mobilis / Ooredoo / Djezzy\n- Vente de cartes de recharge\n- Activation d'offres\n\nContactez-nous ici : @votre_username"
    };
    fs.writeFileSync(AUTO_REPLY_FILE, JSON.stringify(defaultReply, null, 2));
}

function addSale(modemKey, phone, amount, operator) {
    try {
        const sales = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8') || '[]');
        sales.push({
            date: new Date().toISOString(),
            modem: modemKey,
            phone,
            amount: parseFloat(amount),
            operator
        });
        fs.writeFileSync(SALES_FILE, JSON.stringify(sales, null, 2));
    } catch (e) { console.error('Sale Log Error:', e); }
}

function generateReport(chatId, range = 'day') {
    try {
        const sales = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8') || '[]');
        const now = new Date();
        let startTime = new Date();

        if (range === 'day') startTime.setHours(0, 0, 0, 0);
        else if (range === 'week') startTime.setDate(now.getDate() - 7);
        else if (range === 'month') startTime.setMonth(now.getMonth() - 1);
        else if (range === '6months') startTime.setMonth(now.getMonth() - 6);
        else if (range === 'year') startTime.setFullYear(now.getFullYear() - 1);

        const filtered = sales.filter(s => new Date(s.date) >= startTime);
        const total = filtered.reduce((acc, s) => acc + s.amount, 0);
        
        const labels = { day: 'Aujourd\'hui', week: '7 jours', month: '30 jours', '6months': '6 mois', year: 'Année' };
        const arLabels = { day: 'اليوم', week: 'الأسبوع', month: 'الشهر', '6months': '6 أشهر', year: 'السنة' };
        
        let report = `🧾 <b>Rapport : ${arLabels[range]} (${labels[range]})</b>\n━━━━━━━━━━━━━━\n`;
        report += `✅ Opérations : <b>${filtered.length}</b>\n`;
        report += `💰 Total : <b>${total.toFixed(2)} DA</b>\n━━━━━━━━━━━━━━`;
        sendTelegram(report, chatId);
    } catch (e) { sendTelegram("❌ Erreur Rapport.", chatId); }
}

let settings = { tgToken: '', tgChatId: '' };
if (fs.existsSync(SETTINGS_FILE)) {
    try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) {}
}


// --- MIDDLEWARE CONFIGURATION ---
// (Already initialized at the top of the file)

let hardwareLogs = [];
let activeModems = {};
let hilinkState = {};

function addHardwareLog(type, port, status, response) {
    const log = { type, port, time: new Date().toLocaleTimeString(), status, response };
    hardwareLogs.unshift(log);
    if (hardwareLogs.length > 100) hardwareLogs.pop();
    console.log(`[${log.time}] [${port}] ${type}: ${status} - ${response}`);
}

function saveModems() {
    try {
        const ops = ['mobilis', 'ooredoo', 'djezzy'];
        ops.forEach(op => {
            const list = Object.values(activeModems)
                .filter(m => !m.data.remote && m.config.operator.toLowerCase() === op)
                .map(m => ({
                    ...m.config,
                    balance: m.data.balance,
                    lastSms: m.data.lastSms,
                    preferredBalance: m.config.preferredBalance || 'Default'
                }));
            fs.writeFileSync(FILES[op], JSON.stringify(list, null, 2));
        });
    } catch (e) { }
}




class ModemManager {
    constructor(config) {
        this.config = config;
        this.service = new ModemService(config);
        this.key = this.service.key;
        this.data = this.service.data;
        this.init();
    }

    init() {
        // High-frequency polling for status (Heartbeat)
        setInterval(() => this.service.updateStatus(), 15000);
        this.service.updateStatus();
        
        // Auto-poll balance every 10 mins
        setInterval(() => this.checkBalance(), 600000);

        // Immediate silent poll on boot to fill the cache
        this.service.pollSms(true);

        // Poll SMS every 10 seconds
        setInterval(() => this.service.pollSms(), 10000);
    }

    async checkBalance(customCode = null) {
        await this.service.checkBalance(customCode);
        saveModems();
    }

    async diagnose() {
        return await this.service.diagnose();
    }
}
app.post('/api/modems/check', async (req, res) => {
    const { key } = req.body;
    console.log(`📡 [API] Balance Check Requested for ${key}`);
    const modem = activeModems[key];
    if (!modem) return res.status(404).json({ error: 'Modem not found' });
    await modem.checkBalance();
    res.json({ success: true });
});

app.post('/api/modems/diagnose', async (req, res) => {
    const { key } = req.body;
    console.log(`🔍 [API] Diagnosis Requested for ${key}`);
    const modem = activeModems[key];
    if (!modem) return res.status(404).json({ error: 'Modem not found' });
    const info = await modem.diagnose();
    res.json(info);
});

// --- API ROUTES ---
app.get('/', (req, res) => {
    console.log('🏠 [HTTP] Serving Professional Customer Interface...');
    res.sendFile(path.join(__dirname, 'public', 'customer.html'));
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/customer', (req, res) => res.redirect('/'));
app.get('/admin.html', (req, res) => res.redirect('/admin'));
app.get('/index.html', (req, res) => res.redirect('/admin'));

let transactions = [];
function addLog(type, target, amount, success) {
    transactions.push({ time: new Date().toISOString(), type, target, amount, success });
    if (transactions.length > 50) transactions.shift();
}

app.get('/api/stats', (req, res) => {
    const modems = Object.values(activeModems).map(m => m.data);
    const onlineCount = modems.filter(m => m.online).length;
    const totalBalance = modems.reduce((acc, m) => acc + parseFloat(m.balance || 0), 0).toFixed(2);
    res.json({ modems, onlineCount, totalBalance, transactions });
});

app.post('/api/modems/add', (req, res) => {
    const config = req.body;
    const key = config.port || config.ip;
    if (activeModems[key]) return res.status(400).json({ error: 'Already exists' });
    activeModems[key] = new ModemManager(config);
    
    const op = config.operator.toLowerCase();
    const f = FILES[op];
    if (f) {
        const data = JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
        data.push(config);
        fs.writeFileSync(f, JSON.stringify(data, null, 2));
    }
    res.json({ success: true });
});

app.post('/api/modems/delete', (req, res) => {
    const { key } = req.body;
    const modem = activeModems[key];
    if (modem) {
        const op = modem.config.operator.toLowerCase();
        delete activeModems[key];
        const data = JSON.parse(fs.readFileSync(FILES[op], 'utf8') || '[]');
        const filtered = data.filter(m => (m.port || m.ip) !== key);
        fs.writeFileSync(FILES[op], JSON.stringify(filtered, null, 2));
    }
    res.json({ success: true });
});

// Duplicate routes removed (moved logic into main API section if needed)

app.post('/api/modems/set-network-mode', async (req, res) => {
    const { key, mode } = req.body;
    const modem = activeModems[key];
    if (modem && modem.service) {
        try {
            const headers = await modem.service.getHilinkHeaders();
            if (headers) {
                const xml = `<?xml version="1.0" encoding="UTF-8"?><request><NetworkMode>${mode}</NetworkMode><NetworkBand>3FFFFFFF</NetworkBand><LTEBand>7FFFFFFFFFFFFFFF</LTEBand></request>`;
                await fetch(`http://${modem.config.ip}/api/net/net-mode`, { method: 'POST', headers, body: xml });
                res.json({ success: true });
            } else res.status(401).json({ error: 'Auth failed' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    } else res.status(404).json({ error: 'Modem not found' });
});

// --- Idoom & Flexy Portal ---
const OOREDOO_OFFERS_FILE = path.join(__dirname, 'data/ooredoo_offers.json');
let OOREDOO_OFFERS = [];
try { OOREDOO_OFFERS = JSON.parse(fs.readFileSync(OOREDOO_OFFERS_FILE, 'utf8')); } catch (e) {}

const SAMA_OFFERS = [
    { id: 1, name: 'Sama 50 DA', op: 'SAMA', code: '*696*1', index: '1', amount: 50, type: 'PixX' },
    { id: 2, name: 'Sama 100 DA', op: 'SAMA', code: '*696*1', index: '1', amount: 100, type: 'PixX' },
    { id: 3, name: 'Sama 500 DA', op: 'SAMA', code: '*665*1', index: '3', amount: 500, type: 'Talk' },
    { id: 4, name: 'Sama 1000 DA', op: 'SAMA', code: '*665*1', index: '4', amount: 1000, type: 'Talk' },
    { id: 5, name: 'Sama 1500 DA', op: 'SAMA', code: '*665*1', index: '4', amount: 1500, type: 'Talk' },
    { id: 6, name: 'Sama 2000 DA', op: 'SAMA', code: '*665*1', index: '5', amount: 2000, type: 'Talk' },
    { id: 7, name: 'Sama Talk 500', op: 'SAMA', code: '*665*1', index: '6', amount: 500, type: 'Talk' },
    { id: 8, name: 'Sama Net 500', op: 'SAMA', code: '*665*2', index: '1', amount: 500, type: 'Net' },
    { id: 9, name: 'Sama Net 1000', op: 'SAMA', code: '*665*2', index: '2', amount: 1000, type: 'Net' }
];

app.get('/api/sama/offers-list', (req, res) => res.json(SAMA_OFFERS));
app.get('/api/offers/ooredoo', (req, res) => res.json(OOREDOO_OFFERS));

app.post('/api/offers/ooredoo/send', async (req, res) => {
    const { phone, optionId } = req.body;
    let modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'ooredoo' && m.data.online);
    if (!modem) modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'sama' && m.data.online);
    
    if (!modem) return res.status(404).json({ error: 'No Ooredoo modem connected' });
    
    const pin = modem.config.pin || '00000';
    const ussd = `*585*${phone}*${optionId}*${pin}#`;
    
    addLog(`شحن عرض Ooredoo`, phone, 0, true);
    
    // Execute async in background so UI doesn't hang
    modem.executeUssdSequence([ussd, '1']);
    
    res.json({ success: true, message: 'بدأت عملية الإرسال بنجاح!' });
});


app.post('/api/sama/recharge-offer', async (req, res) => {
    const { phone, offerId } = req.body;
    const offer = SAMA_OFFERS.find(o => o.id === parseInt(offerId));
    if (!offer) return res.status(404).json({ error: 'Offer not found' });

    const modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'sama' && m.data.online) ||
                  Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'mobilis' && m.data.online);
    
    if (!modem) return res.status(404).json({ error: 'No active SAMA/Mobilis modem found' });

    // Format: *665*1*PHONE*INDEX#
    const ussd = `${offer.code}*${phone}*${offer.index}#`;
    console.log(`📡 [SAMA RECHARGE] Sending ${offer.name} to ${phone} using ${ussd}...`);
    
    addLog('شحن عرض Sama', phone, offer.amount, true);
    modem.checkBalance(ussd).then(() => {
        // Refresh balance after offer selection
        setTimeout(() => modem.checkBalance(), 10000);
    });
    res.json({ success: true, message: 'Recharge process started' });
});

app.post('/api/portal/flexy', async (req, res) => {
    const { phone, amount } = req.body;
    let op = phone.startsWith('05') ? 'Ooredoo' : (phone.startsWith('06') ? 'Mobilis' : 'Djezzy');
    const modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === op.toLowerCase() && m.data.online);
    if (!modem) {
        addLog('شحن فليكسي', phone, amount, false);
        return res.status(404).json({ error: `No active modem found for ${op}` });
    }
    const pin = modem.config.pin || '00000';
    let ussd = (op === 'Mobilis') ? `*630*${phone}*04*${amount}*${pin}#` : (op === 'Ooredoo' ? `*580*${phone}*${amount}*${pin}#` : `*710*${phone}*${amount}*${pin}#`);
    addLog('شحن فليكسي', phone, amount, true);
    modem.checkBalance(ussd).then(() => {
        // Delayed check to allow SMS to arrive and be processed
        setTimeout(() => modem.checkBalance(), 10000);
    });
    res.json({ success: true });
});
app.post('/api/sama/offers', async (req, res) => {
    const { phone } = req.body;
    let op = phone.startsWith('05') ? 'Ooredoo' : (phone.startsWith('06') ? 'Mobilis' : 'Djezzy');

    // NEW LOGIC: 
    // - For Ooredoo (05): Prefer Ooredoo modem with *585*...
    // - For others: Prefer SAMA modem with *665*...
    
    let modem = null;
    let ussd = '';
    const pin = '0000'; // Default, but will use modem config if available

    if (op === 'Ooredoo') {
        modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'ooredoo' && m.data.online) ||
                Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'sama' && m.data.online);
        
        if (modem) {
            const mPin = modem.config.pin || '0000';
            if (modem.config.operator.toLowerCase() === 'ooredoo') {
                ussd = `*585*${phone}*${mPin}#`;
            } else {
                // SAMA modem querying Ooredoo
                ussd = (mPin && mPin !== '0000') ? `*665*1*${phone}*${mPin}#` : `*665*1*${phone}#`;
            }
        }
    } else {
        modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === 'sama' && m.data.online) ||
                Object.values(activeModems).find(m => m.config.operator.toLowerCase() === op.toLowerCase() && m.data.online);
        
        if (modem) {
            const mPin = modem.config.pin || '0000';
            if (modem.config.operator.toLowerCase() === 'sama') {
                ussd = (mPin && mPin !== '0000') ? `*665*1*${phone}*${mPin}#` : `*665*1*${phone}#`;
            } else {
                if (op === 'Mobilis') ussd = `*610*${phone}#`;
                else ussd = `*710*${phone}#`;
            }
        }
    }
    
    if (!modem) return res.status(404).json({ error: 'Modem not found or offline' });
    
    console.log(`📡 [OFFERS] Querying ${op} offers for ${phone} using ${modem.config.operator} modem (${ussd})...`);
    const content = await modem.service.queryUssd(ussd);
    
    if (content) {
        res.json({ success: true, content });
    } else {
        res.status(500).json({ error: 'Failed to get response from modem' });
    }
});

app.post('/api/flexy/invoice', async (req, res) => {
    const { phone, amount } = req.body;
    let op = phone.startsWith('05') ? 'Ooredoo' : (phone.startsWith('06') ? 'Mobilis' : 'Djezzy');
    const modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === op.toLowerCase() && m.data.online);
    
    if (!modem) return res.status(404).json({ error: `No active modem for ${op}` });
    
    const pin = modem.config.pin || '00000';
    let ussd = '';
    if (op === 'Mobilis') ussd = `*668*${phone}*${amount}*${pin}#`; // Common Mobilis Invoice code
    else if (op === 'Ooredoo') ussd = `*113*${amount}*${phone}*${pin}#`;
    else ussd = `*710*${phone}*${amount}*${pin}#`;
    
    console.log(`🧾 [INVOICE] Paying ${amount} DA for ${phone}...`);
    modem.checkBalance(ussd);
    res.json({ success: true });
});

app.post('/api/flexy/international', async (req, res) => {
    const { phone, amount } = req.body;
    let op = phone.startsWith('05') ? 'Ooredoo' : (phone.startsWith('06') ? 'Mobilis' : 'Djezzy');
    const modem = Object.values(activeModems).find(m => m.config.operator.toLowerCase() === op.toLowerCase() && m.data.online);
    
    if (!modem) return res.status(404).json({ error: `No active modem for ${op}` });
    
    const pin = modem.config.pin || '00000';
    let ussd = (op === 'Mobilis') ? `*644*${phone}*${amount}*${pin}#` : `*140*${phone}*${amount}#`; // Placeholder codes
    
    console.log(`🌍 [INTL] Alo International for ${phone} (${amount} DA)...`);
    modem.checkBalance(ussd);
    res.json({ success: true });
});

app.get('/api/modems/scan', async (req, res) => { 
    const results = [];
    try {
        const ports = await SerialPort.list();
        for (let p of ports) {
            if (p.vendorId || p.productId || p.path.toLowerCase().includes('com')) {
                results.push({ path: p.path, info: `USB: ${p.path} (${p.friendlyName || 'Modem'})`, type: 'serial' });
            }
        }
    } catch (e) { console.error('Serial Scan Error:', e.message); }

    // 2. Scan Common IPs
    const ips = ['192.168.8.1', '192.168.1.1', '192.168.0.1', '192.168.100.1', '192.168.50.1'];
    for (let ip of ips) {
        try {
            const hRes = await fetch(`http://${ip}/api/monitoring/status`, { timeout: 800 }).catch(() => null);
            if (hRes) results.push({ path: ip, info: `HiLink Modem (${ip})`, type: 'hilink' });
            else {
                const zRes = await fetch(`http://${ip}/goform/goform_get_cmd_process?cmd=network_type`, { timeout: 500 }).catch(() => null);
                if (zRes) results.push({ path: ip, info: `ZTE Modem (${ip})`, type: 'zte' });
            }
        } catch (e) {}
    }
    
    res.json({ ports: results }); 
});

// --- CUSTOMER API ---
app.get('/api/customer/products', (req, res) => {
    try {
        const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8') || '[]');
        const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8') || '[]');
        const result = products.map(p => {
            const stock = cards.filter(c => c.productId === p.id && !c.used).length;
            return { id: p.id, name: p.name, price: p.price, stock };
        });
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/idoom', async (req, res) => {
    const { phone, productId } = req.body;
    if (!phone || !productId) return res.status(400).json({ error: 'Missing data' });
    handleIdoomRecharge('WEB_PORTAL', productId, phone);
    res.json({ success: true, message: 'Process started' });
});

// --- SETTINGS ---
app.get('/api/settings', (req, res) => res.json(settings));
app.post('/api/settings', (req, res) => {
    settings = { ...settings, ...req.body };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    if (typeof pollTelegram === 'function') pollTelegram(); // Restart bot polling with new token
    res.json({ success: true });
});

// --- BOOT ---
console.log('\n🚀 FLEXY SERVER V2 BOOTING...');
const savedModems = loadAllModems();
savedModems.forEach(m => {
    try {
        activeModems[m.port || m.ip] = new ModemManager(m);
    } catch (e) { console.error(`Error loading modem ${m.ip}:`, e.message); }
});

const PORT = process.env.PORT || 8090;
app.listen(PORT, () => {
    console.log(`\n🚀 FLEXY SERVER V2 BOOTING...`);
    console.log(`✅ Server running on http://localhost:${PORT}`);
    pollTelegram();
});
