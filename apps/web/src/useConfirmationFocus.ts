import { useLayoutEffect, useRef } from 'react'

// Inline confirmations replace their trigger. Keep the user's place without
// focusing the destructive action or stealing focus during ordinary polling.
export function useConfirmationFocus(open: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const warningRef = useRef<HTMLParagraphElement>(null)
  const previous = useRef(open)
  useLayoutEffect(() => {
    if (open !== previous.current) {
      if (open) warningRef.current?.focus()
      else triggerRef.current?.focus()
    }
    previous.current = open
  }, [open])
  return { triggerRef, warningRef }
}
