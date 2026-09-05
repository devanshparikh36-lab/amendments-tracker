export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto mt-20 max-w-sm rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-lg font-semibold">Regulation Tracker</h1>
      <form method="post" action="/api/login" className="space-y-3">
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label className="block text-sm text-stone-700">
          Team passcode
          <input
            type="password"
            name="passcode"
            autoFocus
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 focus:border-stone-500 focus:outline-none"
          />
        </label>
        {sp.error && <p className="text-sm text-red-600">Incorrect passcode.</p>}
        <button type="submit" className="w-full rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700">
          Enter
        </button>
      </form>
    </div>
  );
}
