console.log('🚀 Next-Gen Portal Loaded');
let API_BASE = localStorage.getItem('api_base') || '';

// Auto-fallback for file:// protocol if API_BASE is empty
if (!API_BASE && window.location.protocol === 'file:') {
    API_BASE = 'http://127.0.0.1:3005';
}

let lastSeenSmsTime = Date.now();

function getApiUrl(path) {
    if (!API_BASE) return path;
    // Ensure no double slashes and correct protocol
    let base = API_BASE;
    if (base.endsWith('/')) base = base.slice(0, -1);
    const p = path.startsWith('/') ? path : '/' + path;
    return base + p;
}

// Global fetch override to inject ADMIN_KEY
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (!config) config = {};
    if (!config.headers) config.headers = {};
    
    // Convert Headers object or array to plain object for easier injection
    let newHeaders = {};
    if (config.headers instanceof Headers) {
        config.headers.forEach((value, key) => newHeaders[key] = value);
    } else if (Array.isArray(config.headers)) {
        config.headers.forEach(([key, value]) => newHeaders[key] = value);
    } else {
        newHeaders = { ...config.headers };
    }
    
    // Inject Authorization header if ADMIN_KEY exists
    if (typeof ADMIN_KEY !== 'undefined' && ADMIN_KEY) {
        newHeaders['Authorization'] = ADMIN_KEY;
    }
    
    config.headers = newHeaders;
    return originalFetch(resource, config);
};

function updateConnectionStatus(connected) {
    const el = document.getElementById('connection-status');
    if (!el) return;
    if (connected) {
        el.style.color = 'var(--success)';
        el.innerHTML = '<i class="fas fa-circle"></i> متصل بالسيرفر';
    } else {
        el.style.color = 'var(--danger)';
        el.innerHTML = '<i class="fas fa-circle"></i> غير متصل بالسيرفر';
    }
}

async function fetchData() {
    try {
        const res = await fetch(getApiUrl('/api/stats'));
        const data = await res.json();
        updateConnectionStatus(true);
        document.getElementById('total-balance').innerText = data.totalBalance + ' DA';
        document.getElementById('online-count').innerText = `${data.onlineCount} / ${data.modems.length}`;
        renderModems(data.modems);
        if (data.transactions) renderTransactions(data.transactions);

        // AUTO-SMS POPUP Logic
        data.modems.forEach(m => {
            if (m.lastSms && m.lastSms.timestamp > lastSeenSmsTime) {
                lastSeenSmsTime = m.lastSms.timestamp;
                showSmsPopup(m.operator, m.lastSms.text);
            }
        });
    } catch (e) { 
        console.error('Sync Error:', e);
        updateConnectionStatus(false);
    }
}

function showSmsPopup(operator, text) {
    const modal = document.getElementById('sms-modal');
    const content = document.getElementById('sms-content');
    const title = document.querySelector('#sms-modal h2');
    
    title.innerHTML = `<i class="fas fa-envelope"></i> رسالة من ${operator}`;
    content.innerText = text;
    modal.style.display = 'flex';
    
    // Auto-close after 10 seconds if user doesn't close it
    // setTimeout(() => { modal.style.display = 'none'; }, 10000);
}

function renderTransactions(txs) {
    const list = document.getElementById('transaction-list');
    list.innerHTML = '';
    txs.slice(-10).reverse().forEach(tx => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--glass-border)';
        row.innerHTML = `
            <td style="padding: 15px 30px; font-size: 0.8rem; color: rgba(255,255,255,0.4);">${new Date(tx.time).toLocaleTimeString('ar-DZ')}</td>
            <td style="padding: 15px 30px; font-weight: 600;">${tx.target || 'نظام'}</td>
            <td style="padding: 15px 30px;"><span style="color: var(--primary); font-size: 0.7rem; font-weight: 700;">${tx.type}</span></td>
            <td style="padding: 15px 30px; font-weight: 700; color: var(--success);">${tx.amount || '---'}</td>
            <td style="padding: 15px 30px;">
                <span style="color: ${tx.success ? 'var(--success)' : 'var(--danger)'}; font-size: 0.7rem; font-weight: 700;">
                    <i class="fas fa-${tx.success ? 'check-circle' : 'times-circle'}"></i> 
                    ${tx.success ? 'ناجحة' : 'فاشلة'}
                </span>
            </td>
        `;
        list.appendChild(row);
    });
}

