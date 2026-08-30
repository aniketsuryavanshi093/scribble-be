import { redis } from '@/lib/redis'
import type { GameStateType, User } from '@/types'
import { deleteLeaderboard } from '@/data/leaderboard'

function undoKey(roomId: string) {
  return `scribble:undo:${roomId}`
}

type Room = { user: User[]; gameState: GameStateType }

function roomKey(roomId: string) {
  return `scribble:room:${roomId}`
}

export async function getRoom(roomId: string): Promise<Room | null> {
  const raw = await redis.get(roomKey(roomId))
  if (!raw) return null
  return JSON.parse(raw) as Room
}

export async function updateRoom(roomId: string, room: Room): Promise<void> {
  await redis.set(roomKey(roomId), JSON.stringify(room))
}

export async function initializeRoom(
  user: User,
  roomId: string,
  totalRounds: number,
  maxDrawingsPerRound: number,
  timePerDraw: number = 90
): Promise<void> {
  const room: Room = {
    user: [user],
    gameState: {
      gameState: 'not-started',
      drawer: '',
      word: '',
      score: {},
      currentRound: 1,
      drawings: { [user.id]: 1 },
      totalRounds,
      maxDrawingsPerRound,
      timePerDraw,
    },
  }
  await redis.set(roomKey(roomId), JSON.stringify(room))
  await redis.expire(roomKey(roomId), 7200)
}

export async function addUserToRoom(user: User, roomId: string): Promise<void> {
  const room = await getRoom(roomId)
  if (!room) {
    return initializeRoom(user, roomId, 2, 1, 90)
  }
  room.gameState.drawings[user.id] = 0
  room.user.push(user)
  await updateRoom(roomId, room)
}

export async function removeUserFromRoom(userId: string, roomId: string): Promise<void> {
  const room = await getRoom(roomId)
  if (!room) return
  room.user = room.user.filter(u => u.id !== userId)
  // @ts-ignore
  room.gameState.score[userId] = undefined
  await updateRoom(roomId, room)
}

export async function getRoomMembers(roomId: string): Promise<User[]> {
  const room = await getRoom(roomId)
  return room?.user ?? []
}

export async function getUser(userId: string, roomId?: string): Promise<User | null> {
  if (roomId) {
    const room = await getRoom(roomId)
    if (!room) return null
    return room.user.find(u => u.id === userId) ?? null
  }
  // No roomId — scan all room keys
  const keys = await redis.keys('scribble:room:*')
  for (const key of keys) {
    const raw = await redis.get(key)
    if (!raw) continue
    const room = JSON.parse(raw) as Room
    if (!Array.isArray(room.user)) continue
    const found = room.user.find(u => u.id === userId)
    if (found) return found
  }
  return null
}

export async function deleteRoom(roomId: string): Promise<void> {
  await redis.del(roomKey(roomId))
  await redis.del(undoKey(roomId))
  await deleteLeaderboard(roomId)
}
