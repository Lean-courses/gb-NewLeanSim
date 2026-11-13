import { describe, expect, it } from 'vitest'
import { simulate } from '../run'
import { defaultRunConfig, serialLine } from '../presets/builders'

describe('humo', () => {
  it('corre una linea de 3 estaciones y saca unidades', () => {
    const model = serialLine([{ cycleTime: 1 }, { cycleTime: 1 }, { cycleTime: 1 }], {
      source: { mode: 'unlimited', maxUnits: 10 },
    })
    const { result } = simulate(model, defaultRunConfig({ maxCompletions: 10 }))
    expect(result.kpis.completions).toBe(10)
    expect(result.kpis.leadTimeMean).toBeGreaterThan(0)
  })
})
