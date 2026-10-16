export function adHocOptions<T extends Record<string, unknown>>(
  opts: T,
): T & { identity: '-'; identityValidation: false }
export function withRetry<T>(
  task: () => Promise<T>,
  o?: { attempts?: number; delayMs?: number; log?: (message: string) => void },
): Promise<T>
export default function sign(opts: Record<string, unknown>): Promise<void>
