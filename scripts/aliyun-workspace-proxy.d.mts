import type { IncomingMessage, ServerResponse } from 'node:http'
export function validWorkspaceOrigin(value: unknown): boolean
export function handleWorkspace(req: IncomingMessage, res: ServerResponse): Promise<boolean>
