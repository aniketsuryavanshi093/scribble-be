export interface JoinRoomData {
  roomId: string
  username: string
  Avatar: Record<
    any,
    {
      x: number
      y: number
    }
  >
}

export interface User {
  id: string
  Avatar: Record<
    any,
    {
      x: number
      y: number
    }
  >
  username: string
  roomId: string
}
export interface GameStateType {
  gameState: 'started' | 'not-started' | 'choosing-word' | 'guessing-word'
  drawer: string
  word: string
  lastGuesstime?: number
  guessedWordUserState?: Record<
    string,
    {
      isGuessed: boolean
      guessedTime: number
    }
  > | null
  score: Scoretype
  currentRound: number
  drawings: Record<string, number> // Track how many times each user has drawn
  totalRounds: number // Total number of rounds in the game
  maxDrawingsPerRound: number // Max drawings per round per user
}

export type Scoretype = Record<
  string,
  {
    score: number
    worddrawoccurance: string
  }
>
export interface Point {
  x: number
  y: number
}

export interface DrawProps {
  ctx: CanvasRenderingContext2D
  currentPoint: Point
  prevPoint: Point | undefined
}

export interface DrawOptions extends DrawProps {
  strokeColor: string
  strokeWidth: number[]
  dashGap: number[]
}
