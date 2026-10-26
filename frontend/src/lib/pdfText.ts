// Reads the text of a PDF in the browser, one line per printed row, so a bank statement
// can go through the same reader as a pasted one. The file never leaves the browser.
// pdf.js is loaded only when a PDF is picked, to keep it out of the main bundle.

export class PdfPasswordError extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? "That password did not open the PDF." : "This PDF is locked with a password.");
  }
}

type Bit = { x: number; y: number; s: string };

export async function pdfText(file: File, password?: string): Promise<string> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err.name === "PasswordException") throw new PdfPasswordError(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    throw new Error("Could not read this PDF. Copy its lines and paste them instead.");
  }
  try {
    const out: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const bits: Bit[] = [];
      for (const it of (await page.getTextContent()).items) {
        if ("str" in it && it.str.trim()) bits.push({ x: it.transform[4] as number, y: it.transform[5] as number, s: it.str.trim() });
      }
      // Pieces printed on the same row (within 3 points up or down) become one line, left to right.
      const rows: Bit[][] = [];
      for (const b of bits.sort((a, c) => c.y - a.y)) {
        const row = rows.find((r) => Math.abs(r[0]!.y - b.y) <= 3);
        if (row) row.push(b);
        else rows.push([b]);
      }
      for (const r of rows) out.push(r.sort((a, c) => a.x - c.x).map((b) => b.s).join("  "));
    }
    return out.join("\n");
  } finally {
    await doc.destroy();
  }
}
