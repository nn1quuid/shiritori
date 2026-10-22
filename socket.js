const utils = require("./utils");
const EVENTS = {
    ROOM_JOIN_SPECTATOR: "room:join-spectator",
    ROOM_JOIN_ACCEPT: "room:join-accept",
    ROOM_JOIN_DENIED: "room:join-denied",
    ROOM_JOIN_PLAYER: "room:join-player",
    ROOM_LEAVE: "room:leave",
    ROOM_RESET_ACTIVE: "room:reset-active",
    ALERT_INFO: "info",
    ALERT_ERROR: "error",
    ALERT_WARN: "warn",
    GAME_NOT_YOUR_TURN: "game:not-your-turn",
    GAME_YOUR_TURN: "game:your-turn",
    GAME_UPDATE_PLAYER_DATA: "game:update-playerData",
    GAME_UPDATE_LATEST: "game:update-latest",
    GAME_ADD_HISTORY: "game:add-history",
    GAME_RESET_HISTORY: "game:reset-history",
    GAME_RESET_OK: "game:reset-ok",
    GAME_SUBMIT: "game:submit",
    GAME_CHECK_ACTIVE: "game:check-active",
    GAME_SEND_HISTORY: "game:send-history"
}

const USER_ROLE = {
    PLAYER: "player",
    SPECTATOR: "spectator"
}

