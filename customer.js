const API = {
    stats: '/api/stats',
    products: '/api/customer/products',
    flexy: '/api/portal/flexy',
    offers: '/api/sama/offers',
    invoice: '/api/flexy/invoice',
    idoom: '/api/customer/idoom'
};

let currentType = 'unknown';

document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initDetection();
    fetchBalance();
    loadProducts();
});

function initNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.onclick = () => {
            const target = btn.dataset.target;
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
            document.getElementById(`section-${target}`).classList.add('active');
        };
    });
}

function initDetection() {
    const input = document.getElementById('phone-input');
    const badge = document.getElementById('op-badge');
    const name = document.getElementById('op-name');
    const mobileActions = document.getElementById('mobile-actions');
    const idoomActions = document.getElementById('idoom-actions');

    input.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const hero = document.querySelector('.hero-card');
        
        // Reset
        hero.className = 'hero-card glass';
        mobileActions.classList.add('hidden');
        idoomActions.classList.add('hidden');
        currentType = 'unknown';

        if (val.length < 2) {
            name.innerText = 'جاهز للخدمة';
            return;
        }

        if (val.startsWith('06')) {
            currentType = 'mobilis';
            name.innerText = 'Mobilis';
            hero.classList.add('theme-mobilis');
            mobileActions.classList.remove('hidden');
        } else if (val.startsWith('05')) {
            currentType = 'ooredoo';
            name.innerText = 'Ooredoo';
            hero.classList.add('theme-ooredoo');
            mobileActions.classList.remove('hidden');
        } else if (val.startsWith('07')) {
            currentType = 'djezzy';
            name.innerText = 'Djezzy';
            hero.classList.add('theme-djezzy');
            mobileActions.classList.remove('hidden');
        } else if (val.match(/^(02|03|04)/)) {
            currentType = 'idoom-fixed';
            name.innerText = 'Idoom ADSL/Fiber';
            hero.classList.add('theme-idoom');
            idoomActions.classList.remove('hidden');
        } else if (val.startsWith('09')) {
            currentType = 'idoom-4g';
            name.innerText = 'Idoom 4G LTE';
            hero.classList.add('theme-idoom');
            idoomActions.classList.remove('hidden');
        } else {
            name.innerText = 'رقم غير معروف';
        }
    });
}

async function fetchBalance() {
    try {
        const res = await fetch(API.stats);
        const data = await res.json();
        document.getElementById('user-balance').innerText = data.totalBalance;
    } catch (e) {}
}

async function loadProducts() {
    const container = document.getElementById('cards-container');
    try {
        const res = await fetch(API.products);
        const products = await res.json();
        
        container.innerHTML = products.map(p => `
            <div class="card-node" onclick="buyCard('${p.id}', '${p.name}', ${p.price})">
                <div class="stock-badge ${p.stock > 0 ? 'stock-in' : 'stock-out'}">
                    ${p.stock > 0 ? `متوفر: ${p.stock}` : 'نفذت الكمية'}
                </div>
                <h3>${p.name}</h3>
                <div class="card-price">${p.price} DA</div>
                <button class="btn-confirm" style="width:100%" ${p.stock === 0 ? 'disabled' : ''}>شراء الآن</button>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<p>فشل تحميل البطاقات</p>';
    }
}

async function handleOffers() {
    const phone = document.getElementById('phone-input').value;
    if (phone.length < 10) return showToast('يرجى إدخال رقم صحيح', 'error');

    showLoader(true);
    try {
        const res = await fetch(API.offers, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success) {
            showResults('العروض المتوفرة', data.content, (offer) => {
                const amountMatch = offer.match(/(\d{2,4})/);
                if (amountMatch) {
                    confirmAction(`شحن عرض بقيمة ${amountMatch[0]} DA للرقم ${phone}؟`, () => {
                        submitFlexy(phone, amountMatch[0]);
                    });
                }
            });
        } else {
            showToast(data.error || 'فشل جلب العروض', 'error');
        }
    } catch (e) {
        showToast('خطأ في الاتصال', 'error');
    } finally {
        showLoader(false);
    }
}

async function handleInvoice() {
    const phone = document.getElementById('phone-input').value;
    const amount = prompt('أدخل قيمة الفاتورة (DA):');
    if (!amount) return;

    showLoader(true);
    try {
        const res = await fetch(API.invoice, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, amount })
        });
        const data = await res.json();
        if (data.success) showToast('تم إرسال طلب دفع الفاتورة بنجاح', 'success');
        else showToast(data.error, 'error');
    } finally {
        showLoader(false);
    }
}

async function submitFlexy(phone, amount) {
    showLoader(true);
    try {
        const res = await fetch(API.flexy, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, amount })
        });
        const data = await res.json();
        if (data.success) showToast('تمت العملية بنجاح', 'success');
        else showToast(data.error, 'error');
    } finally {
        showLoader(false);
    }
}

async function openIdoomModal() {
    const phone = document.getElementById('phone-input').value;
    const res = await fetch(API.products);
    const products = await res.json();
    const idoomProducts = products.filter(p => p.name.toLowerCase().includes('idoom') && p.stock > 0);
    
    if (idoomProducts.length === 0) return showToast('لا توجد بطاقات إيدوم متوفرة', 'error');
    
    let html = '<div class="idoom-options">';
    idoomProducts.forEach(p => {
        html += `<div class="offer-item" onclick="rechargeIdoom('${phone}', '${p.id}', '${p.name}')">
            <span>${p.name}</span>
            <span class="offer-amount">${p.price} DA</span>
        </div>`;
    });
    html += '</div>';
    
    showResults('اختر بطاقة التعبئة', html, null, true);
}

async function rechargeIdoom(phone, productId, name) {
    hidePanel();
    confirmAction(`تعبئة ${name} للرقم ${phone}؟`, async () => {
        showLoader(true);
        try {
            const res = await fetch(API.idoom, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, productId })
            });
            const data = await res.json();
            showToast('بدأت عملية التعبئة التلقائية. ستصلك رسالة عند الانتهاء.', 'success');
        } catch (e) {
            showToast('خطأ في العملية', 'error');
        } finally {
            showLoader(false);
        }
    });
}

// UI Helpers
function showResults(title, content, onSelect, isHtml = false) {
    const panel = document.getElementById('results-panel');
    const list = document.getElementById('results-list');
    document.getElementById('results-title').innerText = title;
    
    panel.classList.remove('hidden');
    list.innerHTML = '';
    
    if (isHtml) {
        list.innerHTML = content;
    } else {
        const lines = content.split('\n');
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.length < 3) return;
            const item = document.createElement('div');
            item.className = 'offer-item';
            item.innerHTML = `<span>${trimmed}</span>`;
            if (onSelect) item.onclick = () => onSelect(trimmed);
            list.appendChild(item);
        });
    }
    panel.scrollIntoView({ behavior: 'smooth' });
}

function hidePanel() {
    document.getElementById('results-panel').classList.add('hidden');
}

function showLoader(show) {
    document.getElementById('loading-overlay').className = show ? '' : 'hidden';
}

function showToast(msg, type = 'info') {
    alert(msg); // Placeholder for a real toast system
}

function confirmAction(text, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const textEl = document.getElementById('confirm-text');
    const btn = document.getElementById('btn-confirm');
    
    textEl.innerText = text;
    modal.classList.remove('hidden');
    
    btn.onclick = () => {
        modal.classList.add('hidden');
        onConfirm();
    };
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}
