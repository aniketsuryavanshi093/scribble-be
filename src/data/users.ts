import type { User } from '@/types'

// let users: User[] = []

let rooms: Record<string, User[]> = {}

// const getUser = (userId: string) => users.find(user => user.id === userId)
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

export { getUser, getRoomMembers, addUser, removeUser }
