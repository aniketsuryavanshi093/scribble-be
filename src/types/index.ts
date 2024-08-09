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
  gameState: 'started' | 'not-started' | 'choosing-word'
  drawer: string
  word: string
  score: Scoretype
  curentRound: number
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
