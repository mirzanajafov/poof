'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function Refresh({ every }: { every: number }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), every)
    return () => clearInterval(timer)
  }, [router, every])
  return null
}
