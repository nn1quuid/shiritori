function getUnix() {
    const timeStamp = Math.round((new Date()).getTime() / 1000);
    const hexUnix = timeStamp.toString(16);
    return {
        timestamp: timeStamp,
        hex: hexUnix
    }
}
exports.getUnix = getUnix;

function hexToDec(hex) {
    return parseInt(hex, 16);
}
exports.hexToDec = hexToDec;

function toHex(dec) {
    if (!Number.isInteger(dec)) {
        return null
    }
    return Number(dec).toString(16);
}
exports.toHex = toHex;

function isValidUnix(serverUnix, playerUnix) {
    let result = hexToDec(playerUnix) - hexToDec(serverUnix);
    // 0未満ならサーバー起動以前のunix
    return result >= 0;
}
exports.isValidUnix = isValidUnix;

function pidSplit(pid) {
    // pid: 0u3t[0x]
    const playerIndex = Number(pid.split("u")[0]);
    const playerNameLen = Number(pid.split("t")[0].split("u")[1]);
    const playerUnixHex = pid.split("t")[1];
    return {
        pIndex: playerIndex,
        pNameLen: playerNameLen,
        pUnixHex: playerUnixHex
    }
}
exports.pidSplit = pidSplit;

/**
 * A random number, includes a and b
 * @param {Number} a 
 * @param {Number} b 
 */
function randint(a, b) {
    let min = Math.min(a, b);
    let max = Math.max(a, b);
    let r = Math.floor(Math.random() * (max - min + 1) + min);
    return r;
}
exports.randint = randint;


function unixToJSTstr(timestamp) {
    const date = new Date((timestamp + 9 * 60 * 60) * 1000);

    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const HH = String(date.getUTCHours()).padStart(2, '0');
    const MM = String(date.getUTCMinutes()).padStart(2, '0');

    return `${yyyy}/${mm}/${dd} ${HH}:${MM}`;
}
exports.unixToJSTstr=unixToJSTstr;

/**
 * 
 * @param {Array} array 
 */
function choice(array) {
    let len = array.length;
    let r = Math.floor(Math.random() * len);
    return array[r]
}
exports.choice=choice;

/**
 * 
 * @param {Array} array 
 */
function mode(array){
    const counts=new Map();
    for (const item of array){
        counts.set(item, (counts.get(item) ?? 0) + 1);
    }

    let modes=[];
    let tempMax=0;
    for (const [value, count] of counts){
        if(tempMax < count){
            modes=[value];
            tempMax=count;
        } else if(tempMax==count){
            modes.push(value);
        }
    }
    return {modes, count: tempMax}
}
exports.mode=mode;