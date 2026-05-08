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

// --- FILES ---
const CLIENTS_FILE = 'data/clients.json';
const PRODUCTS_FILE = 'data/products.json';
const CARDS_FILE = 'data/cards.json';
const SETTINGS_FILE = 'data/settings.json';
const AUTO_REPLY_FILE = 'data/auto_reply.json';
const SALES_FILE = 'data/sales.json';
const FILES = {
    mobilis: 'data/mobilis.json',
    ooredoo: 'data/ooredoo.json',
    djezzy: 'data/djezzy.json',
    sama: 'data/sama.json'
};

if (!fs.existsSync('data')) fs.mkdirSync('data');
Object.values(FILES).forEach(f => { if (!fs.existsSync(f)) fs.writeFileSync(f, '[]'); });
if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, '[]');
if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, '[]');
if (!fs.existsSync(CARDS_FILE)) fs.writeFileSync(CARDS_FILE, '[]');
if (!fs.existsSync(SALES_FILE)) fs.writeFileSync(SALES_FILE, '[]');

let settings = { tgToken: '', tgChatId: '' };
if (fs.existsSync(SETTINGS_FILE)) {
    try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) {}
}

// --- CUSTOMER MANAGEMENT API ---
app.get('/api/customer/balance', (req, res) => {
    try {
        const clientId = req.query.id || 'default';
        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8') || '[]');
        const client = clients.find(c => c.id.toString() === clientId.toString());
        
        if (!client) {
            return res.status(404).json({ error: 'عميل غير موجود' });
        }
        
        res.json({ 
            id: client.id,
            name: client.name,
            balance: client.balance || 0 
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// جلب قائمة الزبائن
app.get('/api/customers', (req, res) => {
    try {
        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8') || '[]');
        res.json(clients);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// إضافة زبون جديد
app.post('/api/customers/add', (req, res) => {
    try {
        const { name, phone, email, initialBalance } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ error: 'الاسم والهاتف مطلوبان' });
        }

        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8') || '[]');
        const newClient = {
            id: Date.now(),
            name,
            phone,
            email,
            balance: parseFloat(initialBalance) || 0,
            createdAt: new Date().toISOString()
        };

        clients.push(newClient);
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
        
        res.json({ success: true, client: newClient });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// تحديث بيانات الزبون
app.post('/api/customers/update', (req, res) => {
    try {
        const { id, name, phone, email, balance } = req.body;
        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8') || '[]');
        
        const client = clients.find(c => c.id.toString() === id.toString());
        if (!client) {
            return res.status(404).json({ error: 'الزبون غير موجود' });
        }

        if (name) client.name = name;
        if (phone) client.phone = phone;
        if (email) client.email = email;
        if (balance !== undefined) client.balance = parseFloat(balance);

        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
        res.json({ success: true, client });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// حذف زبون
app.post('/api/customers/delete', (req, res) => {
    try {
        const { id } = req.body;
        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8') || '[]');
        
        const filtered = clients.filter(c => c.id.toString() !== id.toString());
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(filtered, null, 2));
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// إرسال رصيد إلى زبون
app.post('/api/customers/transfer-credit', (req, res) => {
    try {
        const { fromId, toId, amount, reason } = req.body;
        
        if (!fromId || !toId || !amount) {
            return res.status(400).json({ error: 'البيانات المطلوبة ناقصة' });
        }

        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8') || '[]');
        const sender = clients.find(c => c.id.toString() === fromId.toString());
        const receiver = clients.find(c => c.id.toString() === toId.toString());

        if (!sender || !receiver) {
            return res.status(404).json({ error: 'الزبون غير موجود' });
        }

        const transferAmount = parseFloat(amount);
        if (sender.balance < transferAmount) {
            return res.status(400).json({ error: 'رصيد غير كافي' });
        }

        sender.balance -= transferAmount;
        receiver.balance += transferAmount;

        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

        // تسجيل التحويل
        const sales = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8') || '[]');
        sales.push({
            date: new Date().toISOString(),
            type: 'transfer',
            from: fromId,
            to: toId,
            amount: transferAmount,
            reason
        });
        fs.writeFileSync(SALES_FILE, JSON.stringify(sales, null, 2));

        res.json({ success: true, sender, receiver });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// شراء قسيمة
app.post('/api/cards/buy', (req, res) => {
    try {
        const { productId, customerId } = req.body;
        
        const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8') || '[]');
        const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8') || '[]');
        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8') || '[]');

        const product = products.find(p => p.id === productId);
        const cardIndex = cards.findIndex(c => c.productId === productId && !c.used);
        const client = clients.find(c => c.id.toString() === customerId.toString());

        if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });
        if (cardIndex === -1) return res.status(404).json({ error: 'القسيمة غير متوفرة' });
        if (!client) return res.status(404).json({ error: 'العميل غير موجود' });

        if (client.balance < product.price) {
            return res.status(400).json({ error: 'رصيد غير كافي' });
        }

        const card = cards[cardIndex];
        card.used = true;
        card.usedBy = customerId;
        card.usedAt = new Date().toISOString();

        client.balance -= product.price;

        fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
        fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

        res.json({ 
            success: true, 
            code: card.pin,
            product: product.name,
            price: product.price
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// جلب المنتجات
app.get('/api/customer/products', (req, res) => {
    try {
        const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8') || '[]');
        const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8') || '[]');
        
        const result = products.map(p => {
            const stock = cards.filter(c => c.productId === p.id && !c.used).length;
            return { id: p.id, name: p.name, price: p.price, stock };
        });
        
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========== ROUTER PAGES ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'customer-portal.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ========== MODEMS & STATS ==========
let activeModems = {};
let transactions = [];

function addLog(type, target, amount, success) {
    transactions.push({ time: new Date().toISOString(), type, target, amount, success });
    if (transactions.length > 50) transactions.shift();
}

app.get('/api/stats', (req, res) => {
    const modems = Object.values(activeModems).map(m => m.data || {});
    const onlineCount = modems.filter(m => m.online).length;
    const totalBalance = modems.reduce((acc, m) => acc + parseFloat(m.balance || 0), 0).toFixed(2);
    res.json({ modems, onlineCount, totalBalance, transactions });
});

// ========== TELEGRAM ==========
function sendTelegram(msg, targetId = null) {
    const token = settings.tgToken;
    const chatId = targetId || settings.tgChatId;
    if (!token || !chatId) return;
    
    const data = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' });
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        method: 'POST',
        path: `/bot${token}/sendMessage`,
        headers: { 
            'Content-Type': 'application/json', 
            'Content-Length': Buffer.byteLength(data)
        }
    };
    
    https.request(options, (res) => {
        res.on('data', () => {});
    }).on('error', () => {}).write(data).end();
}

// ========== SETTINGS ==========
app.get('/api/settings', (req, res) => res.json(settings));
app.post('/api/settings', (req, res) => {
    settings = { ...settings, ...req.body };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    res.json({ success: true });
});

// ========== BOOT ==========
const PORT = process.env.PORT || 8090;
app.listen(PORT, () => {
    console.log(`\n✅ FLEXY SERVER مع إدارة الزبائن`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`👤 بوابة الزبائن: http://localhost:${PORT}/customer-portal.html`);
    console.log(`⚙️ لوحة التحكم: http://localhost:${PORT}/admin`);
});