function renderModems(modems) {
    const lists = {
        mobilis: document.getElementById('list-mobilis'),
        ooredoo: document.getElementById('list-ooredoo'),
        djezzy: document.getElementById('list-djezzy'),
        sama: document.getElementById('list-sama')
    };
    Object.values(lists).forEach(l => { if (l) l.innerHTML = ''; });

    modems.forEach(m => {
        const opKey = m.operator.toLowerCase();
        const targetList = lists[opKey] || lists.mobilis;
        
        const node = document.createElement('div');
        node.className = `modem-node ${m.online ? '' : 'offline'}`;
        const signalOffset = 251 - (251 * (m.signal || 0)) / 100;
        
        let opIcon = 'M', opColor = '#00ff88';
        if (opKey === 'ooredoo') { opIcon = 'O'; opColor = '#ff0055'; }
        else if (opKey === 'djezzy') { opIcon = 'D'; opColor = '#ffb300'; }
        else if (opKey === 'sama') { opIcon = 'S'; opColor = '#a855f7'; }

        node.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="display: flex; gap: 20px; align-items: center;">
                    <div class="operator-icon" style="border-color: ${opColor}; color: ${opColor}">${opIcon}</div>
                    <div>
                        <h3 style="font-weight: 700; font-size: 1.2rem;">${m.operator}</h3>
                        <div style="font-size: 0.8rem; color: rgba(255,255,255,0.4);">${m.ip}</div>
                    </div>
                </div>
                <div class="gauge-container">
                    <svg class="gauge-svg">
                        <circle class="gauge-bg" cx="50" cy="50" r="40"></circle>
                        <circle class="gauge-val" cx="50" cy="50" r="40" style="stroke-dashoffset: ${signalOffset}px; stroke: ${opColor}"></circle>
                    </svg>
                    <div class="val-text" style="color: ${opColor}">${m.signal || 0}%</div>
                </div>
            </div>
            <div style="margin-top: 30px;">
                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.4); text-transform: uppercase;">رصيد العقدة الحالي</div>
                <div class="balance-neon" style="color: ${opColor}; text-shadow: 0 0 10px ${opColor}44">${m.balance || '0.00'} DA</div>
                <div style="font-size: 0.7rem; color: ${m.online ? 'var(--success)' : 'var(--danger)'};">
                    <i class="fas fa-${m.online ? 'check-circle' : 'exclamation-triangle'}"></i> 
                    ${m.online ? (m.simStatus || 'متصل') : 'غير متصل'}
                </div>
            </div>
            <div class="node-actions">
                <button class="btn-neon" onclick="checkBalance('${m.key}', '${m.operator}', this)">
                    <i class="fas fa-sync"></i> رصيد
                </button>
                <button class="btn-neon" onclick="diagnose('${m.key}', this)">
                    <i class="fas fa-microchip"></i> تشخيص
                </button>
                <button class="btn-neon" style="color: var(--warning);" onclick="rebootNode('${m.key}', this)">
                    <i class="fas fa-power-off"></i> ريستارت
                </button>
                <button class="btn-neon" style="flex: 0.3; color: var(--danger);" onclick="deleteModem('${m.key}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        targetList.appendChild(node);
    });
}

function getSignalColor(val) {
    if (val > 70) return '#00ff88';
    if (val > 40) return '#ffb300';
    return '#ff0055';
}

async function checkBalance(key, operator, btn) {
    const icon = btn.querySelector('i');
    icon.className = 'fas fa-spinner fa-spin';
    btn.disabled = true;

    try {
        await fetch(getApiUrl('/api/modems/check'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });

        icon.className = 'fas fa-check';
        setTimeout(() => { icon.className = 'fas fa-sync'; btn.disabled = false; fetchData(); }, 2000);
    } catch (e) {
        icon.className = 'fas fa-times';
        setTimeout(() => { icon.className = 'fas fa-sync'; btn.disabled = false; }, 2000);
    }
}

async function syncAllBalances() {
    const res = await fetch(getApiUrl('/api/stats'));
    const data = await res.json();
    const onlineModems = data.modems.filter(m => m.online);
    
    if (onlineModems.length === 0) return alert('لا توجد مودمات متصلة حالياً');
    
    alert(`جاري تحديث رصيد ${onlineModems.length} مودم... سيتم التحديث تدريجياً.`);
    
    for (const m of onlineModems) {
        fetch(getApiUrl('/api/modems/check'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: m.key })
        }).catch(() => {});
        // Stagger requests to avoid modem interference
        await new Promise(r => setTimeout(r, 2000));
    }
}

