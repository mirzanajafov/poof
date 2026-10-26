'use client'

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">The box did not answer.</h1>
      <p className="mt-2 text-sm text-muted">
        Something behind the dashboard failed, so this page could not load.{' '}
        <button type="button" onClick={reset} className="text-accent-ink underline">
          Try again
        </button>
      </p>
    </div>
  )
}
