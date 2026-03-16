import { type NextRequest, NextResponse } from 'next/server'

const API_ORIGIN = process.env.CCHISTORY_INTERNAL_API_ORIGIN || 'http://127.0.0.1:8040'
const MAX_PROXY_BODY_BYTES = 2 * 1024 * 1024
const ALLOWED_PATH_PREFIXES = ['/api/', '/health', '/openapi.json']

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const joinedPath = '/' + path.join('/')

  if (!ALLOWED_PATH_PREFIXES.some((prefix) => joinedPath.startsWith(prefix))) {
    return NextResponse.json({ error: 'Proxy path not allowed' }, { status: 403 })
  }

  const url = new URL(joinedPath, API_ORIGIN)
  url.search = request.nextUrl.search

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  const contentType = request.headers.get('content-type')
  if (contentType) {
    headers['Content-Type'] = contentType
  }

  const token = process.env.CCHISTORY_API_TOKEN
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let body: ArrayBuffer | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer()
    if (body.byteLength > MAX_PROXY_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
    }
  }

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    },
  })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const DELETE = proxy
export const PATCH = proxy
