import { redis } from '@/lib/redis'

function lbKey(roomId: string) {
  return `scribble:leaderboard:${roomId}`
}

/**
 * Initialise a player's score at 0 in the Sorted Set (NX = only if not already present).
 * Called when a user joins a room.
 */
export async function initPlayerScore(roomId: string, userId: string): Promise<void> {
  await redis.zadd(lbKey(roomId), 'NX', 0, userId)
  await redis.expire(lbKey(roomId), 7200)
}

/**
 * Atomically add `points` to a player's score.
 * Returns the new total score.
 */
export async function incrementScore(
  roomId: string,
  userId: string,
  points: number
): Promise<number> {
  const newScore = await redis.zincrby(lbKey(roomId), points, userId)
  return parseFloat(newScore)
}

/**
 * Returns the full leaderboard for the room, sorted highest score first.
 * Shape: [{ userId, score }, ...]
 */
export async function getLeaderboard(
  roomId: string
): Promise<Array<{ userId: string; score: number }>> {
  // ZREVRANGE with WITHSCORES returns alternating [member, score, member, score, ...]
  const raw = await redis.zrevrange(lbKey(roomId), 0, -1, 'WITHSCORES')
  const result: Array<{ userId: string; score: number }> = []
  for (let i = 0; i < raw.length; i += 2) {
    result.push({ userId: raw[i], score: parseFloat(raw[i + 1]) })
  }
  return result
}

export async function deleteLeaderboard(roomId: string): Promise<void> {
  await redis.del(lbKey(roomId))
}
