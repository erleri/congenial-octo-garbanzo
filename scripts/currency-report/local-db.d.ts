export function localDbConfig(): Promise<{ url: string; anonKey: string }>
export function assertLocalApi(url: string): string
export function syntheticDbReport(currency: string, baseDate: string, sequence: number): Record<string, unknown>
