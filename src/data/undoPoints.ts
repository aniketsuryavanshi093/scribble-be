import { redis } from '@/lib/redis'

function undoKey(roomId: string) {
  return `scribble:undo:${roomId}`
}

export async function addUndoPoint(roomId: string, undoPoint: string): Promise<void> {
  await redis.rpush(undoKey(roomId), undoPoint)
  await redis.expire(undoKey(roomId), 7200)
}

export async function getLastUndoPoint(roomId: string): Promise<string | null> {
  const results = await redis.lrange(undoKey(roomId), -1, -1)
  return results[0] ?? null
}

export async function deleteLastUndoPoint(roomId: string): Promise<void> {
  await redis.rpop(undoKey(roomId))
}
