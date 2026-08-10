import React, { useState, useRef, useEffect } from 'react'

export default function PerspectiveCropper({ src, onComplete }) {
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const [corners, setCorners] = useState([
    { u: 0.1, v: 0.1 }, // Top-Left
    { u: 0.9, v: 0.1 }, // Top-Right
    { u: 0.9, v: 0.9 }, // Bottom-Right
    { u: 0.1, v: 0.9 }  // Bottom-Left
  ])
  const [draggingIdx, setDraggingIdx] = useState(null)
  const [draggingPolygon, setDraggingPolygon] = useState(false)
  const dragStartRef = useRef(null)

  // Provide the current pixel-based corners when requested
  useEffect(() => {
    if (onComplete && imgRef.current) {
      // Create a closure that calculates the actual pixels for the current state
      const getPixelCorners = () => {
        const img = imgRef.current
        if (!img) return null
        return corners.map(c => ({
          x: c.u * img.naturalWidth,
          y: c.v * img.naturalHeight
        }))
      }
      onComplete({
        getImageElement: () => imgRef.current,
        getCorners: getPixelCorners
      })
    }
  }, [corners, onComplete, src])

  const handlePointerDown = (index, e) => {
    e.preventDefault()
    e.stopPropagation()
    setDraggingIdx(index)
  }

  const handlePolygonPointerDown = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDraggingPolygon(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      initialCorners: [...corners]
    }
  }

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (draggingIdx === null && !draggingPolygon) return
      
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      
      if (draggingPolygon && dragStartRef.current) {
        const dx = (e.clientX - dragStartRef.current.x) / rect.width
        const dy = (e.clientY - dragStartRef.current.y) / rect.height
        
        setCorners(() => {
          let next = dragStartRef.current.initialCorners.map(c => ({ u: c.u + dx, v: c.v + dy }))
          
          // Clamp to ensure no corner goes out of bounds
          const minU = Math.min(...next.map(c => c.u))
          const maxU = Math.max(...next.map(c => c.u))
          const minV = Math.min(...next.map(c => c.v))
          const maxV = Math.max(...next.map(c => c.v))
          
          let offsetX = 0
          let offsetY = 0
          if (minU < 0) offsetX = -minU
          if (maxU > 1) offsetX = 1 - maxU
          if (minV < 0) offsetY = -minV
          if (maxV > 1) offsetY = 1 - maxV
          
          if (offsetX !== 0 || offsetY !== 0) {
            next = next.map(c => ({ u: c.u + offsetX, v: c.v + offsetY }))
          }
          return next
        })
        return
      }

      if (draggingIdx !== null) {
        let u = (e.clientX - rect.left) / rect.width
        let v = (e.clientY - rect.top) / rect.height
        
        // Clamp between 0 and 1
        u = Math.max(0, Math.min(1, u))
        v = Math.max(0, Math.min(1, v))
        
        setCorners(prev => {
          const next = [...prev]
          next[draggingIdx] = { u, v }
          return next
        })
      }
    }

    const handlePointerUp = () => {
      setDraggingIdx(null)
      setDraggingPolygon(false)
    }

    if (draggingIdx !== null || draggingPolygon) {
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [draggingIdx, draggingPolygon])

  const polygonPoints = corners.map(c => `${c.u * 100},${c.v * 100}`).join(' ')

  return (
    <div 
      ref={containerRef}
      style={{ 
        position: 'relative', 
        display: 'inline-block',
        touchAction: 'none' // Prevent scrolling while dragging
      }}
    >
      <img 
        ref={imgRef} 
        src={src} 
        style={{ 
          maxHeight: '70vh', 
          maxWidth: '100%', 
          display: 'block',
          userSelect: 'none',
          WebkitUserDrag: 'none'
        }} 
        alt="Crop target" 
      />
      
      {/* SVG overlay to draw the polygon area */}
      <svg 
        style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%', 
          pointerEvents: 'none',
          overflow: 'visible'
        }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <polygon 
          points={polygonPoints} 
          fill="rgba(59, 130, 246, 0.2)" 
          stroke="rgba(59, 130, 246, 0.8)" 
          strokeWidth="0.5" 
          vectorEffect="non-scaling-stroke"
          pointerEvents="auto"
          onPointerDown={handlePolygonPointerDown}
          style={{ cursor: 'move' }}
        />
        {/* Draw a dark overlay outside the polygon by creating a path with a hole */}
        <path 
          d={`M 0 0 L 100 0 L 100 100 L 0 100 Z M ${corners[0].u * 100} ${corners[0].v * 100} L ${corners[1].u * 100} ${corners[1].v * 100} L ${corners[2].u * 100} ${corners[2].v * 100} L ${corners[3].u * 100} ${corners[3].v * 100} Z`}
          fill="rgba(0, 0, 0, 0.5)"
          fillRule="evenodd"
        />
      </svg>
      
      {/* Draggable corner handles */}
      {corners.map((c, i) => (
        <div
          key={i}
          onPointerDown={(e) => handlePointerDown(i, e)}
          style={{
            position: 'absolute',
            left: `${c.u * 100}%`,
            top: `${c.v * 100}%`,
            width: 24,
            height: 24,
            transform: 'translate(-50%, -50%)',
            background: '#3b82f6',
            border: '2px solid white',
            borderRadius: '50%',
            cursor: 'move',
            zIndex: 10,
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
          }}
        />
      ))}
    </div>
  )
}
