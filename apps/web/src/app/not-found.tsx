import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">Poof. Nothing here.</h1>
      <p className="mt-2 text-sm text-muted">
        That task or exhibit does not exist, or its results have expired.{' '}
        <Link href="/" className="text-accent-ink underline">
          Back to the box
        </Link>
      </p>
    </div>
  )
}
