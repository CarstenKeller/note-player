// The size in which the recognition reads a picture (the picture is made smaller to it first).

const MAX_PIXELS = 16_000_000;

/** The working size, as in the Android app: photos keep at least 2400 px on their short side. */
export function maxSideFor(width: number, height: number): number {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long <= 2400) return 2400;
  const keepShort = Math.floor(long * Math.min(1, 2400 / short));
  const pixelLimit = Math.floor(Math.sqrt((MAX_PIXELS * long) / short));
  return Math.max(2400, Math.min(keepShort, pixelLimit));
}
