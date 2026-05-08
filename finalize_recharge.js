const fs = require('fs');
const path = require('path');

const CARDS_FILE = 'data/cards.json';
const PRODUCTS_FILE = 'data/products.json';
const CLIENTS_FILE = 'data/clients.json';

try {
    const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
    const cardIndex = cards.findIndex(c => c.pin === '1047248731199625');
    
    if (cardIndex !== -1) {
        const card = cards[cardIndex];
        cards[cardIndex].used = true;
        cards[cardIndex].usedBy = '6320785501';
        cards[cardIndex].usedAt = new Date().toISOString();
        fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
        console.log('✅ Card updated');

        const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
        const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
        const product = products.find(p => p.id === card.productId);
        const client = clients.find(c => c.id.toString() === '6320785501');

        if (client && product) {
            client.balance -= product.price;
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
            console.log('✅ Balance updated');
        }
    } else {
        console.log('❌ Card not found');
    }
} catch (e) {
    console.error('Error:', e.message);
}
