import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage } from './image.js'

describe('compressImage', () => {
  const originalImage = global.Image
  const originalCreateElement = global.document.createElement
  let toBlobCallback = null
  let drawImageCalls = []

  beforeEach(() => {
    toBlobCallback = null
    drawImageCalls = []
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    global.document.createElement = originalCreateElement
    global.Image = originalImage
  })

  it('returns original file for non-image', async () => {
    const file = new File(['text'], 'note.txt', { type: 'text/plain' })
    const result = await compressImage(file)
    expect(result).toBe(file)
  })

  it('returns original file when image width is within maxWidth', async () => {
    class MockImage {
      constructor() {
        setTimeout(() => this.onload && this.onload(), 0)
      }
      width = 800
      height = 600
    }
    global.Image = MockImage

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file, 1920)
    expect(result).toBe(file)
  })

  it('compresses image when width exceeds maxWidth', async () => {
    class MockImage {
      constructor() {
        setTimeout(() => this.onload && this.onload(), 0)
      }
      width = 4000
      height = 3000
    }
    global.Image = MockImage

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (...args) => drawImageCalls.push(args),
      }),
      toBlob: (cb) => {
        toBlobCallback = cb
      },
    }
    global.document.createElement = (tag) => {
      if (tag === 'canvas') return mockCanvas
      return originalCreateElement.call(global.document, tag)
    }

    const file = new File(['img'], 'photo.png', { type: 'image/png' })
    const promise = compressImage(file, 1920, 0.85)

    // Wait for MockImage onload (setTimeout 0) to fire
    await new Promise((r) => setTimeout(r, 10))

    expect(toBlobCallback).toBeTypeOf('function')
    const smallerBlob = new Blob(['sm'], { type: 'image/jpeg' })
    toBlobCallback(smallerBlob)

    const result = await promise
    expect(result).not.toBe(file)
    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('photo.jpg')
    expect(drawImageCalls.length).toBeGreaterThan(0)
  })

  it('falls back to original when compressed blob is larger', async () => {
    class MockImage {
      constructor() {
        setTimeout(() => this.onload && this.onload(), 0)
      }
      width = 4000
      height = 3000
    }
    global.Image = MockImage

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
      }),
      toBlob: (cb) => {
        toBlobCallback = cb
      },
    }
    global.document.createElement = (tag) => {
      if (tag === 'canvas') return mockCanvas
      return originalCreateElement.call(global.document, tag)
    }

    const bigContent = new Array(1000).fill('x').join('')
    const file = new File([bigContent], 'photo.png', { type: 'image/png' })
    const promise = compressImage(file, 1920, 0.85)

    // Wait for MockImage onload (setTimeout 0) to fire
    await new Promise((r) => setTimeout(r, 10))

    expect(toBlobCallback).toBeTypeOf('function')
    const largerBlob = new Blob(new Array(2000).fill('y'), { type: 'image/jpeg' })
    toBlobCallback(largerBlob)

    const result = await promise
    expect(result).toBe(file)
  })
})
