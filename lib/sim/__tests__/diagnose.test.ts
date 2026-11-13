/**
 * El diagnostico tiene que acertar la restriccion en los casos donde la
 * utilizacion sola se equivoca. Si senala la estacion incorrecta, manda a
 * mejorar donde no hay nada que ganar - que es exactamente el error que la
 * herramienta existe para evitar.
 */

import { describe, expect, it } from 'vitest'
import { diagnoseBottleneck } from '../diagnose/bottleneck'
import { defaultRunConfig, serialLine } from '../presets/builders'
import { simulate } from '../run'
import { applyPatch, templateById } from '../presets/templates'

describe('diagnostico de la restriccion', () => {
  it('con la entrada sobrealimentando, no se queda con la primera saturada', () => {
    // 10 s / 15 s / 10 s alimentadas cada 8 s. La Est.1 y la Est.2 marcan las
    // dos 100% de utilizacion, pero la que manda es la de 15 s. Un ranking por
    // utilizacion senala la Est.1 y manda a mejorar donde no sirve.
    const model = serialLine(
      [{ cycleTime: 10 }, { cycleTime: 15 }, { cycleTime: 10 }],
      {
        line: { flowControl: 'push', timeUnit: 'sec' },
        source: { mode: 'interval', interval: 8, variability: 'none' },
      },
    )
    const r = simulate(model, defaultRunConfig({ horizon: 40_000, warmup: 0 })).result
    const st = r.nodes.filter((n) => n.type === 'process')
    // Se comprueba que efectivamente hay empate de utilizacion.
    expect(st[0]!.utilization).toBeGreaterThan(0.99)
    expect(st[1]!.utilization).toBeGreaterThan(0.99)

    const d = diagnoseBottleneck(model, r)
    expect(d.kind).toBe('constraint')
    expect(d.label).toBe('Est.2')
  })

  it('en una linea pareja no inventa una restriccion', () => {
    const model = serialLine([{ cycleTime: 10 }, { cycleTime: 10 }, { cycleTime: 10 }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'unlimited' },
    })
    const r = simulate(model, defaultRunConfig({ maxCompletions: 5_000, warmup: 500 })).result
    const d = diagnoseBottleneck(model, r)
    expect(d.kind).not.toBe('constraint')
  })

  it('si la linea sobra para la demanda, la restriccion esta afuera', () => {
    const model = serialLine([{ cycleTime: 10 }, { cycleTime: 10 }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'interval', interval: 40, variability: 'none' },
    })
    const r = simulate(model, defaultRunConfig({ maxCompletions: 2_000, warmup: 500 })).result
    const d = diagnoseBottleneck(model, r)
    expect(d.kind).toBe('demand-limited')
  })

  it('encuentra la restriccion en una linea desbalanceada bajo CONWIP', () => {
    // Bajo control de WIP la utilizacion se aplana por diseno, asi que es el
    // caso donde un ranking por utilizacion pierde resolucion.
    const tpl = templateById('bottleneck')!
    const model = applyPatch(tpl.model, {})
    const r = simulate(model, model.defaults).result
    const d = diagnoseBottleneck(model, r)
    expect(d.kind).toBe('constraint')
    expect(d.label).toBe('Est.3')
  })

  it('despues de mejorar la restriccion, senala la nueva', () => {
    const tpl = templateById('bottleneck')!
    const sc = tpl.scenarios.find((s) => s.id === 'improve-bottleneck')!
    const model = applyPatch(tpl.model, sc.patch)
    const r = simulate(model, model.defaults).result
    const d = diagnoseBottleneck(model, r)
    // Con 8 / 8 / 10 / 8 la nueva restriccion sigue siendo la Est.3, ahora al
    // 10 s: mejorarla una vez no la saca de restriccion.
    expect(d.label).toBe('Est.3')
  })
})
