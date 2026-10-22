import type { IncomingMessage, ServerResponse } from 'node:http'
export function handleBailian(req: IncomingMessage, res: ServerResponse): Promise<boolean>
export function isBailianMediaUrl(value: string): boolean
