export type RoomSession = {
  id: string; role: 'participant' | 'facilitator'; credential: string | null;
  storageWarning: boolean; error?: string;
}
const validToken = (value: string | null): value is string => value !== null && /^[A-Za-z0-9_-]{43}$/.test(value)

function loadSession(): RoomSession | null {
  const match = /^\/rooms\/([0-9a-f-]{36})(\/facilitator)?\/?$/.exec(location.pathname)
  if (!match) return location.pathname.startsWith('/rooms/') ? {
    id: '', role: 'participant', credential: null, storageWarning: false,
    error: 'This room link is invalid. Check the link shared by your facilitator.',
  } : null
  const id = match[1]
  const role = match[2] ? 'facilitator' : 'participant'
  const session: RoomSession = { id, role, credential: null, storageWarning: false }
  const key = `open-retro:${role}:${id}`
  if (role === 'facilitator') {
    const fragment = new URLSearchParams(location.hash.slice(1))
    const incoming = fragment.get('secret')
    // Consume fragments before rendering or starting network requests. The
    // stripped URL is safe to copy; retain the original private link separately.
    if (location.hash) history.replaceState(null, '', location.pathname + location.search)
    if (incoming !== null) {
      if (!validToken(incoming)) return { ...session, error: 'This facilitator link is invalid. Use the original private link.' }
      session.credential = incoming
      try { sessionStorage.setItem(key, incoming) } catch { session.storageWarning = true }
    } else {
      try { session.credential = sessionStorage.getItem(key) } catch { session.storageWarning = true }
    }
    if (!validToken(session.credential)) session.error = 'Facilitator access is missing. Open the original private facilitator link in this tab.'
  } else {
    try {
      const saved = localStorage.getItem(key)
      const token = validToken(saved) ? saved : btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
      localStorage.setItem(key, token)
      session.credential = token
    } catch {
      session.error = 'Site storage is unavailable. Allow storage for this site, then reload to join anonymously.'
    }
  }
  return session
}

// One initialization per page load avoids duplicate token creation under React
// StrictMode. Repeated joins with the same room/token are idempotent on the API.
export const roomSession = loadSession()
