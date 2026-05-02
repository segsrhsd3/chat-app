const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
// 👇 ВОТ ЭТУ СТРОКУ ДОБАВЬ:
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 3000;

// Хранилище
let messages = [];           // история чата
let onlineUsers = new Map();  // socket.id -> { name, avatar }

io.on('connection', (socket) => {
  console.log(`Подключился: ${socket.id}`);

  // Отправляем новичку историю
  socket.emit('chat history', messages.slice(-200));
  // Отправляем текущий список онлайн
  socket.emit('users online', Array.from(onlineUsers.values()));

  // Обработка входа
  socket.on('user join', (userData) => {
    if (!userData || !userData.name) return;

    onlineUsers.set(socket.id, {
      name: userData.name,
      avatar: userData.avatar || '😎'
    });
    
    // Системное сообщение
    const joinMsg = {
      type: 'system',
      text: `${userData.name} присоединился к чату`,
      time: getTime()
    };
    messages.push(joinMsg);
    
    io.emit('chat message', joinMsg);
    io.emit('users online', Array.from(onlineUsers.values()));
  });

  // Обработка сообщения
  socket.on('chat message', (msg) => {
    const fullMsg = {
      type: 'message',
      user: msg.user,
      avatar: msg.avatar || '😎',
      text: msg.text,
      time: getTime()
    };
    messages.push(fullMsg);
    if (messages.length > 500) messages.shift();
    io.emit('chat message', fullMsg);
  });

  // Отключение
  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      const leaveMsg = {
        type: 'system',
        text: `${user.name} вышел из чата`,
        time: getTime()
      };
      messages.push(leaveMsg);
      io.emit('chat message', leaveMsg);
    }
    onlineUsers.delete(socket.id);
    io.emit('users online', Array.from(onlineUsers.values()));
    console.log(`Отключился: ${socket.id}`);
  });
});

function getTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});