async function diagnose(key, btn) {
    const icon = btn.querySelector('i');
    icon.className = 'fas fa-spinner fa-spin';
    btn.disabled = true;
    try {
        const res = await fetch(getApiUrl('/api/modems/diagnose'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        alert('تشخيص العقدة:\n' + JSON.stringify(data.info, null, 2));
    } finally {
        icon.className = 'fas fa-microchip';
        btn.disabled = false;
    }
}

async function rebootNode(key, btn) {
    if (!confirm('إعادة تشغيل المودم؟')) return;
    const icon = btn.querySelector('i');
    icon.className = 'fas fa-spinner fa-spin';
    try {
        await fetch(getApiUrl('/api/modems/reboot'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        alert('تم إرسال الطلب');
    } finally {
        icon.className = 'fas fa-power-off';
    }
}

function openAddModal() { document.getElementById('add-modal').style.display = 'flex'; }
function openTransferModal() { document.getElementById('transfer-modal').style.display = 'flex'; }
async function openTgSettings() {
    try {
        const res = await fetch(getApiUrl('/api/settings'));
        const data = await res.json();
        document.getElementById('tg-token').value = data.tgToken || '';
        document.getElementById('tg-admin').value = data.tgChatId || '';
    } catch(e) { console.error(e); }
    document.getElementById('tg-modal').style.display = 'flex';
}
function closeModals() { 
    document.getElementById('add-modal').style.display = 'none'; 
    document.getElementById('transfer-modal').style.display = 'none'; 
    document.getElementById('sms-modal').style.display = 'none';
    document.getElementById('tg-modal').style.display = 'none';
    document.getElementById('server-modal').style.display = 'none';
    document.getElementById('offers-box').style.display = 'none';
    document.getElementById('offers-loading').style.display = 'none';
}

function openServerSettings() {
    document.getElementById('server-url').value = API_BASE;
    document.getElementById('server-modal').style.display = 'flex';
}

function saveServerSettings() {
    let url = document.getElementById('server-url').value.trim();
    if (url && !url.startsWith('http')) {
        url = 'http://' + url;
    }
    localStorage.setItem('api_base', url);
    API_BASE = url;
    alert('تم حفظ إعدادات السيرفر! جاري إعادة التحميل...');
    location.reload();
}


async function saveTgSettings() {
    const token = document.getElementById('tg-token').value.trim();
    const admin = document.getElementById('tg-admin').value.trim();
    if (!token || !admin) return alert('الرجاء إدخال التوكن ومعرف الأدمن');
    try {
        const res = await fetch(getApiUrl('/api/settings'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tgToken: token, tgChatId: admin })
        });
        const data = await res.json();
        if (data.success) {
            alert('تم الحفظ بنجاح! سيتم إعادة تشغيل البوت.');
            closeModals();
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch(e) { alert('خطأ في الاتصال'); }
}

async function fetchSamaOffers() {
    const phone = document.getElementById('flexy-phone').value;
    if (!phone || !phone.startsWith('06')) return alert('يرجى إدخال رقم Mobilis صحيح');

    const loading = document.getElementById('offers-loading');
    const box = document.getElementById('offers-box');
    const list = document.getElementById('offers-list');

    loading.style.display = 'block';
    box.style.display = 'none';
    list.innerHTML = '';

    try {
        const res = await fetch(getApiUrl('/api/sama/offers'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();
        
        if (data.success && data.content) {
            loading.style.display = 'none';
            box.style.display = 'block';
            
            // Basic parser for USSD menu
            const lines = data.content.split('\n');
            lines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed.length < 3 || trimmed.includes('Selectionnez')) return;
                
                const btn = document.createElement('button');
                btn.className = 'btn-neon';
                btn.style.textAlign = 'right';
                btn.style.fontSize = '0.75rem';
                btn.style.padding = '12px';
                btn.innerHTML = `<i class="fas fa-tag" style="color:var(--primary)"></i> ${trimmed}`;
                btn.onclick = () => {
                    const valMatch = trimmed.match(/(\d{2,4})/);
                    if (valMatch) document.getElementById('flexy-amount').value = valMatch[0];
                    alert('تم اختيار العرض: ' + trimmed);
                };
                list.appendChild(btn);
            });
        } else {
            throw new Error(data.error || 'لم يتم العثور على عروض أو المودم مشغول');
        }
    } catch (e) {
        loading.style.display = 'none';
        alert('خطأ SAMA: ' + e.message);
    }
}

async function saveNewModem() {
    const ip = document.getElementById('new-ip').value;
    const operator = document.getElementById('new-operator').value;
    const pin = document.getElementById('new-pin').value;
    await fetch(getApiUrl('/api/modems/add'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, operator, pin, type: 'hilink' })
    });
    closeModals(); fetchData();
}

async function submitFlexy() {
    const phone = document.getElementById('flexy-phone').value;
    const amount = document.getElementById('flexy-amount').value;
    if (!phone || !amount) return alert('يرجى إدخال البيانات');
    try {
        const res = await fetch(getApiUrl('/api/portal/flexy'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, amount })
        });
        const data = await res.json();
        if (data.success) alert('تم الإرسال: ' + (data.message || 'نجاح')); else alert('خطأ: ' + data.error);
    } finally { closeModals(); fetchData(); }
}

