import { getKey } from '../src/crypto'

describe('generateHash()', () => {
  const data1 = {
    foo: 42,
    bar: {
      baz: [3, 2, 1],
      qux: 'hello',
      wow: {
        word: 'world',
        hey: {
          waldo: true,
          fred: null,
          missing: undefined
        }
      }
    }
  }

  const data2 = {
    bar: {
      baz: [1, 2, 3],
      wow: {
        hey: {
          fred: null,
          missing: undefined,
          waldo: true
        },
        word: 'world'
      },
      qux: 'hello'
    },
    foo: 42
  }

  const data3 = {
    bar: {
      qux: 'hello',
      baz: [3, 2, 1],
      wow: {
        hey: {
          fred: null,
          waldo: true,
          missing: undefined
        },
        word: 'world'
      }
    },
    foo: 42
  }

  it('should generate hash keys for objects with different key orders', () => {
    const hash1 = getKey(data1)
    const hash2 = getKey(data2)
    const hash3 = getKey(data3)

    expect(hash1).not.toEqual(hash2)
    expect(hash1).toEqual(hash3)
  })
})