module.exports = (io, { state, getPlayer }) => {
    io.on("connection", (socket) => {
        socket.on(EVENTS.ROOM_JOIN_SPECTATOR, ({ roomId, playerId }) => handleJoinSpectator(socket, roomId, playerId));
        socket.on(EVENTS.ROOM_JOIN_PLAYER, () => handleJoinRoom(socket));
        socket.on(EVENTS.ROOM_LEAVE, () => handleLeaveRoom(socket));
        socket.on(EVENTS.GAME_SUBMIT, ({ msg }) => handleSubmit(socket, msg));
        socket.on(EVENTS.GAME_RESET_HISTORY, () => handleReset(socket));
        socket.on("disconnect", () => handleDisconnect(socket));
    });

    const handleReset = (socket) => {
        const {roomId} = socket.data;
        const room = state.roomsMap.get(roomId);
        if (room.sockets.length == 1) {
            // reset処理
            room.usedWords = ["しりとり"];
            room.turn = 0;
            room.turnIndex = 0;

            io.to(roomId).emit(EVENTS.GAME_UPDATE_LATEST, room.latestWord());
            io.to(roomId).emit(EVENTS.ALERT_INFO, "履歴をリセットしました！");
            io.to(roomId).emit(EVENTS.GAME_RESET_OK);
        }
    }

    const handleJoinSpectator = (socket, roomId, playerId) => {
        const room = state.roomsMap.get(roomId);
        if (!room) {
            return sendError(socket, "このルームは存在しません。");
        }
        // 満室処理は不要
        // ログインを必須にしておく
        const pidChk = getPlayer(playerId);
        if (!pidChk.isValid) {
            return sendError(socket, "ログインしてください。");
        }
        const player = pidChk.player;
        socket.join(roomId);

        // socketにデータを紐付け
        socket.data.roomId = roomId;
        socket.data.playerId = player.id;
        socket.data.as = USER_ROLE.SPECTATOR;
        console.log(`${player.displayName} joined room ${roomId} as spectator`);

        // 履歴読み込み
        const history = room.usedWords;
        socket.emit(EVENTS.GAME_SEND_HISTORY, history);
    }
    const handleJoinRoom = (socket) => {
        const { roomId, playerId } = socket.data;
        const room = state.roomsMap.get(roomId);
        const denyJoin = (socket, msg) => {
            socket.emit(EVENTS.ROOM_JOIN_DENIED);
            return sendError(socket, msg);
        }
        if (!room) {
            return denyJoin(socket, "このルームは存在しません。");
        }

        if (room.sockets.length >= room.maxSockets) {
            return denyJoin(socket, "このルームは満室です。");
        }

        const pidChk = getPlayer(playerId);
        if (!pidChk.isValid) {
            return denyJoin(socket, "ログインしてください。");
        }

        const player = pidChk.player;
        if (player.sockets.length >= 1) {
            return denyJoin(socket, "多重起動はできません。");
        }

        // spectator ですでにjoinしている
        //socket.join(roomId);
        socket.data.as = USER_ROLE.PLAYER;
        room.sockets.push(socket.id);
        player.sockets.push(socket.id);
        room.players.push(player);

        console.log(socket.id, "joined game room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
        socket.to(roomId).emit(EVENTS.ALERT_INFO, player.displayName + "がゲームに参加しました" + ` (${room.players.length}/${room.maxSockets})`);
        io.to(roomId).emit(EVENTS.GAME_UPDATE_LATEST, room.latestWord());
        io.to(socket.id).emit(EVENTS.ROOM_JOIN_ACCEPT);

        updatePlayerData(roomId);
        updateActivity(player);

        socket.data.checkActiveLoop = setInterval(() => {
            const now = utils.getUnix().timestamp;
            if (room.players.length == 1) {
                // 入った途端に kickされるのを防止する
                updateActivity(player);
                return
            }
            if (room.getCurrentTurnPlayer()?.id != player.id) {
                updateActivity(player); // ターンでないplayerをupdate
                return
            }
            if (now - player.lastActivity > room.maxInactiveSec) {
                socket.disconnect();
                clearInterval(socket.data.checkActiveLoop);
            }
        }, 5000)
    };
    const updatePlayerData = (roomId) => {
        const room = state.roomsMap.get(roomId);
        if (!room) {
            return
        }
        const playerNames = room.players.map(p => p.displayName);
        const ctp = room.getCurrentTurnPlayer();

        const ctpIndex = room.players.indexOf(ctp);

        const ctpSocketId = room.sockets[ctpIndex];
        const gameData = {
            playerNames,
            ctp: ctp?.displayName,
            ctpIndex
        }
        
        io.to(roomId).emit(EVENTS.GAME_NOT_YOUR_TURN);
        if (playerNames.length >= 2) {
            io.to(ctpSocketId).emit(EVENTS.GAME_YOUR_TURN);
        }
        io.to(roomId).emit(EVENTS.GAME_UPDATE_PLAYER_DATA, gameData);
    }
    const handleLeaveRoom = (socket) => {
        socket.disconnect();        
        return;
    };

    const handleSubmit = (socket, msg) => {
        const { roomId, playerId } = socket.data;
        const room = state.roomsMap.get(roomId);
        if (!room) {
            return socket.disconnect();
        }
        if (msg.length > 25) {
            io.to(socket.id).emit(EVENTS.ALERT_WARN, "単語が長すぎます！");
            return;
        }

        const res = room.submit(playerId, msg);

        if (res.ok) {
            const hiragana = room.accept(playerId, msg);
            io.to(roomId).emit(EVENTS.GAME_ADD_HISTORY, hiragana);
            io.to(roomId).emit(EVENTS.GAME_UPDATE_LATEST, hiragana);
            updatePlayerData(roomId);

            if (hiragana.at(-1) == "ん") {
                loserId = playerId;
                const loserName = getPlayer(playerId)?.player?.displayName;
                if (!loserName) {
                    console.warn(`Loser Name: ${loserName}`);
                    return;
                }
                io.to(roomId).emit(EVENTS.ALERT_INFO, `残念！${loserName} さんの負けです`);

                if (room.players.length == 2) {
                    io.to(roomId).emit(EVENTS.GAME_NOT_YOUR_TURN);
                    const hostId = room.sockets[0] // socket.id
                    io.to(hostId).emit(EVENTS.ROOM_RESET_ACTIVE);
                }
            }
        } else {
            const nav = res.reason ?? "エラーが発生しました";
            socket.emit(EVENTS.ALERT_WARN, nav);
        }
    };

    const updateActivity = (player) => {
        player.updateActivity();
    }

    const sendError = (socket, message) => {
        socket.emit(EVENTS.ALERT_ERROR, message);
        return socket.disconnect();
    };

    const handleDisconnect = (socket) => {
        const { roomId, playerId } = socket.data;
        if (!roomId || !playerId) {
            return
        }
        const room = state.roomsMap.get(roomId);
        const player = getPlayer(playerId).player;
        if (!room || !player) {
            return;
        }
        if (socket.data.as === USER_ROLE.SPECTATOR) {
            console.log(socket.id, "(spectator) left room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
            return;
        }
        if (socket.data.as === USER_ROLE.PLAYER) {
            if (socket.data.checkActiveLoop) {
                clearInterval(socket.data.checkActiveLoop);
            }
            const leaveResponse = room.leave(socket.id, player);
            if (leaveResponse.ok) {
                // player の場合
                console.log(socket.id, "left room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
                socket.to(roomId).emit(EVENTS.ALERT_INFO, player.displayName + "が退室しました");
                updatePlayerData(roomId);
            }
        }

        if (room.sockets.length == 0) {
            room.roomInit();
            socket.to(roomId).emit(EVENTS.ALERT_INFO, "ゲームを初期化しました");
            io.to(roomId).emit(EVENTS.GAME_UPDATE_LATEST, room.latestWord());
            setTimeout(()=>{
                if (room.sockets.length == 0) {
                    socket.to(roomId).emit(EVENTS.ALERT_INFO, "しばらくの間、参加者が居なかったため、ルームが削除されました。");
                    room.delete();
                }
            }, 10000);
        } else if (room?.sockets?.length == 1) {
            io.to(socket.data.roomId).emit(EVENTS.ROOM_RESET_ACTIVE);
        }
    }
};