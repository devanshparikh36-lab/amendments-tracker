// Word-level diff rendered server-side (no client JS). LCS on word tokens; fine for provision-sized texts.
function tokens(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

type Op = { type: "eq" | "del" | "ins"; text: string };

function diffWords(a: string, b: string): Op[] {
  const A = tokens(a), B = tokens(b);
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) {
    return [{ type: "del", text: a }, { type: "ins", text: b }];
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0, j = 0;
  const push = (type: Op["type"], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("eq", A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", A[i]); i++; }
    else { push("ins", B[j]); j++; }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("ins", B[j++]);
  return ops;
}

export function Diff({ before, after }: { before: string; after: string }) {
  const ops = diffWords(before, after);
  return (
    <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
      {ops.map((op, idx) =>
        op.type === "eq" ? (
          <span key={idx}>{op.text}</span>
        ) : op.type === "del" ? (
          <del key={idx} className="rounded bg-red-100 text-red-800 decoration-red-400">{op.text}</del>
        ) : (
          <ins key={idx} className="rounded bg-emerald-100 text-emerald-900 no-underline">{op.text}</ins>
        ),
      )}
    </pre>
  );
}
