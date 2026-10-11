"use client";

/* Prints the provision, which on every current browser is also how you save it as a PDF.
 *
 * Worth a button rather than leaving it to Ctrl-P. The print layout here is not the screen with the
 * furniture removed -- it gains a header stating what the document is, the date the text speaks as of and
 * the official source, and loses the navigation. Nobody discovers that by guessing, and "give me this
 * section as a file I can put in the papers" is one of the two things a practitioner wants to do with a
 * provision. (The other is cite it, which is the button beside this one.)
 *
 * A client component for one line, because `window.print()` has to run in the browser. Deliberately not a
 * server-generated .docx: that needs a zip writer and an OOXML document, which is a dependency and a
 * decision about build weight that is not mine to make quietly. The browser's own print-to-PDF produces a
 * better-looking document today than a hand-rolled .docx would.
 */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn no-print">
      {label}
    </button>
  );
}
