const windowStateManager = require('electron-window-state');
const contextMenu = require('electron-context-menu');
const {app, BrowserWindow, ipcMain, ipcRenderer} = require('electron');
const serve = require('electron-serve');
const path = require('path');
const {join} = require('path')
const {JSONFile, Low} = require("@commonify/lowdb");
const fs = require('fs')
const WB = require("kryptokrona-wallet-backend-js");
const {default: fetch} = require("electron-fetch");
const nacl = require('tweetnacl')
const naclUtil = require('tweetnacl-util')
const naclSealed = require('tweetnacl-sealed-box')
const {extraDataToMessage} = require('hugin-crypto')
const { startCall, answerCall, endCall, parseCall  } = import('./lib/utils/hugin-calls.js');

const { Address,
        AddressPrefix,
        Block,
        BlockTemplate,
        Crypto,
        CryptoNote,
        LevinPacket,
        Transaction} = require('kryptokrona-utils')


const xkrUtils = new CryptoNote()
const hexToUint = hexString => new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

function getXKRKeypair() {
  const [privateSpendKey, privateViewKey] = js_wallet.getPrimaryAddressPrivateKeys();
  return {privateSpendKey: privateSpendKey, privateViewKey: privateViewKey};
}

function getKeyPair() {
    // return new Promise((resolve) => setTimeout(resolve, ms));
    const [privateSpendKey, privateViewKey] = js_wallet.getPrimaryAddressPrivateKeys();
    let secretKey = naclUtil.decodeUTF8(privateSpendKey.substring(1, 33));
    let keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
    return keyPair;
}

function getMsgKey() {

    const naclPubKey = getKeyPair().publicKey
    return  Buffer.from(naclPubKey).toString('hex');
}

function toHex(str,hex){
    try{
        hex = unescape(encodeURIComponent(str))
            .split('').map(function(v){
                return v.charCodeAt(0).toString(16)
            }).join('')
    }
    catch(e){
        hex = str
        //console.log('invalid text input: ' + str)
    }
    return hex
}



function nonceFromTimestamp(tmstmp) {

    let nonce = hexToUint(String(tmstmp));

    while ( nonce.length < nacl.box.nonceLength ) {

        let tmp_nonce = Array.from(nonce);

        tmp_nonce.push(0);

        nonce = Uint8Array.from(tmp_nonce);

    }

    return nonce;
}


function fromHex(hex, str) {
    try {
        str = decodeURIComponent(hex.replace(/(..)/g, '%$1'))
    } catch (e) {
        str = hex
        // console.log('invalid hex input: ' + hex)
    }
    return str
}


function trimExtra(extra) {

    try {
        let payload = fromHex(extra.substring(66));

        let payload_json = JSON.parse(payload);
        return fromHex(extra.substring(66))
    } catch (e) {
        return fromHex(Buffer.from(extra.substring(78)).toString())
    }
}

try {
    require('electron-reloader')(module);
} catch (e) {
    console.error(e);
}

const serveURL = serve({directory: "."});
const port = process.env.PORT || 3000;
const dev = !app.isPackaged;
let mainWindow;

function createWindow() {
    let windowState = windowStateManager({
        defaultWidth: 1100,
        defaultHeight: 700,
    });

    const mainWindow = new BrowserWindow({
        backgroundColor: '#202020',
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        trafficLightPosition: {
            x: 17,
            y: 12,
        },
        minHeight: 600,
        minWidth: 800,
        webPreferences: {
            enableRemoteModule: true,
            contextIsolation: true,
            nodeIntegration: true,
            spellcheck: false,
            devTools: dev,
            preload: path.join(__dirname, "preload.cjs")
        },
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
    });

    windowState.manage(mainWindow);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    mainWindow.on('close', () => {
        windowState.saveState(mainWindow);
    });

    return mainWindow;
}

contextMenu({
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    showCopyImage: false,
    prepend: (defaultActions, params, browserWindow) => [
        {
            label: 'Make App 💻',
        },
    ],
});

