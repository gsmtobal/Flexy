let balanceVisible = true;
const balanceKey = 'balance_visible';

document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem(balanceKey);
    if (saved === 'false') {
        balanceVisible = false;
        setTimeout(updateBalanceVisibility, 500); // Wait for initial render
    }
    
    const eye = document.getElementById('toggle-balance');
    if (eye) eye.addEventListener('click', toggleBalance);
});

function toggleBalance() {
    balanceVisible = !balanceVisible;
    localStorage.setItem(balanceKey, balanceVisible);
    updateBalanceVisibility();
}

function updateBalanceVisibility() {
    const el = document.getElementById('total-balance');
    const icon = document.getElementById('toggle-balance');
    if (!el || !icon) return;
    
    if (balanceVisible) {
        el.style.filter = 'none';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    } else {
        el.style.filter = 'blur(8px)';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    }
}

function openGrosModal() {
    alert("🚀 Flexy Gros (Bulk) Mode\nThis feature allows you to upload a CSV of numbers for automated bulk transfer.");
}

function openAddModemModal() {
    console.log("Attempting to open modem modal...");
    const modal = document.getElementById('modem-modal');
    if (modal) {
        modal.style.display = 'flex';
        try {
            toggleModemFields();
        } catch(e) { console.error("toggleModemFields error:", e); }
    } else {
        alert("خطأ: لم يتم العثور على نافذة الإضافة في الصفحة.");
    }
}

function closeModemModal() {
    document.getElementById('modem-modal').style.display = 'none';
}

function toggleModemFields() {
    // Modal is now fixed layout
}

async function scanPorts() {
    const ipInput = document.getElementById('modem-ip');
    const scanIcon = document.getElementById('scan-icon');
    if (!ipInput) return;
    
    const oldVal = ipInput.value;
    ipInput.value = "جاري البحث...";
    if (scanIcon) scanIcon.classList.add('fa-spin');

    try {
        const res = await fetch('/api/modems/scan');
        const data = await res.json();
        if (data.ports && data.ports.length > 0) {
            ipInput.value = data.ports[0].path;
            // Success animation or feedback could go here
        } else {
            ipInput.value = oldVal || "192.168.8.1";
            alert("لم يتم العثور على مودم HiLink تلقائياً. تأكد من توصيله بالشبكة أو أدخل الـ IP يدوياً.");
        }
    } catch (e) { 
        ipInput.value = oldVal; 
        alert("خطأ أثناء محاولة البحث التلقائي.");
    } finally {
        if (scanIcon) scanIcon.classList.remove('fa-spin');
    }
}

async function saveModem() {
    const operator = document.getElementById('modem-operator').value;
    const pin = document.getElementById('modem-pin').value;
    const port = document.getElementById('modem-ip').value;
    const password = document.getElementById('modem-password').value;
    const simNumber = document.getElementById('modem-number').value;
    const simLabel = document.getElementById('modem-label').value;
    const priority = document.getElementById('modem-priority').value;

    if (!port) return alert("يرجى إدخال عنوان الـ IP الخاص بالمودم");

    try {
        const res = await fetch('/api/modems/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                type: 'hilink', 
                operator, 
                port, 
                pin, 
                password, 
                simNumber,
                simLabel,
                priority,
                balance: "0" 
            })
        });
        const data = await res.json();
        if (data.success) {
            closeModemModal();
            // Show a nice success toast or just reload
            location.reload(); 
        } else {
            alert("فشل إضافة المودم: " + (data.error || "خطأ مجهول"));
        }
    } catch (e) { 
        console.error(e);
        alert("حدث خطأ تقني أثناء الحفظ."); 
    }
}

let currentClientId = null;

async function setPreferredBalance(key, type) {
    console.log(`Setting preferred balance for ${key} to ${type}`);
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        const m = data.modems.find(mod => (mod.port || mod.ip) === key);
        if (!m) return;

        await fetch('/api/modems/update-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                key, 
                operator: m.operator, 
                port: m.port || m.ip, 
                pin: m.pin, 
                balance: m.balance,
                preferredBalance: type 
            })
        });
        fetchStats();
    } catch (e) { console.error('Error updating preferred balance:', e); }
}

