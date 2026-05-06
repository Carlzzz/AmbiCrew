/**
 * CrewCentral OAuth REST API
 *
 * POST   /api/central-oauth/start  — 构建 CrewCentral 登录 URL
 * GET    /api/central-oauth        — 查询当前登录状态
 * DELETE /api/central-oauth        — 登出，删除 token
 */

import { centralOAuthService } from '../services/centralOAuthService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handleCentralOAuthApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2] // segments: ['api', 'central-oauth', <action?>]

    if (action === 'start' && req.method === 'POST') {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        throw ApiError.badRequest('Invalid JSON body')
      }
      const serverPort =
        body && typeof body === 'object' && 'serverPort' in body
          ? (body as Record<string, unknown>).serverPort
          : undefined
      if (typeof serverPort !== 'number' || serverPort <= 0) {
        throw ApiError.badRequest('serverPort (positive integer) required')
      }
      const session = await centralOAuthService.startSession({
        serverPort,
      })
      return Response.json({ authorizeUrl: session.authorizeUrl })
    }

    if ((action === undefined || action === 'status') && req.method === 'GET') {
      const status = await centralOAuthService.getStatus()
      return Response.json(status)
    }

    if (action === undefined && req.method === 'DELETE') {
      await centralOAuthService.deleteTokens()
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Not Found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}
