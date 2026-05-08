const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 700,
    title: "FLEXY PRO MAX",
    autoHideMenuBar: true,
    backgroundColor: '#030712',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Check if server is ready, then load
  const loadPage = () => {
    mainWindow.loadURL('http://localhost:8090/').catch(() => {
      console.log('Server not ready, retrying...');
      setTimeout(loadPage, 1000);
    });
  };

  loadPage();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  // Start the background server
  serverProcess = fork(path.join(__dirname, 'server.js'), [], {
    silent: false // Keep logs visible in terminal
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
