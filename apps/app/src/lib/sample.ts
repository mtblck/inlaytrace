/**
 * A sample to try the tool on without hunting for a file.
 *
 * It is drawn here, then rasterised and JPEG-compressed, so it arrives with the
 * same soft edges and compression noise as a real downloaded logo. Tracing a
 * pristine raster would make every preset look better than it will on the
 * user's own images.
 */
const ART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#f3ede1"/>
  <circle cx="200" cy="200" r="168" fill="#1f3b4d"/>
  <circle cx="200" cy="200" r="150" fill="none" stroke="#f3ede1" stroke-width="5"/>
  <circle cx="268" cy="142" r="42" fill="#e9a23b"/>
  <path d="M52 268 L140 158 L196 222 L244 170 L348 268 Q300 330 200 344 Q100 330 52 268Z" fill="#d9542b"/>
  <path d="M140 158 L118 186 L140 178 L156 196 Z M244 170 L226 192 L246 186 L262 202 Z" fill="#f3ede1"/>
  <path d="M70 290 Q200 250 330 290 Q300 332 200 344 Q100 332 70 290Z" fill="#2d6a4f"/>
  <path d="M120 312 Q200 290 280 312" fill="none" stroke="#f3ede1" stroke-width="5" stroke-linecap="round"/>
</svg>`

export async function sampleImage(size = 640): Promise<Blob> {
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ART)}`
  await img.decode()
  const canvas = new OffscreenCanvas(size, size)
  canvas.getContext('2d')!.drawImage(img, 0, 0, size, size)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
}
