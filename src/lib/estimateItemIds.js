export function assignEstimateItemIds(
  items,
  createId = () => crypto.randomUUID()
) {
  const usedIds = new Set()

  return items.map(item => {
    const id =
      (typeof item.id === 'string' ? item.id.trim() : '') ||
      createId()

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) {
      throw new Error(
        'Invalid estimate item ID. Please reload the item and try again.'
      )
    }

    if (usedIds.has(id.toLowerCase())) {
      throw new Error(
        'Duplicate estimate item ID. Please remove the duplicate item and try again.'
      )
    }

    usedIds.add(id.toLowerCase())
    return { ...item, id }
  })
}
