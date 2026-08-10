import PerspT from './perspT'

export function applyPerspectiveCrop(imageElement, srcCorners) {
  // srcCorners: [{x,y}, {x,y}, {x,y}, {x,y}] (tl, tr, br, bl)
  
  // Calculate approximate width and height of the destination
  const tl = srcCorners[0]
  const tr = srcCorners[1]
  const br = srcCorners[2]
  const bl = srcCorners[3]
  
  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y)
  const destWidth = Math.round(Math.max(widthTop, widthBottom))
  
  const heightLeft = Math.hypot(tl.x - bl.x, tl.y - bl.y)
  const heightRight = Math.hypot(tr.x - br.x, tr.y - br.y)
  const destHeight = Math.round(Math.max(heightLeft, heightRight))
  
  const srcPts = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]
  const dstPts = [0, 0, destWidth, 0, destWidth, destHeight, 0, destHeight]
  
  // We want to map from Destination -> Source so we can iterate over Destination pixels
  // and sample from Source pixels.
  const transform = PerspT(dstPts, srcPts)
  
  // Draw original image to an offscreen canvas to get its ImageData
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = imageElement.naturalWidth
  srcCanvas.height = imageElement.naturalHeight
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
  srcCtx.drawImage(imageElement, 0, 0)
  const srcImgData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)
  const srcData = new Uint32Array(srcImgData.data.buffer) // Using 32-bit for faster access
  
  // Create destination canvas
  const dstCanvas = document.createElement('canvas')
  dstCanvas.width = destWidth
  dstCanvas.height = destHeight
  const dstCtx = dstCanvas.getContext('2d')
  const dstImgData = dstCtx.createImageData(destWidth, destHeight)
  const dstData = new Uint32Array(dstImgData.data.buffer)
  
  const srcW = srcCanvas.width
  const srcH = srcCanvas.height
  
  for (let y = 0; y < destHeight; y++) {
    for (let x = 0; x < destWidth; x++) {
      // transform(dstX, dstY) -> [srcX, srcY]
      // To optimize, perspective-transform has `transform(x, y)` which returns an array.
      // But it's faster to inline the matrix multiplication if we pre-extract coefficients.
      // For simplicity, we'll just use the provided method, or inline it.
      
      const pt = transform.transform(x, y)
      const sx = Math.round(pt[0])
      const sy = Math.round(pt[1])
      
      if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
        dstData[y * destWidth + x] = srcData[sy * srcW + sx]
      } else {
        dstData[y * destWidth + x] = 0 // transparent/black outside bounds
      }
    }
  }
  
  dstCtx.putImageData(dstImgData, 0, 0)
  
  return new Promise((resolve, reject) => {
    dstCanvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to create blob'))
    }, 'image/jpeg', 0.9)
  })
}