function switchTab(tabId) {
    const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (navItem) navItem.click();
}

// --- Tab Switching ---
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const tabId = item.getAttribute('data-tab');
        if (!tabId) return; // Allow normal links like telegram.html to work
        
        e.preventDefault();
        
        // Update active nav
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // Update active tab
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        const target = document.getElementById(tabId);
        if (target) target.classList.add('active');
        
        // Update titles
        const tabTitle = document.getElementById('tab-title');
        const tabSubtitle = document.getElementById('tab-subtitle');
        if (tabTitle) tabTitle.innerText = item.innerText.trim();
        if (tabSubtitle) tabSubtitle.innerText = `Manage your ${item.innerText.trim().toLowerCase()} here`;
    });
});

// --- Data Fetching ---
// --- Modem Actions (Radical Fix) ---
function setupModemListeners() {
    const container = document.getElementById('modems-container');
    if (!container) {
        console.warn('Modems container not found, retrying...');
        setTimeout(setupModemListeners, 500);
        return;
    }
    
    // Remove old listeners to avoid duplicates
    const newContainer = container.cloneNode(true);
    container.parentNode.replaceChild(newContainer, container);
    
    newContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        
        const action = btn.getAttribute('data-action');
        const key = btn.getAttribute('data-key');
        
        console.log(`Action: ${action}, Key: ${key}`);
        
        if (action === 'check') checkBalance(key, btn);
        if (action === 'sms') openSmsModal(key, btn);
        if (action === 'reboot') restartModem(key, btn);
        if (action === 'config') openBalanceModal(key, btn);
        if (action === 'delete') deleteModem(key);
    });
}

