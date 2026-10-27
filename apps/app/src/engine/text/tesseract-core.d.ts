// The parts of tesseract.js-core (Apache 2.0, ships no types) that text recognition uses.
declare module 'tesseract.js-core/tesseract-core-simd-lstm.js' {
  export type TessModule = {
    FS: { writeFile(path: string, data: Uint8Array): void }
    TessBaseAPI: new () => {
      Init(dataPath: string, lang: string, oem: number): number
      SetVariable(name: string, value: string): boolean
      SetImageFile(exifOrientation: number, angle: number): number
      Recognize(monitor: null): number
      GetTSVText(page: number): string
      Clear(): void
    }
  }
  const TesseractCore: (options: { locateFile: (file: string) => string; print?: (s: string) => void; printErr?: (s: string) => void }) => Promise<TessModule>
  export default TesseractCore
}
