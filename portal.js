console.log('🚀 Next-Gen Portal Loaded');
let API_BASE = localStorage.getItem('api_base') || '';
let lastSeenSmsTime = Date.now();

function getApiUrl(path) {
    if (!API_BASE) return path;
    // Ensure no double slashes and correct protocol
    let base = API_BASE;
    if (base.endsWith('/')) base = base.slice(0, -1);
    const p = path.startsWith('/') ? path : '/' + path;
    return base + p;
}

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
        const res = await fetch(getApiUrl('/api/flexy/send'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, amount })
        });
        const data = await res.json();
        if (data.success) alert('تم الإرسال'); else alert('خطأ: ' + data.error);
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


// --- NEW MAIN RECHARGE CENTER LOGIC ---
async function fetchSamaOffersMain() {
    const phone = document.getElementById('main-phone').value;
    if (!phone || phone.length < 10) return alert('يرجى إدخال رقم صحيح أولاً');

    const loading = document.getElementById('main-offers-loading');
    const box = document.getElementById('main-offers-box');
    const list = document.getElementById('main-offers-list');

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
            const lines = data.content.split('\n');
            lines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed.length < 3) return;
                
                const btn = document.createElement('button');
                btn.className = 'btn-neon';
                btn.style.fontSize = '0.8rem';
                btn.innerHTML = `<i class="fas fa-tag"></i> ${trimmed}`;
                btn.onclick = () => {
                    const valMatch = trimmed.match(/(\d{2,4})/);
                    if (valMatch && confirm(`هل تريد شحن هذا العرض بقيمة ${valMatch[0]} DA؟`)) {
                        submitFlexyMain(phone, valMatch[0]);
                    }
                };
                list.appendChild(btn);
            });
        } else throw new Error(data.error || 'فشل جلب العروض');
    } catch (e) {
        loading.style.display = 'none';
        alert('خطأ: ' + e.message);
    }
}

async function handleInvoiceMain() {
    const phone = document.getElementById('main-phone').value;
    if (!phone || phone.length < 10) return alert('يرجى إدخال رقم صحيح');
    const amount = prompt('أدخل قيمة الفاتورة (DA):');
    if (!amount) return;

    try {
        const res = await fetch(getApiUrl('/api/flexy/invoice'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, amount })
        });
        const data = await res.json();
        if (data.success) alert('تم إرسال طلب الفاتورة');
        else alert('خطأ: ' + data.error);
    } catch (e) { alert('فشل الاتصال'); }
}

async function handleInternationalMain() {
    const phone = document.getElementById('main-phone').value;
    if (!phone || phone.length < 10) return alert('يرجى إدخال رقم صحيح');
    const amount = prompt('أدخل القيمة (Alo International):');
    if (!amount) return;

    try {
        const res = await fetch(getApiUrl('/api/flexy/international'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, amount })
        });
        const data = await res.json();
        if (data.success) alert('تم إرسال الطلب الدولي');
        else alert('خطأ: ' + data.error);
    } catch (e) { alert('فشل الاتصال'); }
}

async function loadOffersDynamically() {
    const box = document.getElementById('main-offers-box');
    const list = document.getElementById('main-offers-list');
    const phone = document.getElementById('main-phone').value;
    
    if (!phone || phone.length < 10) return alert('يرجى إدخال رقم الهاتف أولاً');

    box.style.display = 'block';
    const isOoredoo = phone.startsWith('05');

    if (isOoredoo) {
        list.innerHTML = '<div style="grid-column: span 2; text-align: center; color: var(--primary);">جاري تحميل عروض Ooredoo...</div>';
        try {
            const res = await fetch(getApiUrl('/api/offers/ooredoo'));
            const offers = await res.json();
            list.innerHTML = '';
            
            offers.forEach(o => {
                const btn = document.createElement('button');
                btn.className = 'btn-neon';
                btn.style.fontSize = '0.8rem';
                btn.style.padding = '10px';
                btn.style.display = 'flex';
                btn.style.flexDirection = 'column';
                btn.style.alignItems = 'center';
                btn.style.gap = '5px';
                btn.style.background = 'rgba(255, 255, 255, 0.05)';
                
                btn.innerHTML = `
                    <img src="${o.image}" alt="${o.name}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 8px;">
                    <span style="font-size: 0.75rem;">${o.name}</span>
                    <small style="color: var(--success); font-weight: 800;">${o.amount ? o.amount + ' DA' : ''}</small>
                `;
                
                btn.onclick = async () => {
                    if (!confirm(`هل تريد إرسال العرض ${o.name} للرقم ${phone}؟`)) return;
                    
                    const rRes = await fetch(getApiUrl('/api/offers/ooredoo/send'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, optionId: o.optionId })
                    });
                    const rData = await rRes.json();
                    if (rData.success) alert('✅ ' + rData.message);
                    else alert('❌ خطأ: ' + rData.error);
                };
                list.appendChild(btn);
            });
        } catch (e) {
            alert('فشل جلب عروض أوريدو');
        }
    } else {
        list.innerHTML = '<div style="grid-column: span 2; text-align: center; color: var(--primary);">جاري تحميل عروض Sama Pro...</div>';
        try {
            const res = await fetch(getApiUrl('/api/sama/offers-list'));
            const offers = await res.json();
            list.innerHTML = '';
            
            offers.forEach(o => {
                const btn = document.createElement('button');
                btn.className = 'btn-neon';
                btn.style.fontSize = '0.8rem';
                btn.style.padding = '15px';
                btn.style.display = 'flex';
                btn.style.flexDirection = 'column';
                btn.style.alignItems = 'center';
                btn.style.gap = '5px';
                
                let icon = 'fas fa-phone';
                if (o.type === 'Net') icon = 'fas fa-wifi';
                if (o.type === 'PixX') icon = 'fas fa-bolt';
                
                btn.innerHTML = `
                    <i class="${icon}" style="font-size: 1.2rem; color: var(--primary);"></i>
                    <span>${o.name}</span>
                    <small style="color: var(--success); font-weight: 800;">${o.amount} DA</small>
                `;
                
                btn.onclick = async () => {
                    if (!confirm(`هل تريد شحن ${o.name} للرقم ${phone}؟`)) return;
                    const rRes = await fetch(getApiUrl('/api/sama/recharge-offer'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, offerId: o.id })
                    });
                    const rData = await rRes.json();
                    if (rData.success) alert('✅ تم بدء عملية الشحن');
                    else alert('❌ خطأ: ' + rData.error);
                    fetchData();
                };
                list.appendChild(btn);
            });
        } catch (e) {
            alert('فشل جلب قائمة العروض');
        }
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

setInterval(syncAllBalances, 60000); // Auto USSD balance sync every minute
fetchData();
