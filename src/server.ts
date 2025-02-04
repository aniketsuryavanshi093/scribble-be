import 'module-alias/register'

import express from 'express'
import { Server, type Socket } from 'socket.io'
import http from 'http'
import cors from 'cors'
import { z } from 'zod'

import type { DrawOptions, GameStateType, JoinRoomData, Scoretype, User } from '@/types'
import { joinRoomSchema } from '@/lib/validations/joinRoom'
import { addUndoPoint, getLastUndoPoint, deleteLastUndoPoint } from '@/data/undoPoints'

const rooms: Record<string, { user: User[]; gameState: GameStateType }> = {}
const initializeGame = (
  user: User,
  roomId: string,
  totalRounds: number,
  maxDrawingsPerRound: number
) => {
  rooms[roomId] = {
    user: [user],
    gameState: {
      gameState: 'not-started',
      drawer: '',
      word: '',
      score: {},
      currentRound: 1,
      drawings: {},
      totalRounds,
      maxDrawingsPerRound,
    },
  }
  // Initialize drawing counts
  // for (let userId in rooms[roomId].user) {
  rooms[roomId].gameState.drawings[user?.id] = 1
  // }
}

const getUser = (userId: string, roomId?: string) => {
  if (roomId) {
    const roomMembers = rooms[roomId!]
    if (!roomMembers) return null
    return roomMembers.user.find(user => user.id === userId)
  } else {
    for (const element of Object.values(rooms)) {
      const user = element.user.find(user => user.id === userId)
      if (user) {
        return user
      }
    }
    return null
  }
}
const getRoomMembers = (roomId: string) => {
  const roomMembers = rooms[roomId]?.user
  if (!roomMembers) return []
  return roomMembers
}
const addUser = (user: User, roomId: string) => {
  if (!rooms[roomId]) {
    return initializeGame(user, roomId, 2, 1)
  }
  rooms[roomId].gameState.drawings[user?.id] = 0
  rooms[roomId].user.push(user)
}

