module.exports = (io, { state, getPlayer }) => {
    io.on("connection", (socket) => {
        socket.on("room:join-spectator", ({ roomId, playerId }) => handleJoinSpectator(socket, roomId, playerId, state, getPlayer));
        socket.on("room:join-player", ({ roomId, playerId }) => handleJoinRoom(socket, roomId, playerId, state, getPlayer));
        socket.on("room:leave", ({ roomId, playerId }) => handleLeaveRoom(socket, roomId, playerId, state, getPlayer));
        socket.on("game:submit", ({ roomId, playerId, msg }) => handleSubmit(socket, roomId, playerId, msg, state));
    });
    const handleJoinSpectator = (socket, roomId, playerId, state, getPlayer) => {
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
        console.log(`${player.displayName} joined room ${roomId} as spectator`);
    }
    const handleJoinRoom = (socket, roomId, playerId, state, getPlayer) => {
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
        room.sockets.push(socket.id);
        player.sockets.push(socket.id);
        room.players.push(player);

        console.log(socket.id, "joined game room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
        socket.to(roomId).emit("info", player.displayName + "がゲームに参加しました" + ` (${room.players.length}/${room.maxSockets})`);
        io.to(roomId).emit("updateLatest", room.latestWord());
        io.to(socket.id).emit("room:join-accept");

        updatePlayerData(roomId, room);
    };
    const updatePlayerData = (roomId, room) => {
        const playerNames = room.players.map(p => p.displayName);
        const ctp=room.getCurrentTurnPlayer();
        const ctpIndex=room.players.indexOf(ctp)
        const ctpSocketId=room.sockets[ctpIndex];
        const gameData={
            playerNames,
            ctp: ctp?.displayName,
            ctpIndex
        }
        io.to(roomId).emit("game:not-your-turn");
        if(playerNames.length>=2){
            io.to(ctpSocketId).emit("game:your-turn");
        }
        io.to(roomId).emit("game:update-playerData", gameData);
    }
    const handleLeaveRoom = (socket, roomId, playerId, state, getPlayer) => {
        const pidChk = getPlayer(playerId);
        if (!pidChk.isValid) {
            return socket.disconnect();
        }

        const player = pidChk.player;
        const room = state.roomsMap.get(roomId);

        if (!player || !room) {
            return socket.disconnect();
        }
        const pi = player.sockets.indexOf(socket.id);
        if (pi >= 0) {
            player.sockets.splice(pi, 1);
        }
        const leaveRes=room.leave(socket.id, player);
        
        if (pi >= 0 && leaveRes.ok) {
            console.log(socket.id, "left room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
            socket.to(roomId).emit("info", player.displayName + "が退室しました");
            updatePlayerData(roomId, room);
        } else {
            // spectator の場合
            console.log(socket.id, "(spectator) left room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
        }

        socket.disconnect();
        // debug
        //console.log("current room status:", room.sockets, room.players);
        // 0人なら
        if (room.players.length == 0) {
            room.roomInit();
            socket.to(roomId).emit("info", "ゲームを初期化しました");
            io.to(roomId).emit("updateLatest", room.latestWord());
        }
    };

    const handleSubmit = (socket, roomId, playerId, msg, state) => {
        const room = state.roomsMap.get(roomId);
        if (!room) {
            return socket.disconnect();
        }

        const res = room.submit(playerId, msg);

        if (res.ok) {
            const hiragana = room.accept(playerId, msg);
            io.to(roomId).emit("game:addHistory", hiragana);
            io.to(roomId).emit("updateLatest", hiragana);
            updatePlayerData(roomId, room);
        } else {
            const nav=res.reason ?? "エラーが発生しました";
            io.to(socket.id).emit("warn", nav);
        }
    };

    const sendError = (socket, message) => {
        socket.emit("error", message);
        return socket.disconnect();
    };
};