async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        // Update Dashboard Stats
        const totalBalEl = document.getElementById('total-balance');
        const clientCountEl = document.getElementById('client-count');
        const signalPercentEl = document.getElementById('signal-percent');

        if (totalBalEl) totalBalEl.innerText = `${data.totalBalance || '0.00'} DA`;
        if (clientCountEl) clientCountEl.innerText = data.clientsCount || '0';
        
        const primaryModem = (data.modems && data.modems[0]) || { signal: 0 };
        if (signalPercentEl) signalPercentEl.innerText = `${primaryModem.signal || 0}%`;
        
        // Render Modems (Puces)
        const container = document.getElementById('modems-container');
        const header = document.querySelector('header');
        if (container && data.modems) {
            if (data.modems.length === 0) {
                if (header) header.classList.add('no-modems-alert');
                container.innerHTML = `
                    <div class="panel" style="grid-column: 1/-1; text-align: center; padding: 60px; background: rgba(255,255,255,0.02); border-radius: 24px; border: 1px dashed var(--border-color);">
                        <i class="fas fa-microchip" style="font-size: 3rem; color: var(--text-secondary); margin-bottom: 20px; display: block;"></i>
                        <h3 style="color: var(--text-primary); margin-bottom: 10px;">Aucun Modem Connecté</h3>
                        <p style="color: var(--text-secondary);">Veuillez vérifier la connexion USB de vos modems ou ajouter un جديد.</p>
                    </div>
                `;
            } else {
                if (header) header.classList.remove('no-modems-alert');
                container.innerHTML = data.modems.map(m => {
                    const key = (m.port || m.ip || 'N/A').replace(/'/g, "\\'");
                    const statusClass = m.online && m.simStatus === 'READY' ? 'status-ready' : 'status-error';
                    return `
                    <div class="modem-module ${statusClass}">
                        <div class="module-window-title">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="modem-id-badge">${m.id ? m.id.toString().slice(-2) : '??'}</span>
                                <span style="font-weight: 700; font-size: 0.85rem;">${m.simLabel || m.operator || 'MODEM'}</span>
                                ${m.online ? '<i class="fas fa-check-circle" style="color: #10b981; font-size: 0.7rem;"></i>' : '<i class="fas fa-times-circle" style="color: #ef4444; font-size: 0.7rem;"></i>'}
                            </div>
                            <div class="window-controls">
                                <div onclick="deleteModem('${key}')" class="win-btn delete" style="cursor:pointer"><i class="fas fa-trash-alt"></i></div>
                            </div>
                        </div>
                        
                        <div class="module-content-area">
                            <div class="info-row-tobal">
                                <span class="label-tobal">Number:</span>
                                <span class="value-tobal">${m.simNumber || '---'}</span>
                            </div>
                            <div class="info-row-tobal">
                                <span class="label-tobal">IP:</span>
                                <span class="value-tobal">${m.port || m.ip}</span>
                            </div>

                            <div class="machine-status-header">
                                <div class="led-indicator">
                                    <div class="led-bulb red ${!m.online || m.simStatus === 'No SIM' ? 'active' : ''}"></div>
                                    <span>Error</span>
                                </div>
                                <div class="led-indicator">
                                    <div class="led-bulb yellow ${m.simStatus && m.simStatus !== 'READY' && m.simStatus !== 'Disconnected' && m.simStatus !== 'No SIM' ? 'active' : ''}"></div>
                                    <span>${m.simStatus || 'Wait'}</span>
                                </div>
                                <div class="led-indicator">
                                    <div class="led-bulb green ${m.online && m.simStatus === 'READY' ? 'active' : ''}"></div>
                                    <span>Online</span>
                                </div>
                            </div>
                            
                            <div class="digital-displays">
                                <div class="digit-box">
                                    <span class="digit-label">Balance</span>
                                    <div class="digit-value">${m.balance || '0.00'}</div>
                                </div>
                                <div class="digit-box">
                                    <span class="digit-label">Signal</span>
                                    <div class="digit-value">${getSignalBars(m.signal || 0)}</div>
                                </div>
                                <div class="digit-box">
                                    <span class="digit-label">Network</span>
                                    <div class="digit-value purple" style="font-size: 0.8rem;">${m.networkType || '---'}</div>
                                </div>
                            </div>

                            <div class="balance-selector-row-tobal">
                                ${['POSTE', 'DATA', 'ASSILOU', 'MOBILIS', 'GTS'].map(type => `
                                    <div onclick="setPreferredBalance('${key}', '${type}')" 
                                         class="balance-type-chip ${m.preferredBalance === type ? 'active' : ''}">
                                        ${type}
                                    </div>
                                `).join('')}
                            </div>

                            <div class="action-row-tobal">
                                <button onclick="startModem('${key}')" class="tobal-btn-action" title="Connect/Start" style="background: rgba(16, 185, 129, 0.1); color: #10b981;"><i class="fas fa-play"></i></button>
                                <button onclick="checkBalance('${key}', this)" class="tobal-btn-action main" title="Check Balance">
                                    <i class="fas fa-wallet"></i> <span>Check Balance</span>
                                </button>
                                <button onclick="diagnoseModem('${key}')" class="tobal-btn-action" title="Diagnose" style="background: rgba(99, 102, 241, 0.1); color: #6366f1;"><i class="fas fa-stethoscope"></i></button>
                                <button onclick="restartModem('${key}')" class="tobal-btn-action" title="Restart"><i class="fas fa-power-off"></i></button>
                                <button onclick="openBalanceModal('${key}', this)" class="tobal-btn-action" title="Settings"><i class="fas fa-cog"></i></button>
                            </div>
                        </div>
                    </div>
                `;}).join('');
            }
        }

        // Update Logs
        const logsContainer = document.getElementById('recent-logs');
        if (logsContainer && data.recentLogs) {
            logsContainer.innerHTML = data.recentLogs.map(log => `
                <div class="log-item">
                    <div>
                        <span class="log-user">${log.user}:</span>
                        <span>${log.text}</span>
                    </div>
                    <span class="log-time">${log.time}</span>
                </div>
            `).join('');
        }

    } catch (err) {
        console.error('Error fetching stats:', err);
    }
}

