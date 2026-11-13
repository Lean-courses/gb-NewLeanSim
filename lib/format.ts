/**
 * Formateo de magnitudes para pantalla.
 *
 * Una regla: nunca mostrar mas precision de la que el numero tiene. Un lead
 * time de "7,4999999 min" le dice al cliente que la herramienta no sabe lo que
 * esta haciendo.
 */

export function duration(ms: number, locale = 'es'): string {
  if (!Number.isFinite(ms)) return '-'
  if (ms < 1_000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${trim(ms / 1_000)} s`
  if (ms < 3_600_000) return `${trim(ms / 60_000)} ${locale === 'es' ? 'min' : 'min'}`
  if (ms < 86_400_000) return `${trim(ms / 3_600_000)} h`
  return `${trim(ms / 86_400_000)} ${locale === 'es' ? 'd' : 'd'}`
}

/**
 * Separador de miles con espacio fino irrompible.
 *
 * Ni punto ni coma: la app es bilingue y "1.169" se lee como mil ciento
 * sesenta y nueve en espanol y como uno coma uno seis nueve en ingles. El
 * espacio fino no es ambiguo en ningun idioma.
 */
const THIN = '\u202f'

function group(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN)
}

export function rate(perHour: number): string {
  if (!Number.isFinite(perHour)) return '-'
  if (perHour >= 1000) return group(perHour)
  if (perHour >= 100) return perHour.toFixed(0)
  return perHour.toFixed(1)
}

export function units(n: number): string {
  if (!Number.isFinite(n)) return '-'
  if (n >= 1000) return group(n)
  if (n >= 10) return n.toFixed(0)
  return n.toFixed(1)
}

export function percent(frac: number, digits = 0): string {
  if (!Number.isFinite(frac)) return '-'
  return `${(frac * 100).toFixed(digits)}%`
}

/** Delta relativo con signo, para las tablas de comparacion A/B. */
export function delta(from: number, to: number): { text: string; sign: -1 | 0 | 1 } {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) {
    return { text: '-', sign: 0 }
  }
  const d = (to - from) / Math.abs(from)
  const sign = d > 0.001 ? 1 : d < -0.001 ? -1 : 0
  if (sign === 0) return { text: '=', sign: 0 }
  return { text: `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%`, sign }
}

function trim(v: number): string {
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2).replace(/\.?0+$/, '')
}
