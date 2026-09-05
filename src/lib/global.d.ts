// Global type declarations for the Nimiq Pay injected providers

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<any>
  on?(event: string, handler: (...args: any[]) => void): void
  removeListener?(event: string, handler: (...args: any[]) => void): void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

export {}
