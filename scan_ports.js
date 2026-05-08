const { SerialPort } = require('serialport');
SerialPort.list().then(ports => {
    console.log('\n--- AVAILABLE PORTS ---');
    ports.forEach(p => console.log(`${p.path} - ${p.manufacturer || 'Unknown'}`));
    console.log('-----------------------\n');
}).catch(err => console.log(err));
