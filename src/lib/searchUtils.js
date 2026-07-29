export function isFuzzyMatch(search, target) {
  if (!search) return true;
  if (!target) return false;
  search = search.toLowerCase();
  target = target.toLowerCase();
  
  let i = 0;
  for (let j = 0; j < target.length && i < search.length; j++) {
    if (search[i] === target[j]) {
      i++;
    }
  }
  return i === search.length;
}
