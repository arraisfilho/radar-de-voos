import qrcode from "qrcode-generator";

/** Light margin around the symbol, in modules: the 4 that ISO/IEC 18004 asks for. */
export const QR_QUIET_ZONE = 4;

/**
 * Dark modules of the QR code for `text`, row by row: error correction M and
 * the smallest version that fits. The otpauth:// address is ASCII (the server
 * percent-encodes it), so the library's byte mode keeps it as is.
 */
export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, column) => code.isDark(row, column)));
}

/**
 * One SVG path for the dark modules, shifted by the quiet zone: each run of
 * dark modules in a row is one rectangle ("M x y h width v 1 h -width z").
 * `size` is the side of the viewBox, quiet zone included.
 */
export function qrPath(matrix: boolean[][], quiet = QR_QUIET_ZONE): { size: number; path: string } {
  let path = "";
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x++;
      const width = x - start + 1;
      path += `M${start + quiet} ${y + quiet}h${width}v1h-${width}z`;
    }
  });
  return { size: matrix.length + 2 * quiet, path };
}
