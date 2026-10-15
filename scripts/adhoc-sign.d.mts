export function adHocOptions<T extends Record<string, unknown>>(
  opts: T,
): T & { identity: '-'; identityValidation: false }
export default function sign(opts: Record<string, unknown>): Promise<void>