async function discoverPorts() {
    const select = document.getElementById('add-modem-port');
    if (!select) {
        console.error('❌ Select "add-modem-port" not found');
        return;
    }
    
    const originalBtn = event ? event.currentTarget : null;
    if (originalBtn) originalBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Scanning...';
    
    try {
        const res = await fetch('/api/utils/list-ports');
        const ports = await res.json();
        
        // Keep existing options if any (like HiLink)
        let html = '<option value="">Select Port...</option>';
        html += ports.map(p => `<option value="${p.path}">${p.path} (${p.friendlyName || 'Device'})</option>`).join('');
        
        // Add option to type manually if needed
        html += '<option value="MANUAL">--- Type Manually ---</option>';
        
        select.onchange = (e) => {
            if (e.target.value === 'MANUAL') {
                const manual = prompt('Enter Port or IP manually (e.g. COM15 or 192.168.8.1):');
                if (manual) {
                    const opt = document.createElement('option');
                    opt.value = manual;
                    opt.text = manual;
                    opt.selected = true;
                    select.appendChild(opt);
                } else {
                    select.value = '';
                }
            }
        };
        
        select.innerHTML = html;
        if (originalBtn) originalBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Scan';
        
        if (ports.length === 0) {
            alert('لم يتم العثور على أي منافذ COM. تأكد من توصيل المودم.');
        } else {
            alert(`تم العثور على ${ports.length} منافذ.`);
        }
    } catch (e) {
        console.error('❌ Discovery failed:', e);
        if (originalBtn) originalBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Scan';
        alert('فشل عملية الفحص.');
    }
}

async function checkBalance(key, btn) {
    if (!btn) btn = event.currentTarget;
    const originalText = btn.innerText;
    btn.innerText = 'Checking...';
    logToTerminal(key, ':INITIATING BALANCE CHECK...');
    
    try {
        await fetch('/api/modems/check-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: key, ip: key })
        });
        setTimeout(() => {
            btn.innerText = originalText;
        }, 3000);
    } catch (e) { 
        btn.innerText = originalText;
        logToTerminal(key, ':ERROR CONNECTING TO API');
    }
}

async function restartModem(key) {
    if (!confirm(`هل تريد حقاً إعادة تشغيل المودم ${key}؟`)) return;
    try {
        await fetch('/api/modems/reboot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: key, ip: key })
        });
        alert('جاري إرسال أمر إعادة التشغيل...');
    } catch (e) { alert('فشل إرسال الأمر'); }
}

async function deleteModem(key) {
    if (!confirm(`هل أنت متأكد من حذف المودم ${key}؟`)) return;
    try {
        await fetch('/api/modems/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: key, ip: key })
        });
        location.reload();
    } catch (e) { alert('فشل الحذف'); }
}

// Auto-Poll Balance every 5 minutes
setInterval(() => {
    document.querySelectorAll('.tobal-btn-action.main').forEach(btn => {
        btn.click();
    });
}, 300000);

async function openSmsModal(key, btn) {
    if (!btn) btn = event.currentTarget;
    // We can get the last SMS from the data we already have or fetch specifically
    const res = await fetch('/api/stats');
    const data = await res.json();
    const modem = data.modems.find(m => (m.port || m.ip) === key);
    if (modem) {
        alert(`Dernier Message pour ${key}:\n\n${modem.lastSms}`);
    }
}

let currentModemKey = null;
async function openBalanceModal(key, btn) {
    if (!btn) btn = event.currentTarget;
    currentModemKey = key;
    const res = await fetch('/api/stats');
    const data = await res.json();
    const m = data.modems.find(mod => (mod.port || mod.ip) === key);
    
    if (m) {
        if (document.getElementById('edit-modem-op')) document.getElementById('edit-modem-op').value = m.operator || '';
        if (document.getElementById('edit-modem-port')) document.getElementById('edit-modem-port').value = m.port || m.ip || '';
        if (document.getElementById('edit-modem-pin')) document.getElementById('edit-modem-pin').value = m.pin || '';
        if (document.getElementById('edit-modem-preferred')) document.getElementById('edit-modem-preferred').value = m.preferredBalance || 'Default';
        if (document.getElementById('new-modem-balance')) document.getElementById('new-modem-balance').value = parseFloat(m.balance) || 0;
        
        const bModal = document.getElementById('modem-balance-modal');
        if (bModal) bModal.style.display = 'flex';
        else alert("نافذة التعديل غير متوفرة حالياً.");
    }
}

