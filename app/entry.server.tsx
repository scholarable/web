import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  responseHeaders.set("Cache-Control", "no-store");
  if (request.method === "HEAD") return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />);
  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, { status: responseStatusCode, headers: responseHeaders });
}

// Client-side navigation uses .data responses, which do not use document headers.
export function handleDataRequest(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
