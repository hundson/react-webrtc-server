const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const PORT = process.env.PORT || 5000;
const app = express();
app.use(cors());
const server = http.createServer(app);

let connectedUsers = [];
let calls = [];

app.get("/api/call-exists/:callID", (req, res) => {
  const { callID } = req.params;
  const call = calls.find((call) => call.id === callID);

  if (call) {
    if (call.connectedUsers.length > 1) {
      return res.send({ callExists: true, callFull: true });
    } else {
      return res.send({ callExists: true, callFull: false });
    }
  } else {
    return res.send({ callExists: false });
  }
});

const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`User connected ${socket.id}`);

  socket.on("create-call", (data) => {
    createCallHandler(data, socket);
  });

  socket.on("join-call", (data) => {
    joinCallHandler(data, socket);
  });

  socket.on("disconnect", () => {
    disconnectHandler(socket);
  });

  socket.on("connection-signal", (data) => {
    signalingHandler(data, socket);
  });

  socket.on("connection-init", (data) => {
    connectionInitHandler(data, socket);
  });
});

const createCallHandler = (data, socket) => {
  const { identity } = data;
  const callID = uuidv4().substring(0, 4);

  // Creates new user
  const newUser = {
    identity,
    id: uuidv4(),
    socketID: socket.id,
    callID,
  };

  // Push new user to connectedUsers
  connectedUsers = [...connectedUsers, newUser];

  // Create call
  const newCall = {
    id: callID,
    connectedUsers: [newUser],
  };

  // Join socket.io call
  socket.join(callID);

  calls = [...calls, newCall];

  // Emit callID to host
  socket.emit("call-id", { callID });

  // Emit new user to call participants
  socket.emit("call-update", { connectedUsers: newCall.connectedUsers });
};

const joinCallHandler = (data, socket) => {
  const { identity, callID } = data;

  const newUser = {
    identity,
    id: uuidv4(),
    socketID: socket.id,
    callID,
  };

  // Join call as secondary user
  const call = calls.find((call) => call.id === callID);
  call.connectedUsers = [...call.connectedUsers, newUser];

  // join socket.io call
  socket.join(callID);

  // add new user to connected users array
  connectedUsers = [...connectedUsers, newUser];

  // Emit to all users already in room to prepare connection
  call.connectedUsers.forEach((user) => {
    if (user.socketID !== socket.id) {
      const data = {
        connectedUserSocketID: socket.id,
      };

      io.to(user.socketID).emit("connection-prepare", data);
    }
  });

  io.to(callID).emit("call-update", { connectedUsers: call.connectedUsers });
};

const disconnectHandler = (socket) => {
  console.log("DISCONNECT HANDLER");
  const user = connectedUsers.find((user) => user.socketID === socket.id);

  if (user) {
    // removes user from call
    const call = calls.find((call) => call.id === user.callID);

    call.connectedUsers = call.connectedUsers.filter(
      (user) => user.socketID !== socket.id
    );

    // leave socket io call
    socket.leave(user.callID);

    // close call if no more participants
    if (call.connectedUsers.length > 0) {
      console.log("call.connectedUsers.length > 0");
      // Emit to remaining users that a user has disconnected
      io.to(call.id).emit("user-disconnected", { socketID: socket.id });

      // emit to other users new connected user
      io.to(call.id).emit("call-update", {
        connectedUsers: call.connectedUsers,
      });
    } else {
      calls = calls.filter((c) => c.id !== call.id);
    }
  }
  console.log("DISCONNECT HANDLER END");
};

const signalingHandler = (data, socket) => {
  const { connectedUserSocketID, signal } = data;
  const signalingData = { signal, connectedUserSocketID: socket.id };
  io.to(connectedUserSocketID).emit("connection-signal", signalingData);
};

// Inform from clients already in room that they are prepared for incoming connection
const connectionInitHandler = (data, socket) => {
  const { connectedUserSocketID } = data;
  const initData = { connectedUserSocketID: socket.id };
  io.to(connectedUserSocketID).emit("connection-init", initData);
};

server.listen(PORT, () => {
  console.log(`Server is listening on ${PORT}`);
});