function closeBalanceModal() {
    const bModal = document.getElementById('modem-balance-modal');
    if (bModal) bModal.style.display = 'none';
}

async function saveModemBalance() {
    const operator = document.getElementById('edit-modem-op').value;
    const port = document.getElementById('edit-modem-port').value;
    const pin = document.getElementById('edit-modem-pin').value;
    const preferredBalance = document.getElementById('edit-modem-preferred').value;
    const balance = document.getElementById('new-modem-balance').value;
    
    try {
        const res = await fetch('/api/modems/update-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: currentModemKey, operator, port, pin, balance, preferredBalance })
        });
        if (res.ok) {
            closeBalanceModal();
            fetchStats();
        }
    } catch (e) { alert('Erreur lors de la mise à jour'); }
}

async function fetchClients() {
    try {
        const res = await fetch('/api/clients');
        const clients = await res.json();
        
        const list = document.getElementById('clients-list');
        list.innerHTML = clients.map(c => `
            <tr>
                <td><b>${c.name}</b></td>
                <td><code>${c.id}</code></td>
                <td>${c.balance} DA</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="openEditModal(${c.id}, ${c.balance})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Error fetching clients:', err);
    }
}

// --- Client Management ---
function openEditModal(id, currentBalance) {
    currentClientId = id;
    document.getElementById('new-balance').value = currentBalance;
    document.getElementById('client-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('client-modal').style.display = 'none';
}

async function saveClientBalance() {
    const newBalance = document.getElementById('new-balance').value;
    try {
        const res = await fetch('/api/clients/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentClientId, balance: parseInt(newBalance) })
        });
        if (res.ok) {
            closeModal();
            fetchClients();
            fetchStats();
        }
    } catch (err) {
        alert('Error saving balance');
    }
}

// --- Modem Actions ---
async function restartModem(key, btn) {
    if (!btn) btn = event.currentTarget;
    if (!confirm('Redémarrer ce modem ?')) return;
    try {
        await fetch('/api/modems/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, command: 'AT+CFUN=1,1' })
        });
        alert('Commande de redémarrage envoyée.');
    } catch (e) { alert('Erreur'); }
}

// --- Product & Card Management ---
async function fetchProducts() {
    try {
        const res = await fetch('/api/products');
        const products = await res.json();
        
        const list = document.getElementById('products-list');
        list.innerHTML = products.map(p => `
            <tr>
                <td>
                    <b>${p.name}</b><br>
                    <small style="color: var(--text-secondary)">${p.type}</small>
                </td>
                <td><span class="badge ${p.stock > 0 ? 'green' : 'red'}">${p.stock} units</span></td>
                <td><input type="number" value="${p.purchasePrice || 0}" id="purch-${p.id}" class="inline-input"> DA</td>
                <td><input type="number" value="${p.price}" id="price-${p.id}" class="inline-input"> DA</td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn btn-outline btn-sm" onclick="updateProduct('${p.id}')" title="Save">
                            <i class="fas fa-save"></i>
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="deleteProduct('${p.id}')" title="Delete" style="color: var(--accent-danger)">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Update upload dropdown
        const dropdown = document.getElementById('upload-product-id');
        const currentVal = dropdown.value;
        dropdown.innerHTML = '<option value="">Select Product...</option>' + 
            products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        dropdown.value = currentVal;

        const totalStock = products.reduce((acc, p) => acc + p.stock, 0);
        document.getElementById('total-stock').innerText = totalStock;

    } catch (err) { console.error('Error fetching products:', err); }
}

function openProductModal() {
    document.getElementById('prod-name').value = '';
    document.getElementById('prod-type').value = '';
    document.getElementById('prod-purchase').value = '';
    document.getElementById('prod-selling').value = '';
    document.getElementById('product-modal').style.display = 'flex';
}

function closeProductModal() {
    document.getElementById('product-modal').style.display = 'none';
}

async function saveProduct() {
    const name = document.getElementById('prod-name').value;
    const type = document.getElementById('prod-type').value;
    const purchasePrice = document.getElementById('prod-purchase').value;
    const sellingPrice = document.getElementById('prod-selling').value;

    if (!name) return alert('Nom requis');

    try {
        const res = await fetch('/api/products/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, type, purchasePrice, sellingPrice })
        });
        if (res.ok) {
            closeProductModal();
            fetchProducts();
        }
    } catch (e) { alert('Erreur'); }
}