async function deleteModem(key) {
    if (confirm('حذف؟')) {
        await fetch(getApiUrl('/api/modems/delete'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        fetchData();
    }
}

// --- IDOOM LOGIC ---
function openIdoomModal(type) {
    document.getElementById('idoom-type').value = type;
    document.getElementById('idoom-title').innerText = type === 'adsl' ? 'شحن Idoom ADSL' : 'شحن Idoom 4G';
    document.getElementById('idoom-modal').style.display = 'flex';
}

async function submitIdoom() {
    const type = document.getElementById('idoom-type').value;
    const account = document.getElementById('idoom-phone').value;
    const pin = document.getElementById('idoom-pin').value;
    
    if (!account || !pin) return alert('يرجى إدخال رقم الهاتف الثابت وكود التعبئة');
    
    const btn = document.querySelector('#idoom-modal button:first-of-type');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الشحن...';
    btn.disabled = true;

    try {
        const res = await fetch(getApiUrl('/recharge-idoom'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, pin, type })
        });
        const data = await res.json();
        if (data.success) {
            alert('تم شحن Idoom بنجاح!');
        } else {
            alert('فشل شحن Idoom: ' + (data.error || 'خطأ غير معروف'));
        }
    } catch (e) {
        alert('حدث خطأ في الاتصال بالسيرفر: ' + e.message);
    } finally {
        btn.innerHTML = 'شحن الرصيد';
        btn.disabled = false;
        closeModals();
    }
}

// --- NEW MAIN RECHARGE CENTER LOGIC ---
function attachPhoneListener() {
    const mainPhoneInput = document.getElementById('main-phone');
    if (mainPhoneInput) {
        mainPhoneInput.addEventListener('input', async (e) => {
            const phone = e.target.value.trim();
            const box = document.getElementById('main-offers-box');
            const list = document.getElementById('main-offers-list');
            const title = document.getElementById('dynamic-box-title');
            
            // Auto detect Idoom ADSL (02, 03, 04) or Idoom 4G (213...)
            const isAdsl = phone.length >= 9 && (phone.startsWith('02') || phone.startsWith('03') || phone.startsWith('04') || phone.startsWith('09'));
            const is4g = phone.length >= 11 && phone.startsWith('213');
            
            if (isAdsl || is4g) {
                title.innerText = 'بطاقات Idoom المتوفرة';
                list.innerHTML = '<div style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> جاري جلب البطاقات...</div>';
                box.style.display = 'block';
                
                try {
                    const res = await fetch(getApiUrl('/api/cards/available'));
                    const data = await res.json();
                    list.innerHTML = '';
                    
                    if (data.success && data.cards && data.cards.length > 0) {
                        data.cards.forEach(card => {
                            const btn = document.createElement('button');
                            btn.className = 'btn-neon';
                            btn.style.fontSize = '0.9rem';
                            btn.style.background = 'rgba(255, 153, 0, 0.1)';
                            btn.style.borderColor = '#ff9900';
                            btn.innerHTML = `<i class="fas fa-wifi"></i> بطاقة ${card.value} DA`;
                            btn.onclick = () => rechargeIdoomCardDirect(phone, card.pin_code, is4g ? '4g' : 'adsl');
                            list.appendChild(btn);
                        });
                    } else {
                        list.innerHTML = '<div style="color:var(--warning);">لا توجد بطاقات Idoom متوفرة في المخزون.</div>';
                    }
                } catch (err) {
                    list.innerHTML = '<div style="color:var(--danger);">خطأ في جلب البطاقات.</div>';
                }
            } else {
                // Not an idoom number, hide if it was showing cards
                if (title && title.innerText.includes('Idoom')) {
                    box.style.display = 'none';
                    list.innerHTML = '';
                }
            }
        });
    }
}
attachPhoneListener();

