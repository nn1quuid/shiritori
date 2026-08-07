module.exports= (io, {state, getPlayer}) =>{
    io.on("connection", (socket) => {
        socket.on("joinRoom", ({ roomId, playerId }) => {
            if (!state.roomsMap.get(roomId)) {
                io.to(socket.id).emit("error", "このルームは存在しません。");
                return socket.disconnect();
            }
            const room = state.roomsMap.get(roomId);
            if (room.sockets.length >= room.maxSockets) {
                io.to(socket.id).emit("error", "このルームは満室です。");
                return socket.disconnect();
            }
            
            const pidChk = getPlayer(playerId);
            if (!pidChk.isValid) {
                io.to(socket.id).emit("error", "ログインしてください。");
                return socket.disconnect();
            }
            const player = pidChk.player;
            if (player.sockets.length > 1) {
                io.to(socket.id).emit("error", "多重起動はできません。");
                return socket.disconnect();
            }
            socket.join(roomId);
            room.sockets.push(socket.id);
            player.sockets.push(socket.id);
            room.players.push(player);
            console.log(socket.id, "joined room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
            socket.to(roomId).emit("info", player.displayName + "が参加しました");
        })
        socket.on("leaveRoom", ({ roomId, playerId }) => {
            const pidChk = getPlayer(playerId);
            if (!pidChk.isValid) {
                return socket.disconnect();
            }
            const player = pidChk.player;
            const room = state.roomsMap.get(roomId);
            const pi = player.sockets.indexOf(socket.id);
            player.sockets.splice(pi, 1);
            const ri = room.sockets.indexOf(socket.id);
            room.sockets.splice(ri, 1);
            socket.disconnect();
            console.log(socket.id, "left room", roomId, `[${room.sockets.length}/${room.maxSockets}]`);
            socket.to(roomId).emit("info", player.displayName + "が退室しました");
        })

        socket.on("submit", ({ roomId, playerId, msg }) => {
            const room=state.roomsMap.get(roomId);
            if(!room || !msg){
                return socket.disconnect();
            }
            const submitted=room.submit(playerId, msg);
            if(submitted){
                room.accept(playerId, msg);
                io.to(roomId).emit("sent", msg);
            } else {
                io.to(roomId).emit("sent", "拒否");
            }
            
        })
    })
}