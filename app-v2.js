async function fetchData() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('total-balance').innerText = data.totalBalance + ' DA';
        document.getElementById('online-count').innerText = `${data.onlineCount}/${data.modems.length}`;
        document.getElementById('online-progress').value = (data.onlineCount / (data.modems.length || 1)) * 100;
        
        renderModems(data.modems);
    } catch (e) { console.error('Data Fetch Error:', e); }
}

function renderModems(modems) {
    const list = document.getElementById('modem-list');
    list.innerHTML = '';
    
    modems.forEach(m => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div style="font-weight: 600;">${m.ip}</div>
                <div style="font-size: 0.7rem; color: #94a3b8;">${m.id || '---'}</div>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="https://flagcdn.com/w20/dz.png" width="16">
                    <span>${m.operator}</span>
                </div>
            </td>
            <td>
                <span class="status-badge ${m.online ? 'status-online' : 'status-offline'}">
                    ${m.online ? (m.simStatus || 'READY') : 'OFFLINE'}
                </span>
            </td>
            <td><code style="color: #3b82f6;">${m.networkType || '---'}</code></td>
            <td>${getSignalBars(m.signal || 0)}</td>
            <td><span style="font-weight: 700; color: #10b981;">${m.balance || '0.00'}</span> DA</td>
            <td>
                <div style="display: flex; gap: 5px;">
                    <button class="btn-action" title="Check Balance" onclick="checkBalance('${m.key}', this)"><i class="fas fa-wallet"></i></button>
                    <button class="btn-action" title="Diagnostics" onclick="diagnose('${m.key}', this)"><i class="fas fa-stethoscope"></i></button>
                    <button class="btn-action" style="color: #ef4444;" title="Delete" onclick="deleteModem('${m.key}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        `;
        list.appendChild(row);
    });
}

function getSignalBars(percentage) {
    const active = Math.ceil((percentage / 100) * 5);
    let html = '<div class="signal-bars">';
    for (let i = 1; i <= 5; i++) {
        const h = (i / 5) * 100;
        const color = i <= active ? (active <= 1 ? '#ef4444' : active <= 3 ? '#f59e0b' : '#10b981') : '#334155';
        html += `<div class="bar" style="height: ${h}%; background: ${color};"></div>`;
    }
    html += '</div>';
    return html;
}

async function checkBalance(key, btn) {
    const icon = btn.querySelector('i');
    const oldClass = icon.className;
    icon.className = 'fas fa-spinner fa-spin';
    btn.disabled = true;

    try {
        await fetch('/api/modems/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        // Success feedback
        icon.className = 'fas fa-check';
        setTimeout(() => {
            icon.className = oldClass;
            btn.disabled = false;
            fetchData();
        }, 2000);
    } catch (e) {
        icon.className = 'fas fa-exclamation-triangle';
        setTimeout(() => { icon.className = oldClass; btn.disabled = false; }, 3000);
    }
}

async function diagnose(key, btn) {
    const icon = btn.querySelector('i');
    const oldClass = icon.className;
    icon.className = 'fas fa-spinner fa-spin';
    btn.disabled = true;

    try {
        const res = await fetch('/api/modems/diagnose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        icon.className = oldClass;
        btn.disabled = false;
        alert(JSON.stringify(data.info, null, 2));
    } catch (e) {
        icon.className = 'fas fa-exclamation-triangle';
        setTimeout(() => { icon.className = oldClass; btn.disabled = false; }, 3000);
    }
}

function openAddModal() { document.getElementById('add-modal').style.display = 'flex'; }
function closeModals() { document.getElementById('add-modal').style.display = 'none'; }

async function saveNewModem() {
    const ip = document.getElementById('new-ip').value;
    const operator = document.getElementById('new-operator').value;
    const password = document.getElementById('new-pw').value;
    
    await fetch('/api/modems/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, operator, password, type: 'hilink' })
    });
    closeModals();
    fetchData();
}

async function deleteModem(key) {
    if (confirm('Are you sure?')) {
        await fetch('/api/modems/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        fetchData();
    }
}

async function runScan() {
    const icon = document.getElementById('scan-icon');
    const input = document.getElementById('new-ip');
    icon.classList.add('fa-spin');
    input.value = 'Scanning...';
    
    try {
        const res = await fetch('/api/modems/scan');
        const data = await res.json();
        if (data.ports && data.ports.length > 0) {
            input.value = data.ports[0].path;
            alert(`Found: ${data.ports.map(p => p.info).join('\n')}`);
        } else {
            input.value = '';
            alert('No modems found. Please enter manually.');
        }
    } catch (e) { alert('Scan failed'); }
    finally { icon.classList.remove('fa-spin'); }
}

setInterval(fetchData, 5000);
fetchData();