async function rechargeIdoomCardDirect(account, pin, type) {
    if (!confirm(`هل أنت متأكد من شحن الرقم ${account} بهذه البطاقة؟`)) return;
    
    document.getElementById('main-offers-list').innerHTML = '<div style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> جاري الشحن...</div>';
    
    try {
        const res = await fetch(getApiUrl('/recharge-idoom'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, pin, type })
        });
        const data = await res.json();
        if (data.success) {
            alert('تم شحن Idoom بنجاح!');
            document.getElementById('main-offers-box').style.display = 'none';
            document.getElementById('main-phone').value = '';
        } else {
            alert('فشل شحن Idoom: ' + (data.error || 'خطأ غير معروف'));
            document.getElementById('main-offers-box').style.display = 'none';
        }
    } catch (e) {
        alert('حدث خطأ في الاتصال بالسيرفر: ' + e.message);
    }
}

async function submitFlexyMainDirect() {
    const phone = document.getElementById('main-phone').value.trim();
    const amount = document.getElementById('main-amount').value.trim();
    if (!phone || !amount) return alert('يرجى إدخال الرقم والمبلغ أولاً');
    
    submitFlexyMain(phone, amount);
}

async function loadOffersDynamically() {
    const phone = document.getElementById('main-phone').value.trim();
    if (!phone || phone.length < 10) return alert('يرجى إدخال رقم هاتف صحيح أولاً');

    const loading = document.getElementById('main-offers-loading');
    const box = document.getElementById('main-offers-box');
    const list = document.getElementById('main-offers-list');
    const title = document.getElementById('dynamic-box-title');

    let opName = 'مجهول';
    let opPath = '';
    if (phone.startsWith('05')) { opName = 'أوريدو (Ooredoo)'; opPath = 'ooredoo'; }
    else if (phone.startsWith('06')) { opName = 'موبيليس (Mobilis)'; opPath = 'mobilis'; }
    else if (phone.startsWith('07')) { opName = 'جازي (Djezzy)'; opPath = 'djezzy'; }
    else return alert('الرقم المدخل ليس رقم هاتف نقال صالح للجزائر.');

    title.innerText = `عروض ${opName}`;
    loading.style.display = 'block';
    box.style.display = 'none';
    list.innerHTML = '';

    try {
        const res = await fetch(getApiUrl(`/api/offers/${opPath}`));
        const offers = await res.json();
        loading.style.display = 'none';
        box.style.display = 'block';
        
        if (!offers || offers.length === 0) {
            list.innerHTML = '<div style="grid-column: span 2; text-align: center; color: var(--warning);">لا توجد عروض مسجلة لهذا المتعامل.</div>';
            return;
        }

        offers.forEach(o => {
            const btn = document.createElement('button');
            btn.className = 'btn-neon';
            btn.style.fontSize = '0.9rem';
            btn.style.padding = '12px';
            btn.style.display = 'flex';
            btn.style.flexDirection = 'column';
            btn.style.alignItems = 'center';
            btn.style.gap = '8px';
            btn.style.background = 'rgba(255, 255, 255, 0.05)';
            
            btn.innerHTML = `
                <i class="fas fa-gift" style="font-size: 1.5rem; color: var(--accent);"></i>
                <span style="font-size: 0.85rem; font-weight: bold;">${o.name}</span>
                <small style="color: var(--success); font-weight: 800; font-size: 0.9rem;">${o.amount} DA</small>
            `;
            
            btn.onclick = async () => {
                if (!confirm(`هل أنت متأكد من تفعيل العرض ${o.name} للرقم ${phone}؟`)) return;
                
                // Show loading state on button
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التفعيل...';
                btn.disabled = true;

                try {
                    const rRes = await fetch(getApiUrl('/api/offers/send'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, optionId: o.optionId, amount: o.amount })
                    });
                    const rData = await rRes.json();
                    if (rData.success) {
                        alert('✅ ' + rData.message);
                        box.style.display = 'none';
                        document.getElementById('main-phone').value = '';
                    } else {
                        alert('❌ خطأ: ' + (rData.error || 'حدث خطأ غير معروف'));
                        btn.innerHTML = originalHtml;
                        btn.disabled = false;
                    }
                } catch (err) {
                    alert('❌ خطأ في الاتصال بالسيرفر');
                    btn.innerHTML = originalHtml;
                    btn.disabled = false;
                }
            };
            list.appendChild(btn);
        });
    } catch (e) {
        loading.style.display = 'none';
        alert('فشل جلب العروض من السيرفر. تأكد من تشغيل السيرفر المحدث.');
    }
}