async function updateProduct(id) {
    const price = document.getElementById(`price-${id}`).value;
    const purchasePrice = document.getElementById(`purch-${id}`).value;
    try {
        const res = await fetch('/api/products/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, price, purchasePrice })
        });
        if (res.ok) fetchProducts();
    } catch (err) { alert('Error updating product'); }
}

async function deleteProduct(id) {
    if (!confirm('Supprimer ce produit ?')) return;
    try {
        const res = await fetch('/api/products/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (res.ok) fetchProducts();
    } catch (e) { alert('Erreur'); }
}

async function uploadCards() {
    const productId = document.getElementById('upload-product-id').value;
    const rawData = document.getElementById('upload-raw-data').value;

    if (!productId || !rawData.trim()) {
        alert('Please select a product and paste some codes.');
        return;
    }

    try {
        const res = await fetch('/api/cards/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId, rawData })
        });
        if (res.ok) {
            const data = await res.json();
            alert(`Successfully uploaded ${data.count} cards!`);
            document.getElementById('upload-raw-data').value = '';
            fetchProducts();
        }
    } catch (err) {
        alert('Error uploading cards');
    }
}

// --- Intervals ---
setInterval(fetchStats, 3000);
setInterval(fetchClients, 5000);
setInterval(fetchProducts, 5000);

// --- Terminal Logging ---
function logToTerminal(key, message) {
    const termId = `terminal-${key.replace(/[^a-z0-9]/gi, '')}`;
    const term = document.getElementById(termId);
    if (term) {
        const time = new Date().toLocaleTimeString();
        term.innerHTML += `\n[${time}] ${message}`;
        term.scrollTop = term.scrollHeight;
    }
}

async function startModem(key) {
    if (!confirm('هل تريد الاتصال بالشبكة (Start Modem)؟')) return;
    try {
        await fetch('/api/modems/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        alert('تم إرسال أمر التشغيل/الاتصال.');
    } catch (e) { alert('خطأ في إرسال الأمر'); }
}

async function stopModem(key) {
    logToTerminal(key, ':STOPPING SYSTEM...');
    try {
        await fetch('/api/modems/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, command: 'AT+CFUN=0' })
        });
        setTimeout(() => logToTerminal(key, ':SYSTEM STOPPED'), 1000);
    } catch (e) { logToTerminal(key, ':ERROR STOPPING'); }
}
function handleFileSelect(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('upload-raw-data').value = e.target.result;
    };
    reader.readAsText(file);
}

// --- Modem Operations consolidated at the top ---

