import { describe, expect, it } from 'vitest'
import { sensitivity } from '../diagnose/sensitivity'
import { applyPatch, templateById } from '../presets/templates'
import { defaultRunConfig, serialLine } from '../presets/builders'

describe('auto-sensibilidad', () => {
  it('solo la restriccion mueve el throughput', () => {
    // 8 / 8 / 20 / 8: acelerar la Est.3 un 10% da ~10% mas de salida;
    // acelerar cualquier otra da cero. Es el argumento de TOC, medido.
    const tpl = templateById('bottleneck')!
    const model = applyPatch(tpl.model, {})
    const r = sensitivity(model)

    expect(r.stations[0]!.label).toBe('Est.3')
    expect(r.stations[0]!.deltaThroughput).toBeGreaterThan(0.09)
    for (const s of r.stations.slice(1)) {
      expect(Math.abs(s.deltaThroughput)).toBeLessThan(0.01)
    }
  })

  it('en una linea pareja, mejorar una sola estacion casi no mueve nada', () => {
    const model = serialLine([{ cycleTime: 10 }, { cycleTime: 10 }, { cycleTime: 10 }], {
      line: { flowControl: 'conwip', wipLimit: 10, timeUnit: 'sec' },
      source: { mode: 'unlimited' },
      run: { maxCompletions: 20_000, warmup: 1_000 },
    })
    const r = sensitivity(model)
    // Con tres estaciones iguales, acelerar una sola no puede dar el 10%
    // completo: las otras dos siguen marcando el paso.
    expect(r.stations[0]!.deltaThroughput).toBeLessThan(0.05)
  })
})
