import type { RfwApi } from '../shared/types'

declare global {
  interface Window {
    rfw: RfwApi
  }
}
