import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage } from './image.ts'

describe('compressImage', () => {
  const originalImage = global.Image
  const originalCreateElement = global.document.createElement
  let toBlobCallback: ((blob: Blob | null) => void) | null = null
  let drawImageCalls: unknown[][] = []

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
      onload: (() => void) | null = null
      width = 800
      height = 600
      constructor() {
        setTimeout(() => this.onload && this.onload(), 0)
      }
    }
    global.Image = MockImage as unknown as typeof Image

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file, 1920)
    expect(result).toBe(file)
  })

  it('compresses image when width exceeds maxWidth', async () => {
    class MockImage {
      onload: (() => void) | null = null
      width = 4000
      height = 3000
      constructor() {
        setTimeout(() => this.onload && this.onload(), 0)
      }
    }
    global.Image = MockImage as unknown as typeof Image

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (...args: unknown[]) => drawImageCalls.push(args),
      }),
      toBlob: (cb: (blob: Blob | null) => void) => {
        toBlobCallback = cb
      },
    }
    global.document.createElement = (tag: string) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLElement
      return originalCreateElement.call(global.document, tag)
    }

    const file = new File(['img'], 'photo.png', { type: 'image/png' })
    const promise = compressImage(file, 1920, 0.85)

    // Wait for MockImage onload (setTimeout 0) to fire
    await new Promise((r) => setTimeout(r, 10))

    expect(toBlobCallback).toBeTypeOf('function')
    const smallerBlob = new Blob(['sm'], { type: 'image/jpeg' })
    if (toBlobCallback) toBlobCallback(smallerBlob)

    const result = await promise
    expect(result).not.toBe(file)
    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('photo.jpg')
    expect(drawImageCalls.length).toBeGreaterThan(0)
  })

  it('falls back to original when compressed blob is larger', async () => {
    class MockImage {
      onload: (() => void) | null = null
      width = 4000
      height = 3000
      constructor() {
        setTimeout(() => this.onload && this.onload(), 0)
      }
    }
    global.Image = MockImage as unknown as typeof Image

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
      }),
      toBlob: (cb: (blob: Blob | null) => void) => {
        toBlobCallback = cb
      },
    }
    global.document.createElement = (tag: string) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLElement
      return originalCreateElement.call(global.document, tag)
    }

    const bigContent = new Array(1000).fill('x').join('')
    const file = new File([bigContent], 'photo.png', { type: 'image/png' })
    const promise = compressImage(file, 1920, 0.85)

    // Wait for MockImage onload (setTimeout 0) to fire
    await new Promise((r) => setTimeout(r, 10))

    expect(toBlobCallback).toBeTypeOf('function')
    const largerBlob = new Blob(new Array(2000).fill('y'), { type: 'image/jpeg' })
    if (toBlobCallback) toBlobCallback(largerBlob)

    const result = await promise
    expect(result).toBe(file)
  })
})
