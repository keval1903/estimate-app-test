import { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import PerspectiveCropper from './PerspectiveCropper'
import { applyPerspectiveCrop } from '../lib/perspectiveCrop'
import 'react-image-crop/dist/ReactCrop.css' // We can keep it if other places use it, or just leave it
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'

// Helper to compress image
function compressImage(file, maxWidth = 1200) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        
        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }))
        }, 'image/jpeg', 0.7)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

const ROOM_TYPES = [
  'LIVING ROOM',
  'MAIN DOOR',
  'TV UNIT',
  'SHOE RACK',
  'ENTRANCE FOYER',
  'KITCHEN',
  'MASTER ROOM',
  'PARENTS ROOM',
  'KIDS ROOM',
  'GUEST ROOM'
]

const SelectionSheetTab = forwardRef(({ initialContent, tableData, clientName, siteName, partyName, isEditing, onUpdate, onTableUpdate }, ref) => {
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const imgRef = useRef(null)
  
  const [cropSrc, setCropSrc] = useState(null)
  const [cropperRef, setCropperRef] = useState(null)
  const [uploadingCrop, setUploadingCrop] = useState(false)
  const [fileNameForCrop, setFileNameForCrop] = useState('')
  const [exporting, setExporting] = useState(null)
  const [activeRoomDropdown, setActiveRoomDropdown] = useState(null)
  const [highlightedDropdownIndex, setHighlightedDropdownIndex] = useState(-1)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          style: 'max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0;',
        },
      }),
      Underline,
    ],
    content: initialContent || '',
    editable: isEditing,
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        style: 'min-height: 300px; outline: none;'
      },
      handlePaste: (view, event) => {
        if (!isEditing) return false
        const items = (event.clipboardData || event.originalEvent?.clipboardData)?.items
        if (!items) return false
        for (let index in items) {
          const item = items[index]
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            event.preventDefault()
            const blob = item.getAsFile()
            startCropping(blob)
            return true
          }
        }
        return false
      }
    },
    onUpdate: ({ editor }) => {
      if (onUpdate) onUpdate(editor.getHTML())
    }
  })

  const currentTableData = tableData && tableData.length > 0 ? tableData : [
    { roomType: '', sheetCode: '', remark: '', qty: '' },
    { roomType: '', sheetCode: '', remark: '', qty: '' },
    { roomType: '', sheetCode: '', remark: '', qty: '' }
  ]

  function handleTableChange(index, field, value) {
    const newData = [...currentTableData]
    newData[index] = { ...newData[index], [field]: value }
    if (onTableUpdate) onTableUpdate(newData)
  }

  function handleAddRow() {
    const newData = [...currentTableData, { roomType: '', sheetCode: '', remark: '', qty: '' }]
    if (onTableUpdate) onTableUpdate(newData)
  }

  const isTableEmpty = currentTableData.every(row => !row.roomType && !row.sheetCode && !row.remark && !row.qty)

  useEffect(() => {
    if (editor && editor.isEditable !== isEditing) {
      editor.setEditable(isEditing)
    }
  }, [isEditing, editor])

  useEffect(() => {
    if (editor && initialContent && editor.isEmpty) {
      editor.commands.setContent(initialContent)
    }
  }, [initialContent, editor])

  useImperativeHandle(ref, () => ({
    getHTML: () => {
      return editor ? editor.getHTML() : ''
    },
    resetContent: (html) => {
      if (editor) editor.commands.setContent(html || '')
    }
  }))

  async function processAndInsertImage(file) {
    if (!file.type.startsWith('image/')) return

    try {
      const compressedFile = await compressImage(file)
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('selection_images')
        .upload(fileName, compressedFile, { contentType: 'image/jpeg' })
        
      if (uploadError) throw uploadError
      
      const { data: publicData } = supabase.storage
        .from('selection_images')
        .getPublicUrl(fileName)
        
      if (editor && !editor.isDestroyed) {
        editor.chain().focus().setImage({ src: publicData.publicUrl }).run()
      }
      
    } catch (e) {
      alert('Error uploading image: ' + e.message)
    }
  }

  async function handleDownloadSelectedImage() {
    if (!editor) return
    const src = editor.getAttributes('image').src
    if (!src) return
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Selection_Image_${Date.now()}.jpg`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Could not download image. ' + e.message)
    }
  }

  async function handleCopySelectedImage() {
    if (!editor) return
    const src = editor.getAttributes('image').src
    if (!src) return
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ])
      // Just briefly flash something? or alert
      const btn = document.getElementById('btn-copy-img')
      if (btn) {
        const oldText = btn.innerText
        btn.innerText = 'Copied!'
        setTimeout(() => btn.innerText = oldText, 2000)
      }
    } catch (e) {
      alert('Could not copy image. ' + e.message)
    }
  }

  function handleDeleteSelectedImage() {
    if (editor) {
      editor.chain().focus().deleteSelection().run()
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (file) {
      startCropping(file)
    }
    e.target.value = ''
  }

  function startCropping(file) {
    if (!file.type.startsWith('image/')) return
    setCropperRef(null)
    setFileNameForCrop(file.name)
    const reader = new FileReader()
    reader.addEventListener('load', () => setCropSrc(reader.result?.toString() || ''))
    reader.readAsDataURL(file)
  }

  function rotateImage(degrees) {
    if (!cropSrc) return
    const image = new window.Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      
      if (Math.abs(degrees) % 180 !== 0) {
        canvas.width = image.naturalHeight
        canvas.height = image.naturalWidth
      } else {
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
      }
      
      const ctx = canvas.getContext('2d')
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((degrees * Math.PI) / 180)
      ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
      
      setCropSrc(canvas.toDataURL('image/jpeg', 1.0))
      setCropperRef(null)
    }
    image.src = cropSrc
  }

  async function finishCropping() {
    if (!cropperRef) return
    setUploadingCrop(true)
    
    try {
      const img = cropperRef.getImageElement()
      const corners = cropperRef.getCorners()
      
      const blob = await applyPerspectiveCrop(img, corners)
      const croppedFile = new File([blob], fileNameForCrop, { type: 'image/jpeg' })
      await processAndInsertImage(croppedFile)
        
      setCropSrc(null)
      setUploadingCrop(false)
      
    } catch (e) {
      alert('Error cropping: ' + e.message)
      setUploadingCrop(false)
    }
  }

  async function skipCropping() {
    if (!cropSrc) return
    setUploadingCrop(true)
    try {
      const res = await fetch(cropSrc)
      const blob = await res.blob()
      const file = new File([blob], fileNameForCrop, { type: blob.type })
      await processAndInsertImage(file)
      
      setCropSrc(null)
      setUploadingCrop(false)
    } catch (e) {
      alert('Error: ' + e.message)
      setUploadingCrop(false)
    }
  }

  async function generatePDF() {
    const { default: html2canvas } = await import('html2canvas')
    const { default: jsPDF } = await import('jspdf')

    const contentEl = document.querySelector('.selection-sheet-pdf-container')
    if (!contentEl) throw new Error('Content not found')

    const canvas = await html2canvas(contentEl, {
      scale: 2,
      useCORS: true,
      logging: false,
      onclone: (clonedDoc) => {
        const el = clonedDoc.querySelector('.selection-sheet-pdf-container')
        if (el) {
          el.style.width = '763px'
          el.style.maxWidth = 'none'
          el.style.fontSize = '16px'
          el.style.lineHeight = '1.6'
          el.style.padding = '24px'
          el.style.background = '#fff'
          el.style.boxSizing = 'border-box'

          // Remove all buttons (like 'Add Row' or formatting toolbar) from the PDF
          const buttons = el.querySelectorAll('button')
          buttons.forEach(btn => btn.remove())

          // Hide the table entirely if it's completely empty
          if (isTableEmpty) {
            const tableWrapper = el.querySelector('.selection-sheet-table-wrapper')
            if (tableWrapper) tableWrapper.style.display = 'none'
          }

          // Adjust inputs in cloned DOM to just show text (no borders) for cleaner PDF table
          const inputs = el.querySelectorAll('input, select')
          inputs.forEach(input => {
            const span = clonedDoc.createElement('span')
            span.textContent = input.value || (input.options ? input.options[input.selectedIndex]?.text : '') || ''
            if (!span.textContent.trim()) {
              span.style.display = 'inline-block'
              span.style.minHeight = '1.5em'
              span.style.width = '100%'
            }
            input.parentNode.replaceChild(span, input)
          })

          // Ensure any existing empty spans in view mode also don't collapse
          const spans = el.querySelectorAll('td span')
          spans.forEach(span => {
            if (!span.textContent.trim()) {
              span.style.display = 'inline-block'
              span.style.minHeight = '1.5em'
              span.style.width = '100%'
            }
          })

          // Inject custom header for PDF
          const headerDiv = clonedDoc.createElement('div')
          headerDiv.style.borderBottom = '2px solid #e2e8f0'
          headerDiv.style.paddingBottom = '16px'
          headerDiv.style.marginBottom = '24px'
          headerDiv.style.fontFamily = 'system-ui, -apple-system, sans-serif'
          
          const title = clonedDoc.createElement('h1')
          title.style.margin = '0 0 8px 0'
          title.style.fontSize = '24px'
          title.style.color = '#1e293b'
          
          let headerText = clientName || 'Selection Sheet'
          if (siteName) {
            headerText += ' - ' + siteName
          }
          title.innerText = headerText
          headerDiv.appendChild(title)

          if (partyName) {
            const party = clonedDoc.createElement('div')
            party.style.fontSize = '18px'
            party.style.color = '#475569'
            party.innerHTML = '<strong>Client Name:</strong> ' + partyName
            headerDiv.appendChild(party)
          }

          el.insertBefore(headerDiv, el.firstChild)
        }
      }
    })

    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()
    
    const margin = 10
    const drawW = pdfW - (margin * 2)
    const imgProps = pdf.getImageProperties(imgData)
    const imgRatio = imgProps.width / imgProps.height
    let drawH = drawW / imgRatio
    
    let heightLeft = drawH
    let position = 0
    let pageCount = 0

    while (heightLeft > 0) {
      if (pageCount > 0) pdf.addPage()
      pdf.addImage(imgData, 'JPEG', margin, margin + position, drawW, drawH)
      heightLeft -= (pdfH - margin * 2)
      position -= (pdfH - margin * 2)
      pageCount++
    }

    return pdf
  }

  async function handleSavePDF() {
    setExporting('pdf')
    try {
      const pdf = await generatePDF()
      pdf.save(`Selection_Sheet_${clientName || 'Untitled'}.pdf`)
    } catch (e) {
      alert('Error generating PDF: ' + e.message)
    } finally {
      setExporting(null)
    }
  }

  async function handleShare() {
    setExporting('share')
    try {
      const pdf = await generatePDF()
      const pdfBlob = pdf.output('blob')
      const file = new File([pdfBlob], `Selection_Sheet_${clientName || 'Untitled'}.pdf`, { type: 'application/pdf' })
      
      let canShareFiles = navigator.canShare && navigator.canShare({ files: [file] })
      
      if (canShareFiles) {
        await navigator.share({
          files: [file],
          title: `Selection Sheet - ${clientName || 'Untitled'}`,
          text: `Selection sheet for ${clientName || 'Untitled'}`
        })
      } else {
        const link = document.createElement('a')
        link.download = file.name
        link.href = URL.createObjectURL(file)
        link.click()
        setTimeout(() => URL.revokeObjectURL(link.href), 1000)
        alert('Direct sharing requires HTTPS. The PDF has been downloaded instead so you can share it manually.')
      }
    } catch (e) {
      alert('Error sharing: ' + e.message)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '500px' }}>
      <div style={{ padding: '0.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', background: '#f8fafc', borderBottom: '1px solid var(--border-light)' }}>
        <button className="btn btn-ghost" onClick={handleSavePDF} disabled={exporting === 'pdf'} title="Export PDF" style={{ padding: '0.4rem' }}>
          {exporting === 'pdf' ? '⏳' : '📄 PDF'}
        </button>
        <button className="btn btn-ghost" onClick={handleShare} disabled={exporting === 'share'} title="Share PDF" style={{ padding: '0.4rem' }}>
          {exporting === 'share' ? '⏳' : '📤 Share'}
        </button>
      </div>

      {isEditing && (
        <div style={{ 
          padding: '0.5rem 1rem', 
          display: 'flex', 
          gap: '0.5rem', 
          background: 'var(--surface-color)',
          borderBottom: '1px solid var(--border-light)',
          flexShrink: 0,
          flexWrap: 'wrap'
        }}>
          <button className={`btn btn-ghost ${editor?.isActive('bold') ? 'is-active' : ''}`} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold"><b>B</b></button>
          <button className={`btn btn-ghost ${editor?.isActive('italic') ? 'is-active' : ''}`} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic"><i>I</i></button>
          <button className={`btn btn-ghost ${editor?.isActive('underline') ? 'is-active' : ''}`} onClick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></button>
          <button className={`btn btn-ghost ${editor?.isActive('bulletList') ? 'is-active' : ''}`} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet List">• List</button>
          <div style={{ width: '1px', background: 'var(--border-light)', margin: '0 0.5rem' }}></div>
          <button className="btn btn-ghost" onClick={() => fileInputRef.current.click()} title="Insert Image">🖼️ Image</button>
          <button className="btn btn-ghost" onClick={() => cameraInputRef.current.click()} title="Take Photo">📷 Photo</button>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleFileChange} />
          <input type="file" ref={cameraInputRef} style={{ display: 'none' }} accept="image/*" capture="environment" onChange={handleFileChange} />
        </div>
      )}

      <div className="selection-sheet-pdf-container" style={{ flex: 1, overflowY: 'auto', background: '#fff', border: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column' }}>
        
        {/* The Structured Table */}
        {(!isTableEmpty || isEditing) && (
          <div className="selection-sheet-table-wrapper" style={{ padding: '1rem 1rem 0 1rem', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '550px', borderCollapse: 'collapse', marginBottom: '1rem', border: '1px solid #e2e8f0' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderRight: '1px solid #e2e8f0', width: '25%' }}>Room Type</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderRight: '1px solid #e2e8f0', width: '30%' }}>Sheet Code</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderRight: '1px solid #e2e8f0', width: '35%' }}>Remark</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', width: '10%' }}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {currentTableData.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.5rem', borderRight: '1px solid #e2e8f0', position: 'relative' }}>
                    {isEditing ? (
                      <div style={{ position: 'relative' }}>
                        <input 
                          type="text" 
                          autoComplete="off"
                          value={row.roomType} 
                          onChange={e => {
                            handleTableChange(i, 'roomType', e.target.value)
                            setHighlightedDropdownIndex(-1)
                          }}
                          onFocus={() => {
                            setActiveRoomDropdown(i)
                            setHighlightedDropdownIndex(-1)
                          }}
                          onBlur={() => setTimeout(() => setActiveRoomDropdown(null), 200)}
                          onKeyDown={(e) => {
                            if (activeRoomDropdown !== i) return
                            const options = ROOM_TYPES.filter(rt => !row.roomType || rt.toLowerCase().includes(row.roomType.toLowerCase()))
                            
                            if (e.key === 'Escape') {
                              setActiveRoomDropdown(null)
                              e.stopPropagation()
                            } else if (e.key === 'ArrowDown') {
                              e.preventDefault()
                              setHighlightedDropdownIndex(prev => prev < options.length - 1 ? prev + 1 : prev)
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault()
                              setHighlightedDropdownIndex(prev => prev > 0 ? prev - 1 : 0)
                            } else if (e.key === 'Enter') {
                              e.preventDefault() // prevent jumping to next field immediately
                              if (highlightedDropdownIndex >= 0 && highlightedDropdownIndex < options.length) {
                                handleTableChange(i, 'roomType', options[highlightedDropdownIndex])
                              } else if (options.length > 0) {
                                handleTableChange(i, 'roomType', options[0])
                              }
                              setActiveRoomDropdown(null)
                            }
                          }}
                          style={{ width: '100%', padding: '0.4rem', border: '1px solid #cbd5e1', borderRadius: '4px', boxSizing: 'border-box' }}
                          placeholder="Select or type..."
                        />
                        {activeRoomDropdown === i && (
                          <div style={{
                            position: 'absolute', top: '100%', left: 0,
                            minWidth: '100%', width: 'max-content',
                            background: 'white', border: '1px solid #cbd5e1',
                            borderRadius: 4, zIndex: 50, maxHeight: 150, overflowY: 'auto',
                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', marginTop: 4
                          }}>
                            {ROOM_TYPES.filter(rt => !row.roomType || rt.toLowerCase().includes(row.roomType.toLowerCase())).map((rt, optIdx) => (
                                <div 
                                  key={rt} 
                                  style={{ 
                                    padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem',
                                    background: highlightedDropdownIndex === optIdx ? '#f8fafc' : 'transparent',
                                    whiteSpace: 'nowrap'
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleTableChange(i, 'roomType', rt);
                                    setActiveRoomDropdown(null);
                                  }}
                                  onMouseEnter={() => setHighlightedDropdownIndex(optIdx)}
                                >
                                  {rt}
                                </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span>{row.roomType}</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem', borderRight: '1px solid #e2e8f0' }}>
                    {isEditing ? (
                      <input 
                        type="text" 
                        value={row.sheetCode} 
                        onChange={e => handleTableChange(i, 'sheetCode', e.target.value)}
                        style={{ width: '100%', padding: '0.4rem', border: '1px solid #cbd5e1', borderRadius: '4px', boxSizing: 'border-box' }}
                        placeholder="Sheet Code"
                      />
                    ) : (
                      <span>{row.sheetCode}</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem', borderRight: '1px solid #e2e8f0' }}>
                    {isEditing ? (
                      <input 
                        type="text" 
                        value={row.remark} 
                        onChange={e => handleTableChange(i, 'remark', e.target.value)}
                        style={{ width: '100%', padding: '0.4rem', border: '1px solid #cbd5e1', borderRadius: '4px', boxSizing: 'border-box' }}
                        placeholder="Remark"
                      />
                    ) : (
                      <span>{row.remark}</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    {isEditing ? (
                      <input 
                        type="number" 
                        value={row.qty} 
                        onChange={e => handleTableChange(i, 'qty', e.target.value)}
                        style={{ width: '100%', padding: '0.4rem', border: '1px solid #cbd5e1', borderRadius: '4px', boxSizing: 'border-box' }}
                        placeholder="Qty"
                      />
                    ) : (
                      <span>{row.qty}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isEditing && (
            <button className="btn btn-ghost" onClick={handleAddRow} style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}>
              + Add Row
            </button>
          )}
        </div>
        )}

        {/* The Rich Text Editor */}
        <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Image Floating Menu is currently disabled due to Tiptap export issue */}
          <EditorContent editor={editor} className="tiptap-wrapper" />
        </div>
      </div>

      <style>{`
        .tiptap-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .tiptap-editor {
          padding: 1rem;
          flex: 1;
          outline: none;
          font-size: 1rem;
          line-height: 1.5;
          cursor: text;
        }
        .tiptap-editor p.is-editor-empty:first-child::before {
          content: 'Start typing your notes or paste an image here...';
          color: var(--text-light);
          pointer-events: none;
          float: left;
          height: 0;
        }
        .tiptap-editor ul {
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }
        .tiptap-editor li {
          margin-bottom: 0.25rem;
        }
      `}</style>
      
      {cropSrc && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.9)', zIndex: 9999,
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: '1rem' }}>
            <PerspectiveCropper 
              src={cropSrc} 
              onComplete={setCropperRef}
            />
          </div>
          <div style={{ padding: '0.5rem 1rem', background: '#333', display: 'flex', gap: '1rem', justifyContent: 'center', flexShrink: 0, width: '100%' }}>
             <button className="btn btn-ghost" style={{ color: '#fff', fontSize: '0.9rem' }} onClick={() => rotateImage(-90)}>↺ Rotate Left</button>
             <button className="btn btn-ghost" style={{ color: '#fff', fontSize: '0.9rem' }} onClick={() => rotateImage(90)}>↻ Rotate Right</button>
          </div>
          <div style={{ padding: '1rem', background: '#222', display: 'flex', justifyContent: 'space-between', flexShrink: 0, width: '100%' }}>
            <button className="btn btn-ghost" style={{ color: '#aaa' }} onClick={() => { setCropperRef(null); setCropSrc(null); }}>Cancel</button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-ghost" style={{ color: '#fff', border: '1px solid #555' }} onClick={skipCropping} disabled={uploadingCrop}>Skip</button>
              <button className="btn btn-primary" onClick={finishCropping} disabled={uploadingCrop}>{uploadingCrop ? 'Uploading...' : 'Confirm Crop'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default SelectionSheetTab
