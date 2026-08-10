const express = require("express");
const { Server } = require("socket.io");
const fs = require("fs");

const utils = require("./utils");
const state = require("./state");

const app = express();
const router = express.Router();
const PORT = 10000;

const http = require("http");
const server = http.createServer(app);
const io = new Server(server, {
    pingInterval: 10000,
    pingTimeout: 5000
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

state.gameServerStartAt = utils.getUnix().hex;
console.log("This server is", state.gameServerStartAt);

function newToken(unique = "uq") {
    const token = String(utils.randint(0, 9999)) + unique + utils.getUnix().hex;
    state.tokens.set(token, utils.getUnix().timestamp);
    const delSec = 60;
    setTimeout(() => {
        state.tokens.delete(token);
        console.log("[Auto-deleted Token]", token);
    }, 1000 * delSec);
    console.log("[New Token]", token, `(${delSec}sec)`);
    return token;
}

// japanese init
const aks = [..."あかさたなはまやらわがざだばぱぁゃ"];
const iks = [..."いきしちにひみりぎじぢびぴぃ"];
const uks = [..."うくすつぬふむゆるぐずづぶぷぅっ"];
const eks = [..."えけせてねへめれげぜでべぺぇ"];
const oks = [..."おこそとのほもよろをごぞどぼぽぉょ"];

/**
 * Make a player id from username. Current time is seed.
 * @param {string} username 
 * @returns
 */
function makePlayerId(username) {
    const unixHex = utils.getUnix().hex;
    let usernameArray = [...username];
    const playersCount = state.playersMap.size;

    let pid = `${playersCount}u${usernameArray.length}t${unixHex}`
    console.log(`[New User] ${username} => ${pid}`);
    return pid;
}

// words
const FILE = "words.json";
const data = fs.readFileSync(FILE, "utf-8");
const wordsDict = JSON.parse(data);
const allWords = Object.values(wordsDict).flat();
let keys = Object.keys(wordsDict).flat();
console.log("現在の収録単語数:", allWords.length);
const activeWords = allWords.filter((w) => {
    return w.at(-1) != "ん";
});
console.log("利用可能な単語数:", activeWords.length);

class Room {
    createdAt = {
        timestamp: utils.getUnix().timestamp,
        str: ""
    };
    hostId;
    sockets = [];
    players = []; // instance
    turn = 0;
    turnIndex = 0;
    firstAtk = 0;
    constructor(id, name, maxSockets = 4) {
        this.id = id;
        this.name = name;
        this.createdAt.str = utils.unixToJSTstr(this.createdAt.timestamp);
        this.usedWords = ["しりとり"];
        this.maxSockets = Number(maxSockets);
    }
    ago(timestamp) {
        let now = utils.getUnix().timestamp;
        let dt = now - timestamp;
        let msg = `${dt} 秒前`;
        if (60 <= dt && dt < 3600) {
            let minutes = Math.floor(dt / 60);
            msg = `${minutes} 分前`;
        } else if (3600 <= dt) {
            let hours = Math.floor(dt / 3600);
            let minutes = Math.floor((dt - 3600 * hours) / 60);
            msg = `${hours} 時間 ${minutes} 分前`;
        }
        return msg;
    }
    roomInit() {
        this.usedWords = ["しりとり"];
        this.sockets = [];
        this.players = [];
        this.turn = 0;
        this.turnIndex = 0;
        this.firstAtk = 0;
        console.log("[Room Init]", this.id);
    }

    latestWord() {
        return this.usedWords.at(-1);
    }

    leave(socketId, player) {
        const ri = this.sockets.indexOf(socketId);
        if (ri >= 0) {
            this.sockets.splice(ri, 1);
        }

        const rpi = this.players.indexOf(player);
        if (rpi >= 0) {
            this.players.splice(rpi, 1);
            if (rpi < this.turnIndex) {
                this.turnIndex--;
            }
            if (this.turnIndex >= this.players.length) {
                this.turnIndex = 0;
            }
        }

        const ok = (ri >= 0 && rpi >= 0);
        return {
            ok
        }
    }

    getCurrentTurnPlayer() {
        const player = this.players[this.turnIndex];
        return player
    }

    /**
     * 
     * @param {string} pid 
     * @param {string} word 
     * @returns 
     */
    submit(pid, word) {
        console.log("Submit Start:", pid, word);
        const res = {
            ok: false,
            reason: undefined
        }
        if (!pid || !word) {
            return res;
        }
        const player = state.playersMap.get(pid);
        if (!player) {
            return res;
        }
        if (!this.players.includes(player)) {
            return res;
        }
        // if room includes player
        if (this.players.length == 1) {
            res.reason = "2人以上になるまでゲームを開始できません。";
            return res;
        }

        const currentTurnPlayer = this.getCurrentTurnPlayer();

        if (currentTurnPlayer != player) {
            res.reason = "あなたのターンではありません。"
            return res;
        }
        if (word.length == 0) {
            return res;
        }

        const normalized = wordNormalize(word);
        if (!/^[ぁ-んー]+$/g.test(normalized.converted)) {
            res.reason = "この単語は使用できません。"
            return res;
        }
        const lastWord = this.usedWords[this.usedWords.length - 1];
        const lastNormalized = wordNormalize(lastWord);

        if (lastNormalized.nextFirstChar != normalized.firstChar) {
            res.reason = "しりとりが成立していません。"
            return res;
        }
        res.ok = true;
        return res;
    }

    accept(pid, word) {
        const normalized = wordNormalize(word);
        this.usedWords.push(normalized.hiragana);
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        return normalized.hiragana;
    }
}

class Player {
    //pvp
    sockets = [];
    pvpWords = [];

    // cpu
    words = [];
    lastResWord = "";

    cpuUsedWordsDict = {};
    gameUsedWords = [];

    cpuLost = false;
    lost = false;
    turn = 1;

    themeColor = "#318bf2";

    constructor(playerId, displayName) {
        this.id = playerId;
        this.displayName = displayName
    }

    srtrInit() {
        this.words = [];
        this.lastResWord = "";

        this.cpuUsedWordsDict = {};
        this.gameUsedWords = [];

        keys.forEach((key) => {
            this.cpuUsedWordsDict[key] = [];
        })

        this.cpuLost = false;
        this.lost = false;
        this.turn = 1;
    }
}

// make a room
(function () {
    const roomname = "test room"
    const roomId = "0";
    const newRoom = new Room(roomId, roomname);
    newRoom.hostId = "65535u0t" + state.gameServerStartAt;
    state.roomsMap.set(roomId, newRoom);
    console.log("New Room:", roomId, roomname);
}())


/**
 * プレイヤーデータを取得する
 *
 * @param {string} pid
 * @returns {{
 *   isValid: boolean,
 *   player: Player | undefined,
 *   resId: number
 * }}
 */
function getPlayer(pid) {
    const invalid = (resId) => ({
        isValid: false,
        player: undefined,
        resId
    });

    if (typeof pid !== "string") {
        return invalid(4);
    }

    const { pUnixHex, pIndex, pNameLen } = utils.pidSplit(pid);

    if (!utils.isValidUnix(state.gameServerStartAt, pUnixHex)) {
        return invalid(1);
    }

    const player = [...state.playersMap.values()][pIndex];

    if (!player) {
        return invalid(2);
    }

    if (player.displayName.length !== pNameLen) {
        return invalid(3);
    }

    return {
        isValid: true,
        player,
        resId: 0
    };
}

/**
 * しりとり用に単語の処理をします
 * @param {string} inputWord
 */
function wordNormalize(inputWord) {
    let temp = [...inputWord];
    let hiraConv = "";
    let converted = "";
    temp.forEach(char => {
        let newChar = /[ァ-ヶ]/.test(char) ? String.fromCharCode(char.charCodeAt(0) - 0x60) : char; // カタカナをひらがなに変換
        converted += newChar;
        hiraConv += newChar;
    })
    let lastChar = converted.slice(-1);
    let firstChar = converted[0];
    const upperMap = new Map([
        ["ぁ", "あ"],
        ["ぃ", "い"],
        ["ぅ", "う"],
        ["ぇ", "え"],
        ["ぉ", "お"],
        ["っ", "つ"],
        ["ゃ", "や"],
        ["ゅ", "ゆ"],
        ["ょ", "よ"],
        ["ゎ", "わ"],
        ["ゕ", "か"],
        ["ゖ", "け"],
    ]);

    lastChar = upperMap.get(lastChar) == undefined ? lastChar : upperMap.get(lastChar);

    let nextSrtr;
    // nobasi conv
    if (lastChar == "ー") {
        let beforeLastChar = converted[converted.length - 2];
        if (aks.includes(beforeLastChar)) {
            nextSrtr = "あ";
        } else if (iks.includes(beforeLastChar)) {
            nextSrtr = "い";
        } else if (uks.includes(beforeLastChar)) {
            nextSrtr = "う";
        } else if (eks.includes(beforeLastChar)) {
            nextSrtr = "え";
        } else if (oks.includes(beforeLastChar)) {
            nextSrtr = "お";
        }
    } else {
        nextSrtr = lastChar;
    }
    // finally
    const result = {
        input: inputWord,
        converted: converted,
        hiragana: hiraConv,
        lastChar: lastChar,
        firstChar: firstChar,
        nextFirstChar: nextSrtr,
    }
    return result;
}

app.get("/dev", (req, res) => {
    const pid = req.query.pid ?? "0u0t00000000"
    const pidChk = getPlayer(pid);
    return res.send(JSON.stringify(pidChk));
})

app.get("/dict", (req, res) => {
    let min = 100;
    let max = 0;
    let total = 0;
    let count = keys.length;
    let tempArr = [];
    keys.forEach(k => {
        let temp = wordsDict[k].length;
        if (min > temp) {
            min = temp;
        }
        if (max < temp) {
            max = temp;
        }
        total += temp;
        tempArr.push(temp);
    })
    let avg = Math.round(total / count * 10) / 10;

    let tempArr2 = tempArr.toSorted((a, b) => a - b);
    let c = tempArr2[Math.round(count / 2)]

    console.log(min, max, total, count, avg, c);
    let content = "<html><body>"
    content += `${JSON.stringify(tempArr2)}<br>`
    content += `min: ${min}, max: ${max}, center: ${c}, avg: ${avg}, total: ${total} (keys: ${count})<br>`;
    content += "<a href='/dict?detail=true'>Detail</a>&emsp;<a href='/dict'>Default</a><hr>"
    keys.forEach(k => {
        let temp = `${k} から始まる単語数: ${wordsDict[k].length}`;
        temp += req.query?.detail ? ` ${JSON.stringify(wordsDict[k])}` : "";
        content += temp + "<hr>";
    })
    content += "</body></html>"
    return res.send(content);
})

app.get("/status", (req, res) => {
    let content = "<html><body><h1>Server [" + state.gameServerStartAt + "]</h1><hr>";
    content += `TOKEN:${JSON.stringify([...state.tokens.keys()])}<hr>ROOM:`;
    const roomsArray = [...state.roomsMap.values()]
    roomsArray.forEach(room => {
        content += `<small>${JSON.stringify(room)}</small><hr>PLAYER:`;
    })

    const playersArray = [...state.playersMap.values()]
    playersArray.forEach(player => {
        let pn = `<div>${player.displayName} (@${player.id})`
        let p = JSON.stringify(player);
        content += `${pn}<div><small>${p}</small></div></div><hr>`;
    })

    content += "<a href='/'>TOP</a>&emsp;<a href='/cpu'>CPU</a>&emsp;<a href='/dict'>Dict</a>"
    content += "</body></html>"
    return res.status(200).send(content)
})

app.get("/init", (req, res) => {
    const { pid } = req.query ?? {};
    if (!pid) {
        return res.redirect("/");
    }
    const pSplit = utils.pidSplit(pid);
    const playerIndex = pSplit.pIndex;
    const playerNameLen = pSplit.pNameLen;
    const playerUnixHex = pSplit.pUnixHex;


    const player = state.playersMap.get(pid);
    if (!player) {
        console.log(`${pid}: invalid`)
        return res.redirect("/")
    }
    player.srtrInit();
    return res.redirect(`/cpu?pid=${pid}`);
})

app.get("/start", (req, res) => {
    return res.redirect("cpu");
})

app.get("/cpu", (req, res) => {
    const { pid } = req.query ?? {};
    if (!pid) {
        return res.redirect("/");
    }

    const gameData = {
        word: "",
        turn: " - ",
        nav: "",
        navType: "error",
    }

    const pidChk = getPlayer(pid);
    if (!pidChk.isValid) {
        console.log(pidChk.resId);
        switch (pidChk.resId) {
            case 1:
                console.log(`${pid}: invalid`);
                gameData.nav = "サーバーが再起動しました。再度ログインしてください。";
                break;

            case 2:
                gameData.nav = "プレイヤーデータが見つかりませんでした。再度ログインしてください。";
                break;

            case 3:
                gameData.nav = "プレイヤーデータが一致しませんでした。再度ログインしてください。";
                break;

            default:
                gameData.nav = "エラーが発生しました。再度ログインしてください。";
        }
        return res.render("cpu", gameData);
    }
    const player = pidChk.player;
    gameData.nav = player.displayName + " さん、おかえりなさい";
    gameData.navType = "info";


    if (player.cpuLost || player.lost) {
        player.srtrInit();
        gameData.nav = "好きな単語から始めましょう"
        console.log(`${pid}: init`);
    }

    if (player.lastResWord == "") {
        gameData.nav = "好きな単語から始めましょう"
    }

    gameData.word = player.lastResWord;
    gameData.turn = player.turn;
    return res.render("cpu", gameData);
})
app.post("/cpu", (req, res) => {
    const gameData = {
        word: "",
        turn: " - ",
        nav: "",
        navType: "error",
    }
    const { playerId } = req.body ?? {};
    console.log("Player ID: ", playerId);
    if (!playerId) {
        gameData.nav = "ログイン情報が不正です。";
        return res.render("cpu", gameData);
    }

    const pidChk = getPlayer(playerId);
    if (!pidChk.isValid) {
        gameData.nav = "エラーが発生しました。再度ログインしてください。";
        return res.render("cpu", gameData);
    }
    const player = pidChk.player;

    if (player.cpuLost || player.lost) {
        player.srtrInit();
        console.log(`${playerId}: init`);
        return res.redirect("/cpu");
    }

    const lastResNorm = wordNormalize(player.lastResWord);
    let resWord;

    gameData.navType = "warn";
    gameData.word = player.lastResWord;
    gameData.turn = player.turn;

    let allUsedWords = Object.values(player.gameUsedWords).flat();

    const { word } = req.body ?? {};
    const userWord = word;
    if (userWord.length > 25) {
        gameData.nav = "最大文字数は25文字です。";
        return res.render("cpu", gameData);
    }
    if (userWord === undefined || userWord == "") {
        gameData.nav = "単語を送信してください。";
        return res.render("cpu", gameData);
    }

    let userNorm = wordNormalize(userWord);
    let wordStart = userNorm.firstChar;

    if (wordStart != lastResNorm.nextFirstChar && player.lastResWord != "") {
        gameData.nav = "しりとりが成立していません！"
        return res.render("cpu", gameData);
    }
    if (allUsedWords.includes(userWord)) {
        gameData.nav = "その単語は既に使われています。"
        return res.render("cpu", gameData);
    }
    //hiragana check
    if (!/^[ぁ-んー]+$/g.test(userNorm.converted)) {
        gameData.nav = "ひらがな で入力してください"
        return res.render("cpu", gameData);
    }
    // 成立 かつ 未使用
    // accept userWord
    player.words.push(userNorm.hiragana);
    player.gameUsedWords.push(userNorm.hiragana);

    if (userNorm.nextFirstChar == "ん") {
        player.lost = true;
        gameData.nav = `「ん」が付いてしまいました。${player.displayName} さんの負け……`;
        gameData.navType = "error";
        return res.render("cpu", gameData);
    }

    let wordEnd = userNorm.nextFirstChar;
    let wordsArray = wordsDict[wordEnd];

    try {
        let attempt = 0;
        // resWordが [undefined または ゲーム内で使われた単語]である限り
        while (resWord === undefined || player.gameUsedWords.includes(resWord)) {
            if (player.cpuUsedWordsDict[wordEnd].length == wordsArray.length) {
                console.log(JSON.stringify(player));
                // 返せる単語が存在しない場合
                player.cpuLost = true;
                const tempmsgs = [
                    "CPUは次の単語が浮かびませんでした。",
                    "CPUの辞書が限界に達しました。",
                    "CPUはもう単語を見つけることができません。",
                    "CPUは単語を使い切ってしまいました。",
                    "CPUに使用可能な単語が残っていません。"
                ]
                const tempmsg = utils.choice(tempmsgs);
                gameData.word = " - - - - ";
                gameData.nav = `${tempmsg} ${player.displayName} さんの勝ち！`;
                gameData.navType = "win";
                return res.render("cpu", gameData)

            } else {
                resWord = utils.choice(wordsArray);
                if (resWord.slice(-1) == "ん") {
                    if (attempt > 20) {
                        break
                    } else {
                        console.log(`${resWord}: ん を回避中…… (${attempt + 1}回目)`)
                        resWord = undefined;
                    }
                }
            }

            attempt++;
        }
    } catch (e) {
        console.log(e.name, e.message, "word:", userNorm.hiragana);
        player.words.pop();
        player.gameUsedWords.pop();
        gameData.nav = "エラーが発生しました。別の単語をお試しください。";
        return res.render("cpu", gameData);
    }
    player.gameUsedWords.push(resWord);
    player.cpuUsedWordsDict[wordEnd].push(resWord);
    let resNorm = wordNormalize(resWord);
    let resWordEnd = resNorm.nextFirstChar;
    if (resWordEnd == "ん") {
        player.cpuLost = true;
        gameData.nav = `CPUが「ん」で終わりました。${player.displayName} さんの勝ち！`;
        gameData.navType = "win";
    }
    player.turn++;
    gameData.turn = player.turn;

    gameData.word = resWord;
    player.lastResWord = resWord;

    if (/^[\s]*$/.test(resWord)) {
        gameData.navType = "error";
    }
    console.log(`Player: ${userWord} ---> CPU: ${resWord}`);
    return res.render("cpu", gameData);
})

app.post("/api/history", (req, res) => {
    const { pid, turn } = req.body ?? {};
    let resType = "error";
    if (!pid || !turn) {
        return res.status(400).json({ history: undefined, resType });
    }
    const pidChk = getPlayer(pid);
    if (!pidChk.isValid) {
        return res.status(400).json({ history: undefined, resType });
    }
    const player = pidChk.player;
    if (player.turn != turn) {
        return res.status(400).json({ history: undefined, resType });
    }
    resType = "ok";
    const history = player.gameUsedWords.join("<br>");
    return res.status(201).json({
        history,
        resType
    })
})

function publicPlayer(player) {
    if (!player) {
        return undefined
    }
    const pubPlayer = {
        id: player.id,
        displayName: player.displayName,
        themeColor: player.themeColor
    }
    return pubPlayer;
}
app.post("/api/pid", (req, res) => {
    const { pid } = req.body ?? {};
    const response = {
        ok: false,
        player: undefined
    }
    if (!pid || typeof pid !== "string") {
        return res.status(400).json(response);
    }
    const player = state.playersMap.get(pid);
    if (!player) {
        return res.status(400).json(response);
    }
    response.ok = true;
    response.player = publicPlayer(player);
    return res.json(response);
})

app.get("/new/room", (req, res) => {
    console.log("redirect");
    return res.redirect("/rooms");
})
app.post("/new/room", (req, res) => {
    let { roomname, maxSockets, pid, token } = req.body ?? {};
    if ([roomname, maxSockets, pid, token].some(v => typeof v !== "string")) {
        return res.render("rooms", {
            roomsArray: [...state.roomsMap.values()],
            token: newToken("srrm"),
            msg: "エラーが発生しました。再度お試しください。"
        })
    }
    if (!state.tokens.has(token)) {
        console.log("Invalid token: " + token);
        const reToken = newToken("srrm");
        const msg = "トークンの有効期限が切れました。再度お試しください。";
        const roomsArray = [...state.roomsMap.values()];
        return res.render("rooms", { roomsArray, token: reToken, msg });
    }
    state.tokens.delete(token);
    roomname=roomname.trim().slice(0, 16);
    if (roomname === "") {
        return res.render("rooms", {
            roomsArray: [...state.roomsMap.values()],
            token: newToken("srrm"),
            msg: "部屋名を入力してください。"
        })
    }
    const pidChk = getPlayer(pid);
    if (!pidChk.isValid) {
        return res.redirect("/");
    }
    if (!Number.isInteger(Number(maxSockets))){
        return res.render("rooms", {
            roomsArray: [...state.roomsMap.values()],
            token: newToken("srrm"),
            msg: "最大人数は整数で入力してください。"
        })
    }
    if (Number(maxSockets) > 10) {
        maxSockets = 10;
    } else if (Number(maxSockets) < 2) {
        maxSockets = 2;
    }
    const roomId = utils.getUnix().hex;
    const newRoom = new Room(roomId, roomname, maxSockets);
    newRoom.hostId = pid;
    state.roomsMap.set(roomId, newRoom);
    console.log("New Room:", roomId, roomname, maxSockets);
    return res.redirect(`/room/${roomId}`);
})
app.post("/new/user", (req, res) => {
    const { username } = req.body ?? {};
    const sendError = (msg) =>
        res.status(400).json({
            resType: "Error",
            errMsg: msg
        });

    if (typeof username !== "string") {
        return sendError("ユーザーネームを入力してください。");
    }

    if (username.length > 100) {
        return sendError("ユーザーネームが長すぎます。");
    }

    if (username.trim() === "") {
        return sendError("ユーザーネームを入力してください。");
    }

    if ([...username].length > 12) {
        return sendError("ユーザーネームは最大 12 文字です。");
    }

    if (/[\u202e]/.test(username)) {
        return sendError("使用できない文字が含まれています。");
    }

    const emptyReg = /^[\u0009-\u000d\u001c-\u0020\u034f\u1680\u180e\u2000-\u200f\u202f\u205f\u2060-\u2063\u3000\u3164\ufeff\u034f\u2028\u2029\u202a-\u202e\u2061-\u2063\ufeff]+$/;
    if (emptyReg.test(username)) {
        return sendError("名前を空白にすることはできません。");
    }

    try {
        const pid = makePlayerId(username);
        const newUser = new Player(pid, username);
        newUser.srtrInit();
        state.playersMap.set(newUser.id, newUser);
        const response = {
            resType: "OK",
            pid: pid,
            displayName: newUser.displayName
        }
        return res.status(201).json(response);
    } catch (error) {
        console.log(error);
        return sendError("エラーが発生しました。");
    }
});

app.post("/pidchk", (req, res) => {
    // 不使用
    const { playerId } = req.body ?? {};
    if (!playerId) {
        return res.status(400).json({
            resType: "Error",
            msg: "不正なID"
        })
    }

    try {
        utils.pidSplit(playerId);
    } catch (e) {
        console.log(e.name, e.message);
        return res.status(400).json({
            resType: "Error",
            msg: "不正なID [splitted]"
        })
    }
    const pSplit = utils.pidSplit(playerId);
    const playerIndex = pSplit.pIndex;
    const playerNameLen = pSplit.pNameLen;

    const isValid = utils.isValidUnix(state.gameServerStartAt, pSplit.pUnixHex);
    if (!isValid) {
        return res.status(400).json({
            resType: "Error",
            msg: "有効期限切れのデータ"
        })
    }

    const playersArray = [...state.playersMap.values()]
    const targPlayer = playersArray[playerIndex];
    if (!targPlayer) {
        return res.status(400).json({
            resType: "Error",
            msg: "存在しないプレイヤー"
        })
    }

    if (targPlayer.displayName.length != playerNameLen) {
        return res.status(400).json({
            resType: "Error",
            msg: "プレイヤーの不一致"
        })
    }

    // playerが見つかり、整合性が判定できたら
    return res.status(201).json({
        resType: "OK",
        pid: targPlayer.id,
        username: targPlayer.displayName,
        player: targPlayer
    })

})

app.get("/settings/profile", (req, res) => {
    return res.render("profile", { display: false, alert: "" });
})
app.post("/settings/profile", (req, res) => {
    const { theme, pid } = req.body ?? {};
    if (!theme || !pid) {
        return res.render("profile", { display: true, alert: "danger" });
    }
    const pidChk = getPlayer(pid);
    if (!pidChk.isValid) {
        return res.render("profile", { display: true, alert: "danger" });
    }
    const player = pidChk.player;
    if (theme != "none") {
        player.themeColor = theme.replace("blue", "#318bf2").replace("yellow", "#e0e31b");
    }

    //player.displayName=displayName;
    return res.render("profile", { display: true, alert: "success" })
})

app.get("/main", (req, res) => {
    return res.render("main");
})

app.get("/logout", (req, res) => {
    return res.render("logout");
})

app.get("/rooms", (req, res) => {
    const token = newToken("srrm");
    const roomsArray = [...state.roomsMap.values()];
    return res.render("rooms", { roomsArray, token });
})
app.get("/room/:id", (req, res) => {
    const id = req.params.id;
    const room = state.roomsMap.get(id);
    if (room === undefined) {
        return res.redirect("/");
    }
    return res.render("room", { id, room });
})

app.get("/", (req, res) => {
    return res.render("index");
})

const socketHandler = require("./socket");
socketHandler(io, { state, getPlayer });

server.listen(PORT, () => {
    console.log("http://localhost:" + PORT);
});