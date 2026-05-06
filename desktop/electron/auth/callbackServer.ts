import http from 'node:http'

const CALLBACK_PORT = parseInt(process.env.AUTH_CALLBACK_PORT || '43123', 10)

export class CallbackServer {
  private server: http.Server | null = null
  private resolveAuth: ((params: URLSearchParams) => void) | null = null

  start(): Promise<URLSearchParams> {
    return new Promise((resolve) => {
      this.resolveAuth = resolve

      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${CALLBACK_PORT}`)
        if (url.pathname === '/callback') {
          const params = url.searchParams
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Login successful</h1><p>You may close this window.</p></body></html>')
          if (this.resolveAuth) {
            this.resolveAuth(params)
            this.resolveAuth = null
          }
        } else {
          res.writeHead(404)
          res.end('Not Found')
        }
      })

      this.server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        console.log(`[callback] Server listening on 127.0.0.1:${CALLBACK_PORT}`)
      })
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }
}
