export function formatBillNumber(num) {
  if (!num) return num;
  const str = String(num);
  // Expect encoded format like 2610001 (length 7)
  if (str.length >= 7) {
    const yy = str.slice(0, 2);
    const mm = str.slice(2, 4);
    const seqStr = str.slice(4);
    
    const seq = parseInt(seqStr, 10);
    const formattedSeq = seq < 10 ? `0${seq}` : `${seq}`;
    
    return `${formattedSeq}/${mm}${yy}`;
  }
  return num;
}
