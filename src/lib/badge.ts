/** Color for a file-type badge, matching the design's palette. */
export function typeColor(type: string): string {
  const t = type.toUpperCase();
  if (t === 'DIR') return '#7c5cff';
  if (['ZIP', 'GZ', 'TAR', 'RAR', '7Z', 'TGZ'].includes(t)) return '#18181b';
  if (t === 'PDF') return '#c0392b';
  if (['TXT', 'MD', 'LOG', 'RTF'].includes(t)) return '#3867d6';
  if (['PNG', 'JPG', 'JPEG', 'GIF', 'SVG', 'WEBP', 'HEIC'].includes(t)) return '#0f9d58';
  if (['DOC', 'DOCX'].includes(t)) return '#2b579a';
  if (['XLS', 'XLSX', 'CSV'].includes(t)) return '#1e7145';
  if (['MP4', 'MOV', 'MKV', 'AVI', 'WEBM'].includes(t)) return '#8e44ad';
  if (['MP3', 'WAV', 'FLAC', 'AAC'].includes(t)) return '#e67e22';
  return '#52525b';
}
