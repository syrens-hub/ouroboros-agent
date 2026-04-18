/**
 * Web Agent Skill
 * ===============
 * Simple web fetching and content extraction tool with safety limits.
 */

import https from "https";
import http from "http";
import { URL } from "url";
import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

const MAX_CONTENT_LENGTH = 500_000; // ~500KB of HTML
const MAX_REDIRECTS = 5;

function fetchUrl(
  url: string,
  options: { headers?: Record<string, string>; redirectCount?: number } = {}
): Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; content: string; url: string }> {
  return new Promise((resolve, reject) => {
    const redirectCount = options.redirectCount ?? 0;
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error("Too many redirects"));
      return;
    }

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...options.headers,
    };

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers,
      timeout: 15000,
    };

    const req = lib.request(reqOptions, (res: http.IncomingMessage) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const location = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsedUrl.protocol}//${parsedUrl.hostname}${res.headers.location}`;
        fetchUrl(location, { ...options, redirectCount: redirectCount + 1 }).then(resolve).catch(reject);
        return;
      }

      let data = "";
      let truncated = false;

      res.on("data", (chunk: string | Buffer) => {
        if (truncated) return;
        data += chunk;
        if (data.length > MAX_CONTENT_LENGTH) {
          truncated = true;
          data = data.slice(0, MAX_CONTENT_LENGTH);
          // destroy the request to stop receiving more data
          req.destroy();
          resolve({
            status: res.statusCode,
            headers: res.headers,
            content: data + "\n\n[Content truncated due to size limit]",
            url,
          });
        }
      });

      res.on("end", () => {
        if (!truncated) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            content: data,
            url,
          });
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.end();
  });
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : "";
}

function extractDescription(html: string) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  return "";
}

function extractChineseText(html: string) {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ");
  const chinese = text.match(/[\u4e00-\u9fff]{2,}/g);
  if (chinese) {
    const unique = [...new Set(chinese)];
    return unique.slice(0, 200).join(" ");
  }
  return "";
}

export const webAgentTool = buildTool({
  name: "web_agent",
  description: "Fetch a web page and extract title, description, and key Chinese text. Respects size limits and redirect limits.",
  inputSchema: z.object({
    url: z.string().url(),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call(input) {
    const result = await fetchUrl(input.url);

    const title = extractTitle(result.content);
    const description = extractDescription(result.content);
    const chineseText = extractChineseText(result.content);

    return {
      success: true,
      data: {
        url: result.url,
        status: result.status,
        title,
        description,
        linkCount: (result.content.match(/<a /g) || []).length,
        imageCount: (result.content.match(/<img /g) || []).length,
        contentLength: result.content.length,
        chineseText: chineseText || undefined,
      },
    };
  },
});
