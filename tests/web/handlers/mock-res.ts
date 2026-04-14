export function createMockRes() {
  const res: any = { headers: {}, _data: "" };
  res.writeHead = (status: number, headers: any) => {
    res.statusCode = status;
    Object.assign(res.headers, headers);
  };
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v;
  };
  res.end = (data: string) => {
    res._data = data;
  };
  return res;
}
