export const exitReasons = ['normal', 'crash', 'memory', 'timeout', 'heartbeat', 'killed'] as const

export type ExitReason = (typeof exitReasons)[number]
