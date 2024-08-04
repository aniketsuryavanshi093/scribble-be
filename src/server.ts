import 'module-alias/register'

import express from 'express'
import { Server, type Socket } from 'socket.io'
import http from 'http'
import cors from 'cors'
import { z } from 'zod'

import type { DrawOptions, JoinRoomData, User } from '@/types'
import { joinRoomSchema } from '@/lib/validations/joinRoom'
// import { addUser, getRoomMembers, getUser, removeUser } from '@/data/users'
import { addUndoPoint, getLastUndoPoint, deleteLastUndoPoint } from '@/data/undoPoints'

const rooms: Record<string, User[]> = {}
const getUser = (userId: string, roomId?: string) => {
  if (roomId) {
    const roomMembers = rooms[roomId!]
    if (!roomMembers) return null
    return roomMembers.find(user => user.id === userId)
  } else {
    for (const element of Object.values(rooms)) {
      const user = element.find(user => user.id === userId)
      if (user) {
        return user
      }
    }
    return null
  }
}

// const getRoomMembers = (roomId: string) =>
//   users
//     .filter(user => user.roomId === roomId)
//     .map(({ id, username }) => ({ id, username }))

const getRoomMembers = (roomId: string) => {
  const roomMembers = rooms[roomId]
  if (!roomMembers) return []
  return roomMembers
}
// users
//   .filter(user => user.roomId === roomId)
//   .map(({ id, username }) => ({ id, username }))

// const addUser = (user: User) => users.push(user)
const addUser = (user: User, roomId: string) => {
  if (!rooms[roomId]) return (rooms[roomId] = [user])
  rooms[roomId].push(user)
}

const removeUser = (userId: string, roomId?: string) => {
  if (roomId) {
    // users = users.filter(user => user.id !== userId)
    if (!rooms[roomId]) return
    rooms[roomId] = rooms[roomId].filter(user => user.id !== userId)
  }
}
const app = express()

app.use(cors())

const server = http.createServer(app)

const io = new Server(server)

function isRoomCreated(roomId: string) {
  const rooms = [...io.sockets.adapter.rooms]
  return rooms?.some(room => room[0] === roomId)
}

function validateJoinRoomData(socket: Socket, joinRoomData: JoinRoomData) {
  try {
    return joinRoomSchema.parse(joinRoomData)
  } catch (error) {
    if (error instanceof z.ZodError) {
      socket.emit('invalid-data', {
        message: 'The entities you provided are not correct and cannot be processed.',
      })
    }
  }
}

function joinRoom(
  socket: Socket,
  roomId: string,
  username: string,
  Avatar: User['Avatar']
) {
  socket.join(roomId)
  const user = {
    id: socket.id,
    username,
    Avatar,
    roomId,
  }

  addUser(user, roomId)
  const members = getRoomMembers(roomId)
  socket.emit('room-joined', { user, roomId, members })
  socket.to(roomId).emit('update-members', members)
  socket.to(roomId).emit('send-notification', {
    title: 'New member arrived!',
    message: `${username} joined the party.`,
  })
}

function leaveRoom(socket: Socket, RoomId?: string) {
  const user = getUser(socket.id, RoomId)
  if (!user) return
  const { username, roomId } = user
  removeUser(socket.id, roomId)
  const members = getRoomMembers(roomId)

  socket.to(roomId).emit('update-members', members)
  socket.to(roomId).emit('send-notification', {
    title: 'Member departure!',
    message: `${username} left the party.`,
  })
  socket.leave(roomId)
}

io.on('connection', socket => {
  socket.on('create-room', (joinRoomData: JoinRoomData) => {
    const validatedData = validateJoinRoomData(socket, joinRoomData)

    if (!validatedData) return
    const { roomId, username } = validatedData
    joinRoom(socket, roomId, username, joinRoomData.Avatar)
  })

  socket.on('join-room', (joinRoomData: JoinRoomData) => {
    const validatedData = validateJoinRoomData(socket, joinRoomData)

    if (!validatedData) return
    const { roomId, username } = validatedData

    if (isRoomCreated(roomId)) {
      return joinRoom(socket, roomId, username, joinRoomData.Avatar)
    }

    socket.emit('room-not-found', {
      message: "Oops! The Room ID you entered doesn't exist or hasn't been created yet.",
    })
  })

  socket.on('client-ready', (roomId: string) => {
    const members = getRoomMembers(roomId)
    // Don't need to request the room's canvas state if a user is the first member
    if (members.length === 1) return socket.emit('client-loaded')

    const adminMember = members[0]

    if (!adminMember) return

    socket.to(adminMember.id).emit('get-canvas-state')
  })

  socket.on(
    'send-canvas-state',
    ({ canvasState, roomId }: { canvasState: string; roomId: string }) => {
      const members = getRoomMembers(roomId)
      const lastMember = members[members.length - 1]

      if (!lastMember) return

      socket.to(lastMember.id).emit('canvas-state-from-server', canvasState)
    }
  )

  socket.on(
    'draw',
    ({ drawOptions, roomId }: { drawOptions: DrawOptions; roomId: string }) => {
      socket.to(roomId).emit('update-canvas-state', drawOptions)
    }
  )
  socket.on(
    'broadcast-mesage',
    ({
      roomId,
      message,
      username,
      userid,
    }: {
      roomId: string
      message: string
      userid: string
      username: string
    }) => {
      io.to(roomId).emit('recieve-broadcasted-message', {
        message,
        userid,
        username,
      })
    }
  )
  socket.on('clear-canvas', (roomId: string) => {
    socket.to(roomId).emit('clear-canvas')
  })

  socket.on(
    'undo',
    ({ canvasState, roomId }: { canvasState: string; roomId: string }) => {
      socket.to(roomId).emit('undo-canvas', canvasState)
    }
  )

  socket.on('get-last-undo-point', (roomId: string) => {
    const lastUndoPoint = getLastUndoPoint(roomId)
    socket.emit('last-undo-point-from-server', lastUndoPoint)
  })

  socket.on(
    'add-undo-point',
    ({ roomId, undoPoint }: { roomId: string; undoPoint: string }) => {
      addUndoPoint(roomId, undoPoint)
    }
  )

  socket.on('delete-last-undo-point', (roomId: string) => {
    deleteLastUndoPoint(roomId)
  })

  socket.on('leave-room', (roomId: string) => {
    leaveRoom(socket, roomId)
  })

  socket.on('disconnect', () => {
    socket.emit('disconnected')
    leaveRoom(socket)
  })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => console.log(`Server is running on port ${PORT} now!`))
