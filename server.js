const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 5e6
});

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJSON(filename) {
  const file = path.join(DATA_DIR, filename);
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return []; }
}

function saveJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function getTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function getPrivateRoom(user1, user2) {
  return [user1, user2].sort().join('_');
}

// Хранилище
let messages = loadJSON('messages.json') || [];
let privateMessages = loadJSON('private.json') || {};
let onlineUsers = new Map();

setInterval(() => {
  saveJSON('messages.json', messages.slice(-500));
  saveJSON('private.json', privateMessages);
}, 30000);

function updateOnline() {
  const users = [];
  for (let [, u] of onlineUsers) {
    users.push({ name: u.name, avatar: u.avatar });
  }
  io.emit('users online', users);
}

io.on('connection', (socket) => {
  console.log('+ ' + socket.id);

  socket.on('user join', (data) => {
    onlineUsers.set(socket.id, { name: data.name, avatar: data.avatar || '😎', room: 'general' });
    socket.join('general');

    const joinMsg = { id: generateId(), room: 'general', type: 'system', text: `${data.name} вошёл`, time: getTime() };
    messages.push(joinMsg);
    io.to('general').emit('chat message', joinMsg);
    updateOnline();
  });

  socket.on('join room', (room) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const prevRoom = user.room;
    if (prevRoom === room) return;

    socket.leave(prevRoom);
    socket.join(room);
    user.room = room;
    onlineUsers.set(socket.id, user);

    if (room === 'general') {
      const msgs = messages.filter(m => m.room === 'general').slice(-200);
      socket.emit('chat history', msgs);
    } else {
      const privRoom = getPrivateRoom(user.name, room);
      const msgs = privateMessages[privRoom] || [];
      socket.emit('chat history', msgs);
    }
  });

  socket.on('chat message', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const room = user.room;

    const msg = {
      id: generateId(),
      room: room,
      type: data.voice ? 'voice' : (data.image ? 'image' : 'message'),
      user: user.name,
      avatar: user.avatar,
      text: data.text || '',
      image: data.image || null,
      voice: data.voice || null,
      time: getTime(),
      reactions: {}
    };

    if (room === 'general') {
      messages.push(msg);
      io.to('general').emit('chat message', msg);
    } else {
      const targetUser = room;
      const privRoom = getPrivateRoom(user.name, targetUser);
      if (!privateMessages[privRoom]) privateMessages[privRoom] = [];
      privateMessages[privRoom].push(msg);
      io.to(room).emit('chat message', msg);
      socket.emit('chat message', msg);
    }
  });

  socket.on('reaction', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const { msgId, emoji } = data;
    const room = user.room;

    const updateMsg = (msg) => {
      if (msg.id === msgId) {
        if (!msg.reactions) msg.reactions = {};
        const idx = msg.reactions[emoji].indexOf(user.name);
        if (idx === -1) msg.reactions[emoji].push(user.name);
        else msg.reactions[emoji].splice(idx, 1);
        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
        return msg.reactions;
      }
      return null;
    };

    let reactions = null;
    if (room === 'general') {
      for (let m of messages) {
        reactions = updateMsg(m);
        if (reactions) break;
      }
      if (reactions) io.to('general').emit('reaction update', { msgId, reactions });
    } else {
      const privRoom = getPrivateRoom(user.name, room);
      if (privateMessages[privRoom]) {
        for (let m of privateMessages[privRoom]) {
          reactions = updateMsg(m);
          if (reactions) break;
        }
        if (reactions) io.to(room).emit('reaction update', { msgId, reactions });
      }
    }
  });

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
      const leaveMsg = { id: generateId(), room: user.room, type: 'system', text: `${user.name} вышел`, time: getTime() };
      messages.push(leaveMsg);
      io.to(user.room).emit('chat message', leaveMsg);
    onlineUsers.delete(socket.id);
    updateOnline();
  });
});

server.listen(PORT, () => console.log('🚀 Порт ' + PORT));