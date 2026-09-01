import express from 'express'
import { Server, type Socket } from 'socket.io'
import http from 'http'
import cors from 'cors'
import { z } from 'zod'
import { createAdapter } from '@socket.io/redis-adapter'

import type { DrawOptions, JoinRoomData, User } from '@/types'
import { joinRoomSchema } from '@/lib/validations/joinRoom'
import { addUndoPoint, getLastUndoPoint, deleteLastUndoPoint } from '@/data/undoPoints'
import { createRedisClient } from '@/lib/redis'
import {
  initializeRoom,
  getRoom,
  updateRoom,
  addUserToRoom,
  removeUserFromRoom,
  getRoomMembers,
  getUser,
  deleteRoom,
} from '@/data/gameState'
import { initPlayerScore, incrementScore, getLeaderboard } from '@/data/leaderboard'

const app = express()

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }))

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
})

// Wire Redis adapter — routes all Socket.IO events (draw, game state, etc.) across
// server instances transparently. io.sockets.adapter.rooms stays in sync across nodes,
// so isRoomCreated() below continues to work correctly without any changes.
const pubClient = createRedisClient()
const subClient = createRedisClient()

pubClient.on('connect', () => console.log('Redis pub client connected successfully'))
subClient.on('connect', () => console.log('Redis sub client connected successfully'))
pubClient.on('error', (err) => console.error('Redis pub client error:', err.message))
subClient.on('error', (err) => console.error('Redis sub client error:', err.message))

io.adapter(createAdapter(pubClient, subClient))

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

async function joinRoom(
  socket: Socket,
  roomId: string,
  username: string,
  Avatar: User['Avatar'],
  isAdmin: boolean,
  timePerDraw: number = 90,
  roundCount: number = 2
) {
  socket.join(roomId)
  const user: User = { id: socket.id, username, Avatar, roomId, isAdmin }

  if (isAdmin) {
    await initializeRoom(user, roomId, roundCount, 1, timePerDraw)
  } else {
    await addUserToRoom(user, roomId)
  }

  const room = await getRoom(roomId)
  if (!room) return

  room.gameState.score[user.id] = { score: 0, worddrawoccurance: '' }
  await updateRoom(roomId, room)
  await initPlayerScore(roomId, user.id)

  const members = await getRoomMembers(roomId)
  socket.emit('room-joined', { user, roomId, members })
  socket.to(roomId).emit('update-members', members)
  socket.to(roomId).emit('send-notification', {
    title: 'New member arrived!',
    message: `${username} joined the party.`,
  })
}

async function leaveRoom(socket: Socket, RoomId?: string) {
  const user = await getUser(socket.id, RoomId)
  if (!user) return
  const { username, roomId } = user

  await removeUserFromRoom(socket.id, roomId)

  const members = await getRoomMembers(roomId)

  socket.to(roomId).emit('update-members', members)
  socket.to(roomId).emit('send-notification', {
    title: 'Member departure!',
    message: `${username} left the party.`,
  })
  socket.leave(roomId)

  // Clean up Redis when the last member leaves
  if (members.length === 0) {
    await deleteRoom(roomId)
  }
}

async function getGameState(roomId: string) {
  const room = await getRoom(roomId)
  if (!room) return
  io.to(roomId).emit('recievegamestate', room.gameState)
}

