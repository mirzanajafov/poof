'use client'

import { seconds } from '@/lib/format'
import { useNow } from './useNow'

export function Remaining({ until }: { until: number }) {
  return <span suppressHydrationWarning>{seconds(Math.max(0, until - useNow(1000)))}</span>
}
