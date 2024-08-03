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
