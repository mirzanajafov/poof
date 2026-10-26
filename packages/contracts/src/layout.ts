import { join } from 'node:path'
import type { PresetName } from '@poof/core'

export const outputExtensions: Readonly<Record<PresetName, string>> = {
  'webp-1600': 'webp',
  'avif-1600': 'avif',
  'thumb-320': 'jpg',
}

export function outputFileName(item: number, preset: PresetName): string {
  return `${item}.${outputExtensions[preset]}`
}

export function manifestPath(dir: string): string {
  return join(dir, 'manifest.json')
}

export function datasetsDir(dataDir: string): string {
  return join(dataDir, 'datasets')
}

export function datasetDir(dataDir: string, name: string): string {
  return join(datasetsDir(dataDir), name)
}

export function tasksDir(dataDir: string): string {
  return join(dataDir, 'tasks')
}

export function taskDir(dataDir: string, taskId: string): string {
  return join(tasksDir(dataDir), taskId)
}

export function inputDir(taskDir: string): string {
  return join(taskDir, 'input')
}

export function outputDir(taskDir: string): string {
  return join(taskDir, 'out')
}
