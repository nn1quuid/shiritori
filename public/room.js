(async () => {
    const roomId = window.roomId;
    const playerId = localStorage.getItem("pid");
    if (!playerId) {
        location.href = "/";
        return
    }
    const fd = new FormData();
    fd.append("pid", playerId);
    const response = await fetch("/api/pid", {
        method: "POST",
        body: new URLSearchParams(fd)
    })
    const res = await response.json();

    if (!res.ok) {
        location.href = "/";
        return
    }

    const player = res.player;

    // --- user icon ---
    document.getElementById("who").innerText = player.displayName;
    document.getElementById("whoid").innerText = "@" + player.id;
    const userMenu = document.querySelector(".bnto-user");
    let theme = player.themeColor;
    userMenu.style.setProperty("--c1", theme);
    // --- ---

    const socket = io();
    const errorBox = document.getElementById("errorBox");
    const infoBox = document.getElementById("infoBox");
    const warnBox = document.getElementById("warnBox");

    const wordInput = document.getElementById("msg");
    const playersCount = document.getElementById("playersCount");
    const wordHistory = document.getElementById("wordHistory");
    const resetBtn = document.getElementById("resetBtn");

    wordInput.disabled = true;
    wordInput.addEventListener("input", () => {
        warnBox.style.display = "none";
    })

    socket.emit("room:join-spectator", { roomId, playerId }); // not in game

    // --- join game ---
    const joinBtn = document.getElementById("joinBtn");
    joinBtn.addEventListener("click", joinGame);

    const sendBtn = document.getElementById("sendBtn");
    function joinGame() {
        joinBtn.disabled = true;
        socket.emit("room:join-player");
        socket.once("room:join-accept", () => {
            wordInput.disabled = false;
            sendBtn.disabled = false;
            joinBtn.style.display = "none";
            wordInput.focus();
        })
    }

    socket.on("room:join-denied", () => {
        joinBtn.disabled = false;
    })

    function getCurrentTimeLabel() {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        return `[${hh}:${mm}]`;
    }

    function turnChange(cmd) {
        const elem = document.getElementById("turnDiv");
        if (cmd == "you") {
            elem.classList.replace("turn-other", "turn-you");
            return
        }
        if (cmd == "other") {
            elem.classList.replace("turn-you", "turn-other");
            return
        }

        // if cmd == undefined
        if (elem.classList.contains("turn-you")) {
            elem.classList.replace("turn-you", "turn-other");
        } else if (elem.classList.contains("turn-other")) {
            elem.classList.replace("turn-other", "turn-you");
        }
    }

    function newInfo(infoMsg) {
        const existingInfos = infoBox.innerText.split("\n");
        if (existingInfos.length > 3) {
            existingInfos.shift();
            infoBox.innerText = existingInfos.join("\n");
        }
        const t = getCurrentTimeLabel();
        infoBox.style.display = "";
        infoBox.innerText += `${t} ${infoMsg}\n`;
        infoMsg.includes("がゲームに参加しました") && (resetBtn.hidden = true);
    }
    socket.on("info", (msg) => {
        newInfo(msg);
    })
    socket.on("error", (msg) => {
        errorBox.style.display = "";
        errorBox.textContent += msg;
        errorBox.innerHTML += "<br><a href='/'>TOPへ戻る</a>";
        wordInput.remove();
        sendBtn.remove();
        joinBtn.remove();
    })
    socket.on("warn", (msg) => {
        warnBox.style.display = "";
        warnBox.textContent = msg;
    })

    window.addEventListener("beforeunload", () => {
        socket.emit("room:leave");
    })

    function addHistory(word) {
        wordHistory.innerText += word + "\n";
        wordHistory.scrollTop = wordHistory.scrollHeight;
    }

    socket.on("game:send-history", (words) => {
        words.forEach(word => {
            addHistory(word);
        })
    })

    socket.on("game:add-history", addHistory);

    const form = document.getElementById("form");

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const msg = wordInput.value.trim();
        if (msg.length <= 25 && /^[ぁ-んァ-ヶー]+$/.test(msg)) {
            socket.emit("game:submit", { msg });
        } else {
            warnBox.style.display = "";
            warnBox.textContent = "このワードは使用できません。";
        }
        wordInput.value = "";
        wordInput.focus();
    })

    // change latest
    const latest = document.getElementById("latest");
    function changeLatest(word) {
        latest.classList.add("changing");

        setTimeout(() => {
            latest.textContent = word;
            latest.classList.remove("changing");
        }, 150);
    }
    socket.on("game:update-latest", (word) => {
        if (!word) {
            return
        }
        changeLatest(word);
    })

    socket.on("game:not-your-turn", () => {
        turnChange("other");
    })
    socket.on("game:your-turn", () => {
        turnChange("you");
    })

    // socket.on("game:finish", ()=>{
    //     turnChange("other");
    // })

    socket.on("game:update-playerData", (gameData) => {
        playersCount.textContent = gameData.playerNames.length;

        const turns = document.getElementById("turns");
        turns.replaceChildren();
        gameData.playerNames.forEach((playerName, index) => {
            const span = document.createElement("span");

            span.textContent = playerName;
            span.className = index === gameData.ctpIndex
                ? "fw-bold text-primary"
                : "text-secondary";

            turns.appendChild(span);
            if (index < gameData.playerNames.length - 1) {
                turns.appendChild(document.createTextNode("→"));
            }
        });
    })
    socket.on("game:plz-wait", ()=>{
        resetBtn.hidden = false;
        resetBtn.disabled = true;
        resetBtn.textContent = "ホストの選択を待機中です……";
    })
    socket.on("room:reset-active", () => {
        resetBtn.hidden = false;
        resetBtn.disabled = false;
        resetBtn.textContent = "履歴をリセットする";
    })

    resetBtn.addEventListener("click", reset);
    function reset() {
        socket.emit("game:reset-history");
    }
    socket.on("game:reset-ok", () => {
        wordHistory.textContent = "";
        addHistory("しりとり");
        resetBtn.hidden = true;
        resetBtn.disabled = true;
    })

    socket.on("disconnect", () => {
        warnBox.style.display = "";
        warnBox.textContent = "切断されました。";
        warnBox.innerHTML += "<br><button class='btn btn-link' onclick='location.reload()'>ページを更新する</button>";
        turnChange("other");
    })
})();