declare module 'uWebSockets.js' {
  export type HttpRequest = {
    getHeader(name: string): string;
    getUrl(): string;
    getQuery(): string;
  };

  export type HttpResponse = {
    writeStatus(status: string): HttpResponse;
    writeHeader(name: string, value: string): HttpResponse;
    end(message?: string): void;
    onAborted(handler: () => void): void;
    upgrade<UserData>(
      userData: UserData,
      secWebSocketKey: string,
      secWebSocketProtocol: string,
      secWebSocketExtensions: string,
      context: unknown
    ): void;
  };

  export type WebSocket<UserData> = {
    getUserData(): UserData;
    send(message: string): void;
    close(code?: number, shortMessage?: string): void;
  };

  export type WebSocketBehavior<UserData> = {
    maxPayloadLength?: number;
    idleTimeout?: number;
    compression?: number;
    upgrade?: (response: HttpResponse, request: HttpRequest, context: unknown) => void;
    open?: (socket: WebSocket<UserData>) => void;
    message?: (socket: WebSocket<UserData>, message: ArrayBuffer, isBinary: boolean) => void;
    close?: (socket: WebSocket<UserData>, code: number, message: ArrayBuffer) => void;
  };

  export type TemplatedApp = {
    ws<UserData>(pattern: string, behavior: WebSocketBehavior<UserData>): TemplatedApp;
    options(
      pattern: string,
      handler: (response: HttpResponse, request: HttpRequest) => void
    ): TemplatedApp;
    get(
      pattern: string,
      handler: (response: HttpResponse, request: HttpRequest) => void
    ): TemplatedApp;
    listen(port: number, callback: (token: unknown) => void): void;
  };

  export function App(): TemplatedApp;
}
