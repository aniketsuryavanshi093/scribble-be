const express = require('express')
const socketIo = require('socket.io')
const app = express()
const http = require('http')
const crypto = require('crypto')

const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: 'http://localhost:5173',
  },
})
type User = {
  username: string
  userId: string
  isDrawer: boolean
  isAdmin: boolean
}
const rooms: {
  [roomId: string]: { users: User[] }
} = {}

function generateRoomId() {
  return crypto.randomBytes(4).toString('hex')
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id)

  socket.on('create room', (userId) => {
    let roomId = generateRoomId()
    while (rooms[roomId]) {
      roomId = generateRoomId()
    }
    rooms[roomId] = {
      users: [
        {
          userId,
          username: 'captain',
          isDrawer: true,
          isAdmin: true,
        },
      ],
    }
    socket.join(roomId)
    socket.roomId = roomId
    socket.emit('room created', { roomId, userId })
    socket.emit('set as drawer')
    console.log(`Room created: ${roomId} by user ${socket.id} with username `)
  })

  socket.on('join room', ({ roomId, username, userId }) => {
    if (!rooms[roomId]) {
      console.log(roomId)
      socket.emit('room not found')
      return
    }

    const room = rooms[roomId]
    const existuser = room.users.find((el) => el.userId === userId)
    if (!existuser && room.users.length >= 3) {
      socket.emit('room full')
      return
    }

    socket.join(roomId)
    socket.roomId = roomId
    if (!existuser) {
      room.users.push({
        userId,
        username,
        isDrawer: false,
        isAdmin: false,
      })
    }
    console.log(
      `User ${socket.id} with username ${username} joined room ${roomId}`
    )
    socket.to(roomId).emit('user joined', { username })
    socket.emit('room joined', { roomId, userId, username })
    io.in(roomId).emit('user list', room.users)
    if (room.users.length === 1) {
      socket.emit('set as drawer')
    }
  })

  socket.on('get user list', (roomid) => {
    socket.emit('user list', rooms[roomid]?.users || 'no room found ')
  })

  socket.on('draw', (data) => {
    const roomId = data.roomId // Get the room ID
    if (roomId) {
      socket.to(roomId).emit('draw', data)
    }
  })
  socket.on('stop game', (roomId) => {
    if (rooms[roomId]) {
      // Notify all users in the room that the game has stopped
      io.to(roomId).emit('game stopped')
      // Remove all sockets from the room
      const socketsInRoom = io.sockets.adapter.rooms.get(roomId)
      if (socketsInRoom) {
        for (const socketId of socketsInRoom) {
          io.sockets.sockets.get(socketId).leave(roomId)
        }
      }
      // Delete the room from the rooms object
      delete rooms[roomId]
      console.log(`Room ${roomId} deleted due to game stop`)
    }
  })
  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id)
    for (const roomId in rooms) {
      const room = rooms[roomId]
      const userIndex = room.users.findIndex(
        (user) => user.userId === socket.id
      )
      if (userIndex !== -1) {
        room.users.splice(userIndex, 1)
        if (room.users.length === 0) {
          delete rooms[roomId]
          console.log(`Room ${roomId} deleted`)
        } else if (
          room.users.length === 1 &&
          room.users[0].userId !== socket.id
        ) {
          io.to(room.users[0].userId).emit('set as drawer')
        }
        break
      }
    }
  })
})

server.listen(8080, (err) => {
  console.log('Server running on Port ', 8080)
})
