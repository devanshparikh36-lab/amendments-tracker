export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="panel mx-auto mt-24 max-w-sm p-6">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">K C Mehta &amp; Co</p>
      <h1 className="serif mb-4 text-[20px] font-semibold">Regulation Tracker</h1>
      <form method="post" action="/api/login" className="space-y-3">
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label className="block text-[13px] text-[var(--ink-2)]">
          Team passcode
          <input type="password" name="passcode" autoFocus className="field mt-1 w-full py-2" />
        </label>
        {sp.error && <p className="text-[13px] text-[var(--flag-alert)]">Incorrect passcode.</p>}
        <button type="submit" className="btn btn-primary w-full justify-center py-2">
          Enter
        </button>
      </form>
    </div>
  );
}