const removeUser = (userId: string, roomId?: string) => {
  if (roomId) {
    if (!rooms[roomId]) return
    rooms[roomId] = {
      ...rooms[roomId],
      user: rooms[roomId].user.filter(user => user.id !== userId),
    }
    // @ts-ignore
    rooms[roomId].gameState.score[userId] = undefined
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
  Avatar: User['Avatar'],
  isAdmin: boolean
) {
  socket.join(roomId)
  const user = {
    id: socket.id,
    username,
    Avatar,
    roomId,
    isAdmin,
  }

  addUser(user, roomId)
  const members = getRoomMembers(roomId)
  rooms[roomId].gameState.score[user.id] = {
    score: 0,
    worddrawoccurance: '',
  }
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

function getGameState(roomId: string) {
  io.to(roomId).emit('recievegamestate', rooms[roomId].gameState)
}

io.on('connection', socket => {
  socket.on('create-room', (joinRoomData: JoinRoomData) => {
    const validatedData = validateJoinRoomData(socket, joinRoomData)

    if (!validatedData) return
    const { roomId, username } = validatedData
    joinRoom(socket, roomId, username, joinRoomData.Avatar, true)
  })

  socket.on('join-room', (joinRoomData: JoinRoomData) => {
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

      socket.to(lastMember.id).emit('canvas-state-from-server', {
        canvasState,
        gameState: rooms[roomId].gameState,
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
      io.to(roomId).emit('recieve-broadcasted-message', {
        message,
        userid,
        username,
      })
    }
  )
  const selectNextDrawer = (roomId: string) => {
    const room = rooms[roomId]
    if (!room) return
    room.gameState.guessedWordUserState = {}
    const { gameState } = room
    const { currentRound, drawings, totalRounds, maxDrawingsPerRound } = gameState

    if (currentRound <= totalRounds) {
      console.log('inside here ', currentRound, totalRounds)

      const eligibleDrawers = Object.entries(drawings)
        .filter(([userId, draws]) => draws < maxDrawingsPerRound)
        .map(([userId]) => userId)

      if (eligibleDrawers.length > 0) {
        const randomIndex = Math.floor(Math.random() * eligibleDrawers.length)
        gameState.drawer = eligibleDrawers[randomIndex]
        drawings[gameState.drawer]++ // Increment draw count for the selected drawer
      } else {
        // If all users have drawn the max number of times in the current round, start a new round
        gameState.currentRound++
        // Reset drawing counts for the new round
        for (let userId in drawings) {
          drawings[userId] = 0
        }
        // Recursive call to select the next drawer in the new round
        selectNextDrawer(roomId)
      }
    } else {
      rooms[roomId].gameState.gameState = 'finished'
    }

    // If 'change' is specified, select a random drawer who hasn't drawn twice in the current round
  }

  // Usage in the 'drawerchoosingword' socket event
  socket.on('drawerchoosingword', ({ roomId, id, type }: any) => {
    if (!rooms[roomId]) return
    if (type === 'change') {
      rooms[roomId].gameState.gameState = 'choosing-word'
      selectNextDrawer(roomId) // Select the next drawer based on the above logic
    } else {
      rooms[roomId].gameState.gameState = 'choosing-word'
      rooms[roomId].gameState.drawer = id
    }
    getGameState(roomId)
  })

  socket.on('selectword', ({ roomId, id, word }: any) => {
    if (rooms[roomId]) {
      rooms[roomId].gameState.drawer = id
      rooms[roomId].gameState.gameState = 'guessing-word'

      rooms[roomId].gameState.lastGuesstime = Date.now() + 90000
      rooms[roomId].gameState.word = word
      getGameState(roomId)
      io.to(roomId).emit('wordselected', word)
    }
  })

  socket.on(
    'change-drawer',
    ({ roomId, newdrawer }: { roomId: string; newdrawer: string }) => {
      if (!rooms[roomId]) return
      rooms[roomId].gameState.drawer = newdrawer
      // io.to(roomId).emit('drawer-changed-fromserver', rooms[roomId].gameState)
      getGameState(roomId)
    }
  )

  socket.on('start-game', ({ roomId }: { roomId: string }) => {
    const members = getRoomMembers(roomId)
    rooms[roomId].gameState.gameState = 'started'
    rooms[roomId].gameState.drawer = members[0].id
    rooms[roomId].gameState.currentRound = 1
    // members.forEach(member => {
    //   rooms[roomId].gameState.score[member.id] = {
    //     score: 0,
    //     worddrawoccurance: '',
    //   }
    // })
    io.to(roomId).emit('game-started', rooms[roomId].gameState)
  })

  socket.on(
    'set-words-indicator',
    ({ roomId, exposedWords }: { roomId: string; exposedWords: number[] }) => {
      if (!rooms[roomId]) return
      io.to(roomId).emit('get-words-indicator', exposedWords)
    }
  )

  // socket.on(
  //   'update-scorecard',
  //   ({ roomId, score }: { roomId: string; score: Scoretype }) => {
  //     if (!rooms[roomId]) return
  //     rooms[roomId].gameState.score = score
  //     // io.to(roomId).emit('updatedscorecard-fromserver', rooms[roomId].gameState)
  //     getGameState(roomId)
  //   }
  // )
  const updateScore = (roomId: string) => {
    const room = rooms[roomId]
    if (!room) return
    socket.emit('clear-canvas', roomId)
    const { gameState } = room
    const { guessedWordUserState, drawer } = gameState
    const totalPlayers = Object.keys(guessedWordUserState || {}).length
    let correctGuesses = 0

    for (const [userId, guessState] of Object.entries(guessedWordUserState || {})) {
      if (guessState.isGuessed && !!gameState?.score[userId]) {
        correctGuesses++
        const guessTime = guessState.guessedTime
        if (guessTime <= 30) {
          gameState.score[userId].score += 175
        } else if (guessTime <= 60) {
          gameState.score[userId].score += 125
        } else {
          gameState.score[userId].score += 75
        }
      }
    }

    // Bonus for the drawer if more than 50% guessed correctly
    if (correctGuesses / totalPlayers > 0.5) {
      gameState.score[drawer].score += 100
    }
    // Emit the updated scorecard to the room
    // io.to(roomId).emit('updatedscorecard-fromserver', gameState)
    getGameState(roomId)
  }

  // Usage in the 'update-scorecard' socket event
  socket.on('update-scorecard', ({ roomId }: { roomId: string }) => {
    if (!rooms[roomId]) return
    // rooms[roomId].gameState.score = score
    updateScore(roomId) // Call the function to update the scores
  })

  socket.on('guessed-word', ({ userId, roomId, guessedTime }: any) => {
    if (!rooms[roomId]) return
    if (rooms[roomId]) {
      rooms[roomId].gameState.guessedWordUserState = {
        ...rooms[roomId].gameState.guessedWordUserState,
        [userId]: {
          isGuessed: true,
          guessedTime,
        },
      }
      getGameState(roomId)
    }
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