io.on('connection', socket => {
  socket.on('create-room', async (joinRoomData: JoinRoomData) => {
    const validatedData = validateJoinRoomData(socket, joinRoomData)
    if (!validatedData) return
    const { roomId, username } = validatedData
    const timePerDraw = joinRoomData.timePerDraw ?? 90
    const roundCount = joinRoomData.roundCount ?? 2
    await joinRoom(socket, roomId, username, joinRoomData.Avatar, true, timePerDraw, roundCount)
  })

  socket.on('join-room', async (joinRoomData: JoinRoomData) => {
    const validatedData = validateJoinRoomData(socket, joinRoomData)
    if (!validatedData) return
    const { roomId, username } = validatedData

    if (isRoomCreated(roomId)) {
      return joinRoom(socket, roomId, username, joinRoomData.Avatar, false)
    }

    socket.emit('room-not-found', {
      message: "Oops! The Room ID you entered doesn't exist or hasn't been created yet.",
    })
  })

  socket.on('client-ready', async (roomId: string) => {
    const members = await getRoomMembers(roomId)
    if (members.length === 1) return socket.emit('client-loaded')

    const adminMember = members[0]
    if (!adminMember) return

    socket.to(adminMember.id).emit('get-canvas-state')
  })

  socket.on(
    'send-canvas-state',
    async ({ canvasState, roomId }: { canvasState: string; roomId: string }) => {
      const members = await getRoomMembers(roomId)
      const lastMember = members[members.length - 1]
      if (!lastMember) return

      const room = await getRoom(roomId)
      if (!room) return

      socket.to(lastMember.id).emit('canvas-state-from-server', {
        canvasState,
        gameState: room.gameState,
      })
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
      io.to(roomId).emit('recieve-broadcasted-message', { message, userid, username })
    }
  )

  const selectNextDrawer = async (roomId: string) => {
    const room = await getRoom(roomId)
    if (!room) return

    room.gameState.guessedWordUserState = {}
    const { gameState } = room
    const { currentRound, drawings, totalRounds, maxDrawingsPerRound } = gameState

    if (currentRound <= totalRounds) {
      console.log('inside here ', currentRound, totalRounds)

      const eligibleDrawers = Object.entries(drawings)
        .filter(([, draws]) => draws < maxDrawingsPerRound)
        .map(([userId]) => userId)

      if (eligibleDrawers.length > 0) {
        const randomIndex = Math.floor(Math.random() * eligibleDrawers.length)
        gameState.drawer = eligibleDrawers[randomIndex]
        drawings[gameState.drawer]++
      } else {
        gameState.currentRound++
        for (const userId in drawings) {
          drawings[userId] = 0
        }
        await updateRoom(roomId, room)
        return selectNextDrawer(roomId)
      }
    } else {
      room.gameState.gameState = 'finished'
    }

    await updateRoom(roomId, room)
  }

  socket.on('drawerchoosingword', async ({ roomId, id, type }: any) => {
    const room = await getRoom(roomId)
    if (!room) return

    if (type === 'change') {
      room.gameState.gameState = 'choosing-word'
      await updateRoom(roomId, room)
      await selectNextDrawer(roomId)
    } else {
      room.gameState.gameState = 'choosing-word'
      room.gameState.drawer = id
      await updateRoom(roomId, room)
    }
    await getGameState(roomId)
  })

  socket.on('selectword', async ({ roomId, id, word }: any) => {
    const room = await getRoom(roomId)
    if (!room) return

    const timePerDrawMs = (room.gameState.timePerDraw ?? 90) * 1000
    room.gameState.drawer = id
    room.gameState.gameState = 'guessing-word'
    room.gameState.lastGuesstime = Date.now() + timePerDrawMs
    room.gameState.word = word
    await updateRoom(roomId, room)
    await getGameState(roomId)
    io.to(roomId).emit('wordselected', word)
  })

  socket.on(
    'change-drawer',
    async ({ roomId, newdrawer }: { roomId: string; newdrawer: string }) => {
      const room = await getRoom(roomId)
      if (!room) return

      room.gameState.drawer = newdrawer
      await updateRoom(roomId, room)
      await getGameState(roomId)
    }
  )

  socket.on('start-game', async ({ roomId }: { roomId: string }) => {
    const members = await getRoomMembers(roomId)
    const room = await getRoom(roomId)
    if (!room) return

    room.gameState.gameState = 'started'
    room.gameState.drawer = members[0].id
    room.gameState.currentRound = 1
    await updateRoom(roomId, room)
    io.to(roomId).emit('game-started', room.gameState)
  })

  socket.on(
    'set-words-indicator',
    ({ roomId, exposedWords }: { roomId: string; exposedWords: number[] }) => {
      io.to(roomId).emit('get-words-indicator', exposedWords)
    }
  )

  const updateScore = async (roomId: string) => {
    const room = await getRoom(roomId)
    if (!room) return

    io.to(roomId).emit('clear-canvas')
    const { gameState } = room
    const { guessedWordUserState, drawer } = gameState
    const totalPlayers = Object.keys(guessedWordUserState || {}).length
    let correctGuesses = 0

    for (const [userId, guessState] of Object.entries(guessedWordUserState || {})) {
      if (guessState.isGuessed && !!gameState?.score[userId]) {
        correctGuesses++
        const guessTime = guessState.guessedTime
        let points = 0
        if (guessTime <= 30) {
          points = 175
        } else if (guessTime <= 60) {
          points = 125
        } else {
          points = 75
        }
        // Update Sorted Set (ranking source of truth) and mirror new total into room JSON
        const newScore = await incrementScore(roomId, userId, points)
        gameState.score[userId].score = newScore
      }
    }

    // Bonus for the drawer if more than 50% guessed correctly
    if (correctGuesses / totalPlayers > 0.5) {
      const newDrawerScore = await incrementScore(roomId, drawer, 100)
      if (gameState.score[drawer]) {
        gameState.score[drawer].score = newDrawerScore
      }
    }

    await updateRoom(roomId, room)
    await getGameState(roomId)
  }

  socket.on('update-scorecard', async ({ roomId }: { roomId: string }) => {
    const room = await getRoom(roomId)
    if (!room) return
    await updateScore(roomId)
  })

  socket.on('guessed-word', async ({ userId, roomId, guessedTime }: any) => {
    const room = await getRoom(roomId)
    if (!room) return

    room.gameState.guessedWordUserState = {
      ...room.gameState.guessedWordUserState,
      [userId]: { isGuessed: true, guessedTime },
    }
    await updateRoom(roomId, room)
    await getGameState(roomId)

    // Check if all non-drawer players have guessed — if so, end the round early
    const { drawer, guessedWordUserState } = room.gameState
    const nonDrawers = room.user.filter(u => u.id !== drawer)
    const allGuessed =
      nonDrawers.length > 0 &&
      nonDrawers.every(u => guessedWordUserState?.[u.id]?.isGuessed)

    if (allGuessed) {
      // Force the timer to expire immediately for all clients
      room.gameState.lastGuesstime = Date.now()
      await updateRoom(roomId, room)
      await updateScore(roomId)
    }
  })

  // Returns the room leaderboard sorted by score descending — used for end-of-round ranked display
  socket.on('get-leaderboard', async (roomId: string) => {
    const leaderboard = await getLeaderboard(roomId)
    socket.emit('leaderboard-from-server', leaderboard)
  })

  socket.on('clear-canvas', (roomId: string) => {
    socket.to(roomId).emit('clear-canvas')
  })

  socket.on(
    'undo',
    ({ canvasState, roomId }: { canvasState: string; roomId: string }) => {
      socket.to(roomId).emit('undo-canvas', canvasState)
    }
  )

  socket.on('get-last-undo-point', async (roomId: string) => {
    const lastUndoPoint = await getLastUndoPoint(roomId)
    socket.emit('last-undo-point-from-server', lastUndoPoint)
  })

  socket.on(
    'add-undo-point',
    async ({ roomId, undoPoint }: { roomId: string; undoPoint: string }) => {
      await addUndoPoint(roomId, undoPoint)
    }
  )

  socket.on('delete-last-undo-point', async (roomId: string) => {
    await deleteLastUndoPoint(roomId)
  })

  socket.on('leave-room', async (roomId: string) => {
    await leaveRoom(socket, roomId)
  })

  socket.on('disconnect', async () => {
    socket.emit('disconnected')
    await leaveRoom(socket)
  })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => console.log(`Server is running on port ${PORT} now!`))
