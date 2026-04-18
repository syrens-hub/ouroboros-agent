import type { ServerResponse, IncomingMessage } from "http";

export function createMockRes(): ServerResponse<IncomingMessage> & { _data: string; headers: Record<string, string> } {
  const res = {
    statusCode: 200,
    headers: {},
    _data: "",
    writeHead(status: number, headers: Record<string, string>) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(data: string) {
      this._data = data;
    },
  } as ServerResponse<IncomingMessage> & { _data: string; headers: Record<string, string> };
  return res;
}
