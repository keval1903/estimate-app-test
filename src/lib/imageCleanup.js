import { supabase } from './supabase'

export function extractImageUrls(html) {
  if (!html) return []
  const urls = []
  const regex = /<img[^>]+src="([^">]+)"/g
  let match
  while ((match = regex.exec(html)) !== null) {
    urls.push(match[1])
  }
  return urls
}

export async function deleteImagesFromStorage(urls) {
  if (!urls || urls.length === 0) return
  
  // Supabase public URL format:
  // https://<project-id>.supabase.co/storage/v1/object/public/selection_images/filename.jpg
  
  const fileNames = urls.map(url => {
    try {
      const urlObj = new URL(url)
      const pathParts = urlObj.pathname.split('/')
      // The last part should be the filename
      const fileName = pathParts[pathParts.length - 1]
      // Only return if it seems like a valid filename we upload (e.g. timestamp-random.jpg)
      return fileName ? decodeURIComponent(fileName) : null
    } catch(e) {
      return null
    }
  }).filter(Boolean)

  if (fileNames.length === 0) return

  try {
    const { error } = await supabase.storage.from('selection_images').remove(fileNames)
    if (error) throw error
    console.log('Successfully deleted images:', fileNames)
  } catch (e) {
    console.error('Failed to delete images:', e)
  }
}

export async function cleanupRemovedImages(oldHtml, newHtml) {
  const oldUrls = extractImageUrls(oldHtml)
  const newUrls = extractImageUrls(newHtml)
  
  // Find urls that were in oldHtml but are missing from newHtml
  const removedUrls = oldUrls.filter(url => !newUrls.includes(url))
  
  if (removedUrls.length > 0) {
    await deleteImagesFromStorage(removedUrls)
  }
}
