import { handleRequest, type HttpRequest, type HttpResponse } from "../api/router.js";
import { type APIGatewayProxyEventV2, type APIGatewayProxyResultV2, type Context } from "aws-lambda";

export async function handler(
  event: any,
  context?: Context
): Promise<APIGatewayProxyResultV2> {
  // Normalize event format (supporting both HTTP API v2 and REST API v1 proxy events)
  const isV2 = Boolean(event.rawPath);
  const path = isV2 ? event.rawPath : event.path;
  const method = isV2 ? event.requestContext?.http?.method : event.httpMethod;

  let body = event.body;
  if (typeof body === "string" && body.length > 0) {
    if (event.isBase64Encoded) {
      body = Buffer.from(body, "base64").toString("utf-8");
    }
    try {
      body = JSON.parse(body);
    } catch {
      // Keep as string if not JSON
    }
  }

  const httpRequest: HttpRequest = {
    method: method || "GET",
    path: path || "/",
    headers: event.headers || {},
    queryStringParameters: event.queryStringParameters || {},
    body,
  };

  const response = await handleRequest(httpRequest);

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body,
  };
}