async function submitFlexyMain(phone, amount) {
    try {
        const res = await fetch(getApiUrl('/api/portal/flexy'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, amount })
        });
        const data = await res.json();
        if (data.success) alert('تمت عملية الشحن بنجاح');
        else alert('خطأ: ' + data.error);
    } catch (e) { alert('فشل عملية الشحن'); }
}

// --- AGENTS MANAGEMENT ---
let ADMIN_KEY = localStorage.getItem('admin_key') || '';

function openAgentsModal() {
    if (!ADMIN_KEY) {
        ADMIN_KEY = prompt('أدخل مفتاح الإدارة (Admin Key) للوصول للوكلاء:');
        if (!ADMIN_KEY) return;
        localStorage.setItem('admin_key', ADMIN_KEY);
    }
    document.getElementById('agents-modal').style.display = 'flex';
    fetchAgents();
}

async function fetchAgents() {
    const list = document.getElementById('agents-list');
    list.innerHTML = '<tr><td colspan="5" style="text-align:center;">جاري التحميل...</td></tr>';
    try {
        const res = await fetch(getApiUrl('/api/agents'), {
            headers: { 'Authorization': ADMIN_KEY }
        });
        if (res.status === 401) {
            alert('مفتاح الإدارة غير صحيح!');
            localStorage.removeItem('admin_key');
            ADMIN_KEY = '';
            closeModals();
            return;
        }
        const data = await res.json();
        if (data.success) {
            list.innerHTML = '';
            data.agents.forEach(agent => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--glass-border)';
                tr.innerHTML = `
                    <td style="padding: 15px;">${agent.id}</td>
                    <td style="padding: 15px; font-weight: 600;">${agent.name}</td>
                    <td style="padding: 15px;">${agent.telegram_id || '-'}</td>
                    <td style="padding: 15px; font-weight: 700; color: var(--success);">${agent.balance} دج</td>
                    <td style="padding: 15px;"><span style="color: ${agent.status === 'suspended' ? 'var(--danger)' : 'var(--success)'}">${agent.status === 'suspended' ? 'موقوف' : 'نشط'}</span></td>
                `;
                list.appendChild(tr);
            });
        }
    } catch (e) {
        list.innerHTML = '<tr><td colspan="5" style="text-align:center;color:red;">فشل الاتصال بالسيرفر. تأكد من أن المنفذ 3005 يعمل وأنه مضاف في إعدادات الاتصال.</td></tr>';
    }
}

function showAddAgentForm() {
    const form = document.getElementById('add-agent-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function saveNewAgent() {
    const name = document.getElementById('agent-name').value;
    const phone = document.getElementById('agent-phone').value;
    const telegram_id = document.getElementById('agent-tg').value;
    const balance = document.getElementById('agent-balance').value;

    if (!name || !telegram_id) return alert('الاسم ومعرف التلغرام مطلوبان');

    try {
        const res = await fetch(getApiUrl('/api/agents'), {
            method: 'POST',
            headers: { 'Authorization': ADMIN_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, telegram_id, balance: parseFloat(balance) })
        });
        const data = await res.json();
        if (data.success) {
            alert('تمت الإضافة بنجاح');
            showAddAgentForm();
            fetchAgents();
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch (e) {
        alert('فشل الاتصال بالسيرفر');
    }
}

// Also close agents modal in closeModals()
const originalCloseModals = closeModals;
closeModals = function() {
    originalCloseModals();
    const agModal = document.getElementById('agents-modal');
    if (agModal) agModal.style.display = 'none';
}

setInterval(syncAllBalances, 60000); // Auto USSD balance sync every minute
fetchData();

async function submitFlexyMain(phone, amount) {
    if (!confirm(`????? ????? ${amount} DA ????? ${phone}?`)) return;
    try {
        const res = await fetch(getApiUrl('/api/flexy'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account: phone, amount: amount, type: '1' })
        });
        const data = await res.json();
        if (data.success) {
            alert('?? ????? ?????');
            document.getElementById('main-phone').value = '';
            document.getElementById('main-amount').value = '';
        } else {
            alert('??? ????? ?????: ' + (data.error || data.message || ''));
        }
    } catch(e) { 
        alert('??? ?????: ' + e.message); 
    }
}

