export function compressImage(file, maxWidth = 1920, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(file)
      return
    }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (img.width <= maxWidth && file.type !== 'image/gif') {
        resolve(file)
        return
      }
      const scale = maxWidth / img.width
      const canvas = document.createElement('canvas')
      canvas.width = maxWidth
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size < file.size) {
            const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
            resolve(compressed)
          } else {
            resolve(file)
          }
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => resolve(file)
    img.src = url
  })
}