async function deleteModem(key) {
    if (!confirm(`Supprimer le modem ${key} ?`)) return;
    try {
        await fetch('/api/modems/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        fetchStats();
    } catch (e) { alert('Erreur'); }
}

// --- Idoom Live Monitor ---
function pollIdoomLive() {
    const img = document.getElementById('idoom-live-img');
    const placeholder = document.getElementById('idoom-live-placeholder');
    const statusLabel = document.getElementById('idoom-status-label');
    
    if (!img) return;

    // Cache-busting URL
    const timestamp = new Date().getTime();
    const newSrc = `/data/idoom_live.png?t=${timestamp}`;
    
    // Check if image exists before showing
    const temp = new Image();
    temp.onload = () => {
        img.src = newSrc;
        img.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        if (statusLabel) {
            statusLabel.innerText = 'Active';
            statusLabel.style.background = '#059669'; // Green
        }
    };
    temp.onerror = () => {
        // If image doesn't exist, it means no active operation or cleaned up
        if (placeholder && placeholder.style.display === 'none') {
            img.style.display = 'none';
            placeholder.style.display = 'block';
            if (statusLabel) {
                statusLabel.innerText = 'Idle';
                statusLabel.style.background = '#1e293b';
            }
        }
    };
    temp.src = newSrc;
}

// Initial Load
fetchStats();
fetchClients();
fetchProducts();
setupModemListeners();
setInterval(pollIdoomLive, 2000); // Poll every 2 seconds
async function diagnoseModem(key) {
    const modal = document.getElementById('diagnose-modal');
    const body = document.getElementById('diagnose-body');
    if (!modal || !body) return;

    modal.style.display = 'flex';
    body.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #6366f1;"></i>
            <p style="margin-top: 15px;">Fletching deep diagnostics for ${key}...</p>
        </div>
    `;

    try {
        const res = await fetch('/api/modems/diagnose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await res.json();

        if (data.success) {
            const info = data.info;
            body.innerHTML = `
                <div class="diag-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div style="background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                        <small style="color: #94a3b8; display: block; margin-bottom: 5px;">Model</small>
                        <b style="color: #6366f1;">${info.model || 'Unknown'}</b>
                    </div>
                    <div style="background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                        <small style="color: #94a3b8; display: block; margin-bottom: 5px;">Operator</small>
                        <b>${info.operator || 'Unknown'}</b>
                    </div>
                    <div style="background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                        <small style="color: #94a3b8; display: block; margin-bottom: 5px;">MSISDN (SIM Number)</small>
                        <code>${info.msisdn || 'Not Set'}</code>
                    </div>
                    <div style="background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                        <small style="color: #94a3b8; display: block; margin-bottom: 5px;">ICCID</small>
                        <code style="font-size: 0.8rem;">${info.iccid || 'Unknown'}</code>
                    </div>
                    <div style="background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155; grid-column: span 2;">
                        <small style="color: #94a3b8; display: block; margin-bottom: 5px;">Force Network Mode</small>
                        <select onchange="setNetworkMode('${key}', this.value)" style="width: 100%; background: #1e293b; color: white; border: 1px solid #334155; padding: 8px; border-radius: 8px;">
                            <option value="00" ${info.mode === '00' ? 'selected' : ''}>Auto (Recommended)</option>
                            <option value="01" ${info.mode === '01' ? 'selected' : ''}>2G Only</option>
                            <option value="02" ${info.mode === '02' ? 'selected' : ''}>3G Only</option>
                            <option value="03" ${info.mode === '03' ? 'selected' : ''}>4G Only</option>
                        </select>
                    </div>
                </div>
                <div style="background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                    <h4 style="margin-bottom: 10px; color: #94a3b8; font-size: 0.8rem;">RAW API RESPONSES</h4>
                    <pre style="font-size: 0.7rem; color: #4ade80; overflow-x: auto; max-height: 200px;">${JSON.stringify(data.raw, null, 2)}</pre>
                </div>
                <button onclick="restartModem('${key}')" class="btn btn-primary" style="width: 100%; margin-top: 20px; background: #ef4444; border-color: #ef4444;">
                    <i class="fas fa-power-off"></i> Force Reboot
                </button>
            `;
        } else {
            body.innerHTML = `<div style="color: #ef4444; padding: 20px; text-align: center;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>Error: ${data.error || 'Failed to fetch diagnostics'}</p>
            </div>`;
        }
    } catch (e) {
        body.innerHTML = `<p style="color: #ef4444;">Connection error: ${e.message}</p>`;
    }
}

function closeDiagnoseModal() {
    document.getElementById('diagnose-modal').style.display = 'none';
}

function getSignalBars(percentage) {
    const bars = 5;
    const active = Math.ceil((percentage / 100) * bars);
    let html = '<div style="display: flex; align-items: flex-end; gap: 2px; height: 15px;">';
    for (let i = 1; i <= bars; i++) {
        const height = (i / bars) * 100;
        const color = i <= active ? (active <= 1 ? '#ef4444' : active <= 3 ? '#f59e0b' : '#10b981') : '#334155';
        html += `<div style="width: 3px; height: ${height}%; background: ${color}; border-radius: 1px;"></div>`;
    }
    html += '</div>';
    return html;
}

async function setNetworkMode(key, mode) {
    try {
        const res = await fetch('/api/modems/set-network-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, mode })
        });
        if (res.ok) alert('Network mode updated!');
        else alert('Failed to update network mode.');
    } catch (e) { alert('Error: ' + e.message); }
}
