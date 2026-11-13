/**
 * Distribuciones.
 *
 * El usuario nunca ve un parametro de distribucion: carga la MEDIA que ya
 * conoce (el tiempo de ciclo que midio) y elige Ninguna / Baja / Alta. El
 * mapeo a un CV y de ahi a una lognormal ocurre aca.
 *
 * Lognormal porque es estrictamente positiva, sesgada a la derecha (como los
 * tiempos de ciclo reales) y admite cualquier CV conservando la media exacta.
 */

import { CV_OF, type VarLevel } from '../types/model'
import type { RngBank } from './rng'

/** Todos los tiempos internos son milisegundos ENTEROS. */
export type SimTime = number

export interface Dist {
  /** Muestra un valor en ms enteros, >= 0. */
  sample(rng: RngBank, nodeIdx: number, stream: number): SimTime
  /** Media teorica en ms (para chequeos estaticos de capacidad). */
  readonly mean: SimTime
  /** Coeficiente de variacion teorico. */
  readonly cv: number
}

export function deterministic(meanMs: SimTime): Dist {
  const m = Math.max(0, Math.round(meanMs))
  return {
    mean: m,
    cv: 0,
    sample: () => m,
  }
}

export function exponential(meanMs: SimTime): Dist {
  const m = Math.max(0, meanMs)
  return {
    mean: Math.round(m),
    cv: 1,
    sample(rng, nodeIdx, stream) {
      // -m * ln(1-u) con u en [0,1); 1-u evita ln(0).
      const u = rng.u(nodeIdx, stream)
      return Math.max(0, Math.round(-m * Math.log(1 - u)))
    },
  }
}

/**
 * Lognormal con media y CV exactos.
 * Si X ~ LogNormal(mu, sigma) entonces E[X] = exp(mu + sigma^2/2) y
 * CV^2 = exp(sigma^2) - 1. Despejando: sigma^2 = ln(1 + CV^2),
 * mu = ln(media) - sigma^2/2.
 */
export function lognormal(meanMs: SimTime, cv: number): Dist {
  const m = Math.max(1e-9, meanMs)
  const s2 = Math.log(1 + cv * cv)
  const sigma = Math.sqrt(s2)
  const mu = Math.log(m) - s2 / 2
  // Guarda contra colas patologicas que congelen una demo. El tope es 20x la
  // media, no 8x: con 8x se recorta masa suficiente de la cola derecha como
  // para bajar el segundo momento y desviar la cola de espera varios puntos
  // respecto de la formula de Pollaczek-Khinchine. A 20x la probabilidad de
  // recorte es ~1e-6 y la guarda sigue cumpliendo su funcion.
  const lo = 0.02 * m
  const hi = 20 * m
  return {
    mean: Math.round(m),
    cv,
    sample(rng, nodeIdx, stream) {
      const z = normalStd(rng, nodeIdx, stream)
      const x = Math.exp(mu + sigma * z)
      if (x < lo) {
        clampedSamples++
        return Math.max(0, Math.round(lo))
      }
      if (x > hi) {
        clampedSamples++
        return Math.round(hi)
      }
      return Math.max(0, Math.round(x))
    },
  }
}

/** Contador global de muestras recortadas; distinto de cero es un aviso. */
export let clampedSamples = 0
export function resetClampedSamples(): void {
  clampedSamples = 0
}

/**
 * Normal estandar por Box-Muller.
 * Sin cache del segundo valor a proposito: cachear hace que el numero de
 * llamadas al generador dependa de la paridad del historial, lo que rompe la
 * reproducibilidad cuando un escenario consume una muestra mas que el otro.
 */
function normalStd(rng: RngBank, nodeIdx: number, stream: number): number {
  let u1 = rng.u(nodeIdx, stream)
  if (u1 < 1e-12) u1 = 1e-12
  const u2 = rng.u(nodeIdx, stream)
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * La unica fabrica que deberia usar el resto del motor para tiempos de
 * servicio, setup y traslado.
 */
export function makeDuration(meanMs: SimTime, level: VarLevel): Dist {
  const cv = CV_OF[level]
  if (cv === 0 || meanMs <= 0) return deterministic(meanMs)
  return lognormal(meanMs, cv)
}

/**
 * Llegadas. Con variabilidad alta usamos exponencial (Poisson), que es el caso
 * canonico de ensenanza, en vez de lognormal.
 */
export function makeArrival(meanMs: SimTime, level: VarLevel): Dist {
  if (level === 'none' || meanMs <= 0) return deterministic(meanMs)
  if (level === 'high') return exponential(meanMs)
  return lognormal(meanMs, CV_OF[level])
}

/** Bernoulli: true con probabilidad p. */
export function bernoulli(rng: RngBank, nodeIdx: number, stream: number, p: number): boolean {
  return rng.u(nodeIdx, stream) < p
}
