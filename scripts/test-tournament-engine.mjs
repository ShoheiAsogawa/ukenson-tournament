import assert from 'node:assert/strict'
import {
  buildBracket,
  createInitialState,
  importEntries,
  recordResult,
  updatePlayerName,
} from '../src/lib/tournamentEngine.js'

function withPlayers(names) {
  return importEntries(
    createInitialState(),
    names.map((name) => ({ name })),
    'test',
  )
}

const eight = withPlayers(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
let state = recordResult(eight, 'w1-1', 'p1', 2, 1)
state = recordResult(state, 'w1-2', 'p3', 2, 0)
state = recordResult(state, 'w1-3', 'p5', 3, 1)
state = recordResult(state, 'w1-4', 'p7', 1, 0)
assert.ok(state.results['w1-1'])
assert.ok(state.results['w1-2'])
assert.ok(state.results['w1-3'])
assert.ok(state.results['w1-4'])

// Re-record w1-2 should keep parallel w1-3 / w1-4
state = recordResult(state, 'w1-2', 'p3', 3, 1)
assert.ok(state.results['w1-1'], 'w1-1 kept')
assert.ok(state.results['w1-2'], 'w1-2 updated')
assert.ok(state.results['w1-3'], 'parallel w1-3 kept')
assert.ok(state.results['w1-4'], 'parallel w1-4 kept')
assert.equal(state.results['w1-2'].scoreA, 3)

// Draw rejected
const noDraw = recordResult(eight, 'w1-1', 'p1', 1, 1)
assert.equal(Object.keys(noDraw.results).length, 0)

// Winner score must be higher
const badScore = recordResult(eight, 'w1-1', 'p1', 0, 2)
assert.equal(Object.keys(badScore.results).length, 0)

// Rename keeps results
const renamed = updatePlayerName(state, 'p1', 'Alpha')
assert.equal(renamed.players.find((p) => p.id === 'p1').name, 'Alpha')
assert.ok(renamed.results['w1-1'], 'rename keeps results')

// Clear name wipes progress
const cleared = updatePlayerName(state, 'p1', '')
assert.equal(Object.keys(cleared.results).length, 0)
assert.equal(cleared.timer, null)

// Import clears timer leftovers
const timed = { ...eight, timer: { matchId: 'w1-1', startedAt: new Date().toISOString() } }
const imported = importEntries(timed, [{ name: 'X' }, { name: 'Y' }], 'test')
assert.equal(imported.timer, null)
assert.equal(imported.lastFxEvent, null)

const bracket = buildBracket(state)
assert.ok(bracket.bracketSize >= 8)

console.log('tournamentEngine tests passed')
