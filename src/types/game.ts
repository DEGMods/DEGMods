/**
 * Types for Game Database
 */

export interface GameEntry {
  name: string
  wideImage?: string    // 16:9 image URL
  boxartImage?: string  // boxart image URL
}

export interface GameDbCsvFile {
  hash: string
  games: GameEntry[]
}
