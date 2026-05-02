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
  maxHttpBufferSize: 5e6 // до 5 МБ для картинок
});

const PORT = process.env.PORT || 3000;

// === БАЗА ДАННЫХ В ФАЙЛАХ (JSON) ===
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

// === СОСТОЯНИЕ ===
let messages = [];            // { room, user, avatar, text, type, time, image? }
let onlineUsers = new Map();  // socket.id -> { name, avatar, room }

// Загружаем старые сообщения при старте
messages = loadJSON('messages.json') || [];

// Каждые 30 секунд сохраняем
setInterval(() => saveJSON('messages.json', messages.slice(-500)), 30000);

// === СЕРВЕР ===
io.on('connection', (socket) => {
  console.log(`➕ ${socket.id}`);

  socket.on('user join', (data) => {
    const room = data.room || 'general';
    socket.join(room);
    onlineUsers.set(socket.id, { name: data.name, avatar: data.avatar || '😎', room });

    // История комнаты
    const roomMsgs = messages.filter(m => m.room === room).slice(-200);
    socket.emit('chat history', roomMsgs);

    // Системное сообщение
    const joinMsg = { room, type: 'system', text: `${data.name} вошёл`, time: getTime() };
    messages.push(joinMsg);
    io.to(room).emit('chat message', joinMsg);

    updateOnline(room);
  });

  socket.on('chat message', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const room = user.room;

    const msg = {
      room,
      type: data.image ? 'image' : 'message',
      user: user.name,
      avatar: user.avatar,
      text: data.text || '',
      image: data.image || null,
      time: getTime()
    };
    messages.push(msg);
    if (messages.length > 1000) messages = messages.slice(-500);
    io.to(room).emit('chat message', msg);
  });

  socket.on('typing', () => {
    const user = onlineUsers.get(socket.id);
    if (user) socket.to(user.room).emit('typing', user.name);
  });

  socket.on('stop typing', () => {
    const user = onlineUsers.get(socket.id);
    if (user) socket.to(user.room).emit('stop typing', user.name);
  });

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      const leaveMsg = { room: user.room, type: 'system', text: `${user.name} вышел`, time: getTime() };
      messages.push(leaveMsg);
      io.to(user.room).emit('chat message', leaveMsg);
      updateOnline(user.room);
    }
    onlineUsers.delete(socket.id);
  });

  function updateOnline(room) {
    const users = [];
    for (let [id, u] of onlineUsers) {
      if (u.room === room) users.push({ name: u.name, avatar: u.avatar });
    }
    io.to(room).emit('users online', users);
  }
});

function getTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

server.listen(PORT, () => console.log(`🚀 Порт ${PORT}`));