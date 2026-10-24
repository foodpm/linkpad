// Puppeteer's bundled declarations reference Node globals, which conflict with
// the Workers runtime types. Declare only the Browser Rendering API used here.
interface ScreenshotOptions {
  type?: 'jpeg' | 'png'
  quality?: number
}

interface Page {
  setViewport(options: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>
  goto(url: string, options?: { waitUntil?: 'load'; timeout?: number }): Promise<unknown>
  screenshot(options: ScreenshotOptions): Promise<Uint8Array>
}

interface Browser {
  newPage(): Promise<Page>
  close(): Promise<void>
}

export function launch(endpoint: unknown, options?: Record<string, unknown>): Promise<Browser>
