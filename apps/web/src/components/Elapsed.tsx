'use client'

import { seconds } from '@/lib/format'
import { useNow } from './useNow'

export function Elapsed({ since }: { since: number }) {
  return <span suppressHydrationWarning>{seconds(Math.max(0, useNow(1000) - since))}</span>
}
