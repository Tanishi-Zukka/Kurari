const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** a < 戻り値 < b の小文字英数字 fractional key。null は各方向の開放端。 */
export function midKey(a: string | null, b: string | null): string {
  const lo = a ?? ''
  let hi = b
  let prefix = ''
  for (let i = 0; ; i++) {
    const dLo = i < lo.length ? Math.max(0, DIGITS.indexOf(lo[i])) : 0
    const dHi = hi !== null && i < hi.length ? Math.max(0, DIGITS.indexOf(hi[i])) : DIGITS.length
    if (dHi - dLo > 1) return prefix + DIGITS[Math.floor((dLo + dHi) / 2)]
    prefix += DIGITS[dLo]
    if (dHi - dLo === 1) hi = null
  }
}
