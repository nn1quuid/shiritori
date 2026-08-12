const utils = require("./utils");
module.exports = (io, { state, getPlayer }) => {
    const EVENTS = {
        ROOM_JOIN_SPECTATOR: "room:join-spectator",
        ROOM_JOIN_ACCEPT: "room:join-accept",
        ROOM_JOIN_PLAYER: "room:join-player",
        ROOM_LEAVE: "room:leave",
        ALERT_INFO: "info",
        ALERT_ERROR: "error",
        ALERT_WARN: "warn",
        GAME_NOT_YOUR_TURN: "game:not-your-turn",
        GAME_YOUR_TURN: "game:your-turn",
        GAME_UPDATE_PLAYER_DATA: "game:update-playerData",
        GAME_UPDATE_LATEST: "game:update-latest",
        GAME_ADD_HISTORY: "game:add-history",
        GAME_SUBMIT: "game:submit",
        GAME_CHECK_ACTIVE: "game:check-active"
    }

    io.on("connection", (socket) => {
        socket.on(EVENTS.ROOM_JOIN_SPECTATOR, ({ roomId, playerId }) => handleJoinSpectator(socket, roomId, playerId));
        socket.on(EVENTS.ROOM_JOIN_PLAYER, () => handleJoinRoom(socket));
        socket.on(EVENTS.ROOM_LEAVE, () => handleLeaveRoom(socket));
        socket.on(EVENTS.GAME_SUBMIT, ({ msg }) => handleSubmit(socket, msg));
        socket.on("disconnect", (reason) => handleDisconnect(socket, reason));
    });

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
        socket.data.as = "spectator";
        console.log(`${player.displayName} joined room ${roomId} as spectator`);
    }
    const handleJoinRoom = (socket) => {
        const { roomId, playerId } = socket.data;
        const room = state.roomsMap.get(roomId);
        if (!room) {
            return sendError(socket, "このルームは存在しません。");
        }

        if (room.sockets.length >= room.maxSockets) {
            return sendError(socket, "このルームは満室です。");
        }

        const pidChk = getPlayer(playerId);
        if (!pidChk.isValid) {
            return sendError(socket, "ログインしてください。");
        }

        const player = pidChk.player;
        if (player.sockets.length >= 1) {
            return sendError(socket, "多重起動はできません。");
        }

        // spectator ですでにjoinしている
        //socket.join(roomId);
        socket.data.as = "player";
        room.sockets.push(socket.id);
        player.sockets.push(socket.id);
        room.players.push(player);

        console.log(socket.id, "joined game room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
        socket.to(roomId).emit(EVENTS.ALERT_INFO, player.displayName + "がゲームに参加しました" + ` (${room.players.length}/${room.maxSockets})`);
        io.to(roomId).emit(EVENTS.GAME_UPDATE_LATEST, room.latestWord());
        io.to(socket.id).emit(EVENTS.ROOM_JOIN_ACCEPT);

        updatePlayerData(roomId);
        player.updateActivity();

        const checkActiveLoop = setInterval(() => {
            const now = utils.getUnix().timestamp;
            if (room.players.length == 1) {
                // 入った途端に kickされるのを防止する
                player.updateActivity();
                return
            }
            if (now - player.lastActivity > room.maxInactiveSec) {
                socket.disconnect();
                clearInterval(checkActiveLoop);
            }
        }, 10000)
    };
    const updatePlayerData = (roomId) => {
        const room = state.roomsMap.get(roomId);
        if (!room) {
            return
        }
        const playerNames = room.players.map(p => p.displayName);
        const ctp = room.getCurrentTurnPlayer();
        const ctpIndex = room.players.indexOf(ctp)
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
                // io.to(roomId).emit() // work in progress
            }
        } else {
            const nav = res.reason ?? "エラーが発生しました";
            io.to(socket.id).emit(EVENTS.ALERT_WARN, nav);
        }
    };

    const sendError = (socket, message) => {
        socket.emit(EVENTS.ALERT_ERROR, message);
        return socket.disconnect();
    };

    const handleDisconnect = (socket, reason=undefined) => {
        const { roomId, playerId } = socket.data;
        if (!roomId || !playerId) {
            return
        }
        const room = state.roomsMap.get(roomId);
        const player = getPlayer(playerId).player;
        if (!room || !player) {
            return;
        }
        if (socket.data.as == "spectator") {
            console.log(socket.id, "(spectator) left room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
            return;
        }
        if (socket.data.as == "player") {
            const leaveResponse = room.leave(socket.id, player);
            if (leaveResponse.ok) {
                // player の場合
                console.log(socket.id, "left room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
                socket.to(roomId).emit(EVENTS.ALERT_INFO, player.displayName + "が退室しました");
                updatePlayerData(roomId);
            }
        }
        if (room.players.length == 0) {
            room.roomInit();
            socket.to(roomId).emit(EVENTS.ALERT_INFO, "ゲームを初期化しました");
            io.to(roomId).emit(EVENTS.GAME_UPDATE_LATEST, room.latestWord());
        }
    }
};