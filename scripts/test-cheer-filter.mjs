import assert from 'node:assert/strict'
import { maskBlockedWords } from '../src/lib/cheerFilter.js'

assert.equal(maskBlockedWords('がんばれ'), 'がんばれ')
assert.equal(maskBlockedWords('死ね'), '**')
assert.equal(maskBlockedWords('がんばれ 死ね'), 'がんばれ **')
assert.equal(maskBlockedWords('し ね'), '* *')
assert.equal(maskBlockedWords('FUCK'), '****')
assert.equal(maskBlockedWords(`し${'\u200B'}ね`), '**')
assert.equal(maskBlockedWords(`し${'\u200B\u200B'}ね`), '**')
assert.equal(maskBlockedWords('シネ'), '**')
assert.match(maskBlockedWords('https://evil.example'), /^\*+evil\.example$/)

console.log('cheerFilter tests passed')
