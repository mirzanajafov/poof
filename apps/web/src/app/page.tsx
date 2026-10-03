import { LiveDashboard } from '@/components/LiveDashboard'
import { api } from '@/lib/api'
import type { Dataset } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const datasets = (await api<Dataset[]>('/datasets')) ?? []
  return (
    <>
      <section className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">A box of workers that knows when to ask for help</h1>
        <p className="mt-2 text-muted">
          Each batch of photos has a deadline. The box predicts the work from the image sizes, hands it out ten images at a time to
          whichever task is due first, and turns away what it cannot finish. Below that, you can let the naive version run the box
          for a minute and watch what happens when workers that fall behind call helpers, who call helpers.
        </p>
      </section>
      <LiveDashboard datasets={datasets} />
    </>
  )
}