function loadVite(port) {
    mainWindow.loadURL(`http://localhost:${port}`).catch((e) => {
        console.log('Error loading URL, retrying', e);
        setTimeout(() => {
            loadVite(port);
        }, 200);
    });
}

function createMainWindow() {
    mainWindow = createWindow();
    mainWindow.once('close', () => {
        mainWindow = null
    });

    if (dev) loadVite(port);
    else serveURL(mainWindow);
}


app.on('ready', createMainWindow)
app.on('activate', () => {
    if (!mainWindow) {
        createMainWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});



function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let userDataDir = app.getPath('userData');

let node = 'blocksum.org'
let ports = 11898
const daemon = new WB.Daemon(node, ports);

//Create misc.db
const file = join(userDataDir, 'misc.db')
const adapter = new JSONFile(file)
const db = new Low(adapter)

//Create boards.db
const fileBoards = join(userDataDir, 'boards.db')
const adapterBoards = new JSONFile(fileBoards)
const dbBoards = new Low(adapterBoards)

//Create messages.db
const fileMessages = join(userDataDir, 'messages.db')
const adapterMessages= new JSONFile(fileMessages)
const dbMessages = new Low(adapterMessages)

let js_wallet;
let c = false;

if (fs.existsSync(userDataDir + '/mywallet.wallet')) {
    // We have found a wallet file
    ipcMain.on('app', (data) => {
        mainWindow.webContents.send('getPath', userDataDir)
        return mainWindow.webContents.send('wallet-exist', true);
    })
    c = 'o';
    start_js_wallet();
    console.log(c)
} else {

    console.log('wallet not found')
    c = 'c';
}

let syncing = true;

let myPassword;

ipcMain.on('create-account', async (event, password) => {
    myPassword = password
    const newWallet = await WB.WalletBackend.createWallet(daemon);
    newWallet.saveWalletToFile(userDataDir + '/mywallet.wallet', myPassword)
    js_wallet = newWallet
    console.log(password)
    await start_js_wallet();
})

async function start_js_wallet() {
    /* Initialise our blockchain cache api. Can use a public node or local node
       with `const daemon = new WB.Daemon('127.0.0.1', 11898);` */

    if (c === 'c') {

        let height = 23000;

        try {
            let re = await fetch('http://' + node + ':' + ports + '/getinfo');

            height = await re.json();

        } catch (err) {

        }

    } else if (c === 'o') {
        /* Open wallet, giving our wallet path and password */
        const [openedWallet, error] = await WB.WalletBackend.openWalletFromFile(daemon, userDataDir + '/mywallet.wallet', 'aaa');
        if (error) {
            console.log('Failed to open wallet: ' + error.toString());
            return;
        }

        js_wallet = openedWallet;

    } else {
        console.log('Bad input');
        return;
    }


    js_wallet.enableAutoOptimization(false);

    /* Enable debug logging to the console */


    /* Start wallet sync process */
    await js_wallet.start();


    js_wallet.on('incomingtx', (transaction) => {

        console.log(`Incoming transaction of ${transaction.totalAmount()} received!`);

        // if (!syncing) {
        mainWindow.webContents.send('new-message', transaction.toJSON());
        // }

    });

    let i = 1;

    for (const address of js_wallet.getAddresses()) {
        console.log(`Address [${i}]: ${address}`);
        let msgKey = getMsgKey()
        console.log('HuginAddress',address + msgKey)
        i++;
    }

    i = 1;

    let boards_addresses = [];

    for (const address of js_wallet.getAddresses()) {
        const [publicSpendKey, privateSpendKey, err] = await js_wallet.getSpendKeys(address);
        boards_addresses[boards_addresses.length] = [address, publicSpendKey];
        console.log(`Address [${i}]: ${address}`);
        i++;
    }

    console.log('Started wallet');

    while (true) {
        await sleep(1000 * 20);
        await backgroundSyncMessages()
        /* Save the wallet to disk */
        js_wallet.saveWalletToFile(userDataDir + '/boards.wallet', 'aaa');
        const [walletBlockCount, localDaemonBlockCount, networkBlockCount] =
            await js_wallet.getSyncStatus();
        if ((localDaemonBlockCount - walletBlockCount) < 2) {
            // Diff between wallet height and node height is 1 or 0, we are synced
            mainWindow.webContents.send('sync', 'synced');
            console.log('walletBlockCount', walletBlockCount);
            console.log('localDaemonBlockCount', localDaemonBlockCount);
            console.log('networkBlockCount', networkBlockCount);
            syncing = false;
        } else {
            if ((localDaemonBlockCount - walletBlockCount) > 19000) {
                console.log('rewinding forward');
                js_wallet.rewind(networkBlockCount - 9000);
                await sleep(3000 * 10);
            }
        }
        //Save height to misc.db
        db.data = {walletBlockCount, localDaemonBlockCount, networkBlockCount}
        await db.write(db.data)
        console.log( await js_wallet.getBalance())

    }
    console.log('Save wallet to file');
}



let known_pool_txs = [];
let known_keys = ['641d345f2da0cc77bbc8a32d766cc57a53e2723da01c972b4930eccce1f4fb75', '55544c5abf01f4ea13b15223d24d68fc35d1a33b480ee24b4530cb3011227d56', 'c01f004798701d6ab148ed1bec614634c0560ae6b1cd90a253beb7971a94da0d'];
console.log('known_keys', known_keys)

async function backgroundSyncMessages() {

    console.log('Background syncing...');
    mainWindow.webContents.send('sync', 'syncing');
    let message_was_unknown;
    let dec_message;
    try {
        const resp = await fetch('http://' + 'blocksum.org:11898' + '/get_pool_changes_lite', {
            method: 'POST',
            body: JSON.stringify({
                knownTxsIds: known_pool_txs
            })
        })

        let json = await resp.json();

        dbBoards.data = dbBoards.data || {messages: []}
        dbMessages.data = dbMessages.data || {messages: []}

        json = JSON.stringify(json).replaceAll('.txPrefix', '').replaceAll('transactionPrefixInfo.txHash', 'transactionPrefixInfotxHash');

        json = JSON.parse(json);

        let transactions = json.addedTxs;
        let transaction;

        for (transaction in transactions) {

            try {
                console.log('tx', transactions[transaction].transactionPrefixInfo);
                let thisExtra = transactions[transaction].transactionPrefixInfo.extra;
                let thisHash = transactions[transaction].transactionPrefixInfotxHash;

                if (known_pool_txs.indexOf(thisHash) === -1) {
                    known_pool_txs.push(thisHash);
                    message_was_unknown = true;
                } else {
                    message_was_unknown = false;
                    console.log("This transaction is already known", thisHash);
                    continue;
                }

                let message = await extraDataToMessage(thisExtra, known_keys, getXKRKeypair());
                message.sent = false

                parseCall(message.msg, msg.from)

                console.log('Message?', message.msg)

                switch (message.type) {
                    case "sealedbox":
                        dbMessages.data.messages.push(message)
                        await dbMessages.write()
                        mainWindow.webContents.send('newMsg', dbMessages.data)
                        break;
                    case "box":
                        dbMessages.data.messages.push(message)
                        await dbMessages.write()
                        mainWindow.webContents.send('newMsg', dbMessages.data)
                        break;
                    default:
                        if (message) {
                            dbBoards.data.messages.push(message)
                            await dbBoards.write()
                        }
                        break;
                }
            } catch (err) {
                console.log(err)
            }
        }
    } catch (err) {
        console.log('Sync error')
    }
}

//SWITCH NODE
ipcMain.on('switchNode', async (e, node) => {
    console.log(`Switching node to ${node}`)
    const daemon = new WB.Daemon(node.split(':')[0], parseInt(node.split(':')[1]));
    await js_wallet.swapNode(daemon);
    db.write()
});



ipcMain.on('sendMsg', (e, msg, receiver) => {
    sendMessage(msg, receiver);
    console.log(msg, receiver)
}
)

async function sendMessage(message, receiver) {
    console.log('Want to send')
    let address = receiver.substring(0,99);
    let messageKey =  receiver.substring(99,163);
    let has_history = true;

    if (message.length == 0) {
        return;
    }


    let my_address = await js_wallet.getPrimaryAddress();

    let my_addresses = await js_wallet.getAddresses();

    try {

        let [munlockedBalance, mlockedBalance] = await js_wallet.getBalance();
        //console.log('bal', munlockedBalance, mlockedBalance);

        if (munlockedBalance < 11 && mlockedBalance > 0) {

            log
            return;

        }
    } catch (err) {
        return;
    }

    let timestamp = Date.now();


    // **TO DO** Check whether this is the first outgoing transaction to the recipient
    // CHECK IN SVELT FROM ACTIVE CONTACT???


    // History has been asserted, continue sending message

    let box;

    if (!has_history) {
        //console.log('No history found..');
        // payload_box = {"box":Buffer.from(box).toString('hex'), "t":timestamp};
        const addr = await Address.fromAddress(my_address);
        const [privateSpendKey, privateViewKey] = js_wallet.getPrimaryAddressPrivateKeys();
        let xkr_private_key = privateSpendKey;
        let signature = await xkrUtils.signMessage(message, xkr_private_key);
        let payload_json = {
            "from": my_address,
            "k": Buffer.from(getKeyPair().publicKey).toString('hex'),
            "msg": message,
            "s": signature
        };
        let payload_json_decoded = naclUtil.decodeUTF8(JSON.stringify(payload_json));
        box = new naclSealed.sealedbox(payload_json_decoded, nonceFromTimestamp(timestamp), hexToUint(messageKey));
    } else {
        //console.log('Has history, not using sealedbox');
        // Convert message data to json
        let payload_json = {"from": my_address, "msg": message};

        let payload_json_decoded = naclUtil.decodeUTF8(JSON.stringify(payload_json));


        box = nacl.box(payload_json_decoded, nonceFromTimestamp(timestamp), hexToUint(messageKey), getKeyPair().secretKey);

    }

    let payload_box = {"box": Buffer.from(box).toString('hex'), "t": timestamp};

    // let payload_box = {"box":Buffer.from(box).toString('hex'), "t":timestamp, "key":Buffer.from(getKeyPair().publicKey).toString('hex')};
    // Convert json to hex
    let payload_hex = toHex(JSON.stringify(payload_box));

    let result = await js_wallet.sendTransactionAdvanced(
        [[address, 1]], // destinations,
        3, // mixin
        {fixedFee: 3000, isFixedFee: true}, // fee
        undefined, //paymentID
        undefined, // subWalletsToTakeFrom
        undefined, // changeAddress
        true, // relayToNetwork
        false, // sneedAll
        Buffer.from(payload_hex, 'hex')
    );

    if (result.success) {
        console.log(`Sent transaction, hash ${result.transactionHash}, fee ${WB.prettyPrintAmount(result.fee)}`);
        const sentMsg = {msg: message, k: messageKey, from: address, sent: true, t: timestamp}
        dbMessages.data.messages.push(sentMsg)
        await dbMessages.write()
        mainWindow.webContents.send('newMsg', dbMessages.data)
        known_pool_txs.push(result.transactionHash)
    } else {
        console.log(`Failed to send transaction: ${result.error.toString()}`);
    }
}

ipcMain.handle('getMessages', async () => {
    await dbMessages.read()
    return dbMessages.data
})

ipcMain.handle('getBalance', async () => {
    return await js_wallet.getBalance()
})

ipcMain.handle('getAddress',  async () => {
    return js_wallet.getAddresses()

})



ipcMain.on('startCall', async (contact, callType) => {
    console.log('CALL STARTED')
    switch (callType) {

        case "audio":
            return await startCall(contact, true, false,)

    }
})


ipcMain.on('answerCall', async (contact, callType) => {
    console.log('CALL STARTED')
    switch (callType) {

        case "audio":
            return answerCall(contact, true, false,)

    }
})


ipcMain.on('endCall', async (peer, stream) => {
    console.log('CALL STARTED')

    return endCall(peer, stream)


})
