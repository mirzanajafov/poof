'use client'

import type { Dataset } from '@/lib/types'
import { EventLog } from './EventLog'
import { ExhibitPanel } from './Exhibit'
import { Queue, Tiles, Workers } from './Pool'
import { PressTheButton } from './PressTheButton'
import { useLive } from './useLive'

export function LiveDashboard({ datasets }: { datasets: Dataset[] }) {
  const { connected, snapshot, events, processes, throughput } = useLive()
  const exhibitRunning = snapshot.exhibit !== null
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <PressTheButton datasets={datasets} />
        </div>
        <div className="space-y-4 lg:col-span-3">
          <Tiles live={snapshot.live} throughput={throughput} connected={connected} />
          {exhibitRunning ? (
            <p className="rounded-lg border border-line bg-warn-soft px-3 py-2 text-sm">
              An exhibit has the box right now. The pool is paused and new tasks are turned away until it ends.
            </p>
          ) : (
            <Workers live={snapshot.live} />
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Queue live={snapshot.live} />
        <EventLog events={events} />
      </div>
      <ExhibitPanel exhibit={snapshot.exhibit} processes={processes} />
    </div>
  )
}
