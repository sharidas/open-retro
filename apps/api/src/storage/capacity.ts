const messages = {
  RETRO_ROOM_LIMIT: 'The server has reached its 1000-room storage limit. Try again after rooms are deleted or cleaned up.',
  RETRO_PARTICIPANT_LIMIT: 'This room has reached its limit of 100 joined browser sessions.',
  RETRO_CARD_LIMIT: 'Card limit reached: at most 50 cards per participant and 500 per room. Remove an existing card before adding another.',
} as const

export function capacityError(error: unknown) {
  // Drizzle wraps driver errors. Match only known constraint messages, never
  // return SQL, parameters, or arbitrary database error text to the browser.
  let current = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const value = current as { code?: string; message?: string; cause?: unknown }
    if (value.code?.startsWith('SQLITE_CONSTRAINT')) {
      for (const [code, message] of Object.entries(messages)) {
        if (value.message === code || value.message?.endsWith(`: ${code}`)) return { error: code, message }
      }
    }
    current = value.cause
  }
  return undefined
}
