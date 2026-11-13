/**
 * Orden de apilado y colores de los estados de una estacion.
 *
 * El orden NO es arbitrario: azul (espera operario) y fucsia (cambio) se
 * confunden bajo protanopia, asi que el ambar queda intercalado entre ambos.
 * Con ese orden la peor separacion entre segmentos vecinos es dE 15 bajo
 * daltonismo, por encima del piso. Cambiar el orden rompe esa garantia.
 */

import type { StateBreakdown } from '@/lib/sim/types/results'

export const STATE_ORDER = ['busy', 'setup', 'blocked', 'waitOp', 'down', 'starved'] as const

export type StateKey = (typeof STATE_ORDER)[number]

export const STATE_VAR: Record<StateKey, string> = {
  busy: 'var(--color-state-busy)',
  setup: 'var(--color-state-setup)',
  blocked: 'var(--color-state-blocked)',
  waitOp: 'var(--color-state-waitop)',
  down: 'var(--color-state-down)',
  starved: 'var(--color-state-starved)',
}

export function stateValue(b: StateBreakdown, k: StateKey): number {
  return b[k]
